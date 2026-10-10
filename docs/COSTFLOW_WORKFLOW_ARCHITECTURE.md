# CostFlow & Workflow architecture and review map

This document explains the implementation boundaries introduced by the CostFlow/Workflow feature branch. It is a reviewer map, not a replacement for business acceptance or production architecture approval.

## System context

```text
Authenticated TaskFlow user
        │
        ├── Project / membership / existing files and tasks
        │          │
        │          └── CostFlow workspace
        │               ├── PO / quotation / IC versions
        │               ├── shared approval requests and events
        │               ├── evidence / AC / payment requests
        │               └── cash / reconciliation / close
        │
        └── Workflow inbox / independent or project-linked dossiers
                    ├── template family and immutable version
                    ├── submission snapshot and files
                    ├── shared approval requests and events
                    └── signing / custody / execution lifecycle
```

CostFlow owns finance behavior. Workflow owns the reusable dossier and approval foundation. Both reuse TaskFlow identity, Project, membership, files, notifications, and server-side authorization patterns.

## State boundaries

Do not collapse the following into one status:

| Axis | Meaning | Primary evidence |
|---|---|---|
| Approval | Who approved, returned, rejected, withdrew, or cancelled a submitted version | Workflow request, attempt, step, decision, approval event |
| Budget effectiveness | Which IC revision currently affects the project budget | IC revision/effectiveness projection |
| Payment authority | Whether a payment-type request has the required approval | Request kind and approved attempt |
| Actual cash | A recorded money movement | CostFlow cash row and allocation |
| Signing | Paper/digital artifact and custody confirmation | Workflow signed file/custody state |
| Execution | Work after approval is complete | Workflow lifecycle state/evidence |
| Financial close | Project finance has been reconciled and locked | Close/reopen request and CostFlow workspace state |

Manager approval may activate an IC baseline. Accountant/CEO decisions remain approval outcomes and do not silently erase the effective baseline. Approval never creates a cash row by itself.

## Layer map

### Persistence

- `prisma/schema.prisma` defines shared relationships and feature records.
- `prisma/migrations/20261002*` adds the standard CostFlow/Workflow foundation, template catalog, and requirement snapshots.
- `prisma/migrations/20261003050000_approval_provenance` strengthens decision provenance.
- `prisma/migrations/20261005180000_quotation_reuse_templates` adds reusable quotation sources.
- `prisma/migrations/20261008140000_phase7_payment_dossier_lines` adds recipient/source-specific payment lines and settlement lineage.
- `prisma/migrations/20261009_phase8_actual_cost_authority` adds normalized Actual Cost occurrences, evidence, approval attempts, customer liquidation, and AR receipts.
- `prisma/migrations/20261010_phase9_*` add signature assets/PINs, approved snapshots, ordered signing events, public capability verification, physical scans, and revision guards.

The migrations are additive. Reviewer attention should focus on unique constraints, parent/attempt/version bindings, delete behavior, project linkage, and indices used by inbox/project reads.

### Domain logic

| Area | Key files | Review focus |
|---|---|---|
| Money | `lib/costflow/money.ts`, `inputFormat.ts` | exact input handling, rounding boundaries, unknown vs explicit zero |
| PO/IC versions | `budgetSources.ts`, `budgetDraft.ts`, `budgetLineage.ts`, `budgetRevisions.ts` | source lineage, immutable submitted revisions, replacement semantics |
| Quotation | `budgetQuotation.ts`, `quotationHierarchy.ts`, `quotationProjection.ts`, `quotationTotals.ts` | hierarchy, customer allowlist, totals and reference-cycle validation |
| Paired pricing | `pairedPricing.ts`, `workspaceFlow.ts` | independent sales/IC fields and mode capabilities |
| Excel intake/round-trip | `excelIntake*.ts`, `excelRoundTrip.ts`, `quotationExcel.ts` | file limits, MIME/magic-byte checks, opaque preview ownership, lossless semantics, atomic confirm/apply, stale-source rejection |
| IC effect | `icEffectiveness.ts` | Manager effect separate from later approval outcome |
| Actual Cost | `actualCost*.ts`, `approvedActualCost.ts` | immutable DD approval tuple, IC-to-AC comparison, evidence completeness, role-scoped projection |
| Customer accounting | `customerAccounting.ts`, `customerAcceptance*.ts` | liquidation/AR/margin separation and customer-safe PDF/XLSX snapshot |
| Evidence | `icEvidence.ts`, `actualCostService.ts`, `exportData.ts`, `export.ts` | evidence-or-reason gates, authorized bytes, and customer/internal export separation |
| Reconciliation | `paymentSettlement.ts`, `paymentCash.ts`, `reconciliation.ts` | exact selected sources, employee/vendor balances, explicit cash, replay/race safety |
| Approval | `lib/workflow/approval.ts`, `approvalEvents.ts` | assigned actor, attempt/version token, no step skipping |
| Workflow docs | `documents.ts`, `lifecycle.ts`, `permissions.ts` | immutable submissions, replacement, physical custody, execution and reader boundaries |
| Governed signing | `signatureAssets.ts`, `approvedSnapshot.ts`, `signing.ts`, `printDocument.ts`, `publicVerification.ts` | six-digit PIN, immutable projection, ordered role events, signature privacy, hash/QR verification, revision/replacement |
| Notifications | `workflow/notifications.ts` | durable intent vs post-commit transport result |

### Service and mutation boundaries

- `lib/costflow/service.ts` loads authorized finance state and performs server mutations through the shared persistence model.
- `lib/workflow/service.ts` owns template/document/file/decision lifecycle operations.
- `app/actions/costflow.ts`, `app/actions/quotationTemplates.ts`, and `app/actions/workflow.ts` are server-action adapters.
- Route handlers own file/evidence bytes, previews, request export, and print-safe projections.

Expected rule: client state can improve interaction, but server input validation, authorization, current version, and current attempt are authoritative.

### Routes

| Route family | Responsibility |
|---|---|
| `/projects/[id]/costflow` | Project CostFlow hub and lifecycle tabs |
| `/projects/[id]/costflow/quotations/new` | New customer quotation worksheet |
| `/projects/[id]/costflow/paired` | Paired quotation/IC worksheet |
| `/projects/[id]/costflow/quotations/[quotationId]/ic` | IC from an immutable quotation source |
| `/projects/[id]/costflow/quotations/[quotationId]/print` | Customer-safe print projection |
| `/projects/[id]/costflow/requests/[requestId]/print` | Request/record print view |
| `/api/projects/[id]/costflow/excel-intake/**` | Authorized template, opaque preview, atomic confirmation, and round-trip preview |
| `/api/projects/[id]/costflow/customer-acceptance/**` | Customer-safe frozen PDF/XLSX acceptance artifacts |
| `/api/projects/[id]/costflow/evidence/**` | Authorized evidence upload/download/preview |
| `/workflow` | Authorized inbox/list/create surfaces |
| `/workflow/[id]` | Dossier detail, decisions, files, signing, and history |
| `/workflow/[id]/print` | Approved/draft print projection with four sign blocks and QR when eligible |
| `/workflow/verify/[token]` | Zero-auth privacy-safe capability verification with uniform invalid state |
| `/api/workflow/files/[fileId]` | Authorized Workflow file bytes |
| `/api/workflow/physical-scans/[fileId]` | Re-authorized private physical-scan download |

### UI composition

- `ModuleShell` and `ProjectTabs` keep the feature inside the existing TaskFlow navigation and project context.
- `CostFlowPanel` owns lifecycle-tab composition, not finance authority.
- `QuotationPanel` is the version/source hub.
- `CostFlowWorksheet` selects the correct shared editor mode and source.
- `PairedQuotationIcEditor` owns the editable worksheet interaction while domain helpers own calculations and validation.
- `ExcelIntakeDialog` and `ExcelRoundTripDialog` expose preview-first import/export without granting browser state persistence authority.
- `InternalCostPanel`, `ApprovalRequestsPanel`, `ActualCostPanel`, `PaymentCashPanel`, and `SettlementPanel` expose distinct lifecycle screens.
- `ActualCostControlCenter` composes canonical IC-to-AC comparison, editing, evidence, decision, and role views from a server-scoped projection.
- `ProfileSignatureForm`, `SignaturePad`, `WorkflowPrintView`, `PaperSigningSection`, and `PublicVerificationCard` expose signing capabilities while server services remain authoritative.
- `WorkflowPanel` exposes document/template/approval/signing/history states and routes CostFlow records back to the exact project approval anchor.

## Key invariants for review

1. Blank financial inputs stay unknown; zero is a deliberate value.
2. Customer quotation and internal cost remain distinct records and lifecycles.
3. IC derived from quotation cannot rewrite source sales data.
4. Submitted/effective snapshots do not recalculate from later parameter/template changes.
5. Same actor in consecutive roles must still make separate decisions.
6. Admin does not automatically bypass assignment.
7. Manager effect and CEO outcome are different facts.
8. Request approval is not cash.
9. File list visibility is not file-byte authorization.
10. Customer projections never include internal costs, suppliers, internal evidence, or internal notes.
11. Formula definitions are normalized allowlisted data, not executable JavaScript.
12. Financial close is explicit and reversible only through the governed reopen path.
13. A signature confirmation authorizes the signed artifact only; it never writes a cash transaction.
14. Public verification stores a token digest and returns an allowlisted DTO; reusable signature bytes, PIN hashes, bank data, files, payloads, and normalized signer IP stay private.
15. DIGITAL and PHYSICAL signing lifecycles cannot be mixed, and document revision preserves/replaces immutable approved snapshots rather than rewriting history.

## Test map

| Test group | Primary behavior |
|---|---|
| `budget*.test.ts` | IC drafts, lineage, PO replacement, revisions |
| `quotation*.test.ts` | hierarchy, projection, totals, parameters, templates, reuse |
| `paired.integration.test.ts` | paired/IC persistence and source immutability |
| `ic-effectiveness*.test.ts` | approval/effectiveness two-axis behavior |
| `workflow-approval*.test.ts` | step assignment, attempts, returns/rejections, concurrency |
| `workflow-documents*.test.ts` | templates, slots, immutable submission files |
| `workflow.integration.test.ts` | persisted end-to-end Workflow lifecycle |
| `actual-cost*.test.ts`, `customer-*.test.ts` | normalized AC authority, evidence, role projections, customer liquidation/AR/export |
| `excel-intake*.test.ts`, `excel-round-trip*.test.ts` | workbook contract, parser/security, preview ownership, atomic persistence, editable merge |
| `payment*.test.ts` | request/read-model/cash/settlement authorization, replay and race safety |
| `workflow-profile-signature.test.ts`, `signature-pad.test.tsx` | reusable signature/PIN and transient signing UI contract |
| `workflow-approved-snapshot.test.ts`, `workflow-digital-sign.integration.test.ts` | immutable approved projection and ordered digital signing |
| `workflow-print-layout.test.ts`, `workflow-qr-roundtrip.test.ts`, `workflow-public-verification.test.ts` | print projection, QR, token privacy, tamper states |
| `workflow-paper-sign.integration.test.ts`, `workflow-revision.integration.test.ts` | physical scan custody, revisions, references, execution and replacement history |
| `workflow-signing-security.test.ts`, `workflow-phase9-full.integration.test.ts` | cross-cutting Phase 9 security and full lifecycle regression |
| `costflow*.test.ts` | CostFlow service, evidence, cash, export, permissions |
| `workspace-flow.test.ts` | editor-mode capability and save-scope boundaries |

The `test:costflow` runner covers the registered unit/static suites and selected DB-backed suites run separately against the pinned local database. Phase-specific integration evidence remains useful, but staging must rerun migrations and the intended integration suites against a production-like restored database before deployment.

## Reviewer decision log

Record material review decisions in the PR rather than resolving them only in chat:

| Decision | Reviewer/owner | Outcome | Follow-up |
|---|---|---|---|
| Schema and migration safety |  |  |  |
| Approval/effectiveness semantics |  |  |  |
| Customer projection/privacy |  |  |  |
| Template/legal content acceptance |  |  |  |
| Pilot scope and named actors |  |  |  |
| Production rollout/rollback owner |  |  |  |
