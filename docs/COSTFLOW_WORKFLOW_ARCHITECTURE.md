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

The migrations are additive. Reviewer attention should focus on unique constraints, parent/attempt/version bindings, delete behavior, project linkage, and indices used by inbox/project reads.

### Domain logic

| Area | Key files | Review focus |
|---|---|---|
| Money | `lib/costflow/money.ts`, `inputFormat.ts` | exact input handling, rounding boundaries, unknown vs explicit zero |
| PO/IC versions | `budgetSources.ts`, `budgetDraft.ts`, `budgetLineage.ts`, `budgetRevisions.ts` | source lineage, immutable submitted revisions, replacement semantics |
| Quotation | `budgetQuotation.ts`, `quotationHierarchy.ts`, `quotationProjection.ts`, `quotationTotals.ts` | hierarchy, customer allowlist, totals and reference-cycle validation |
| Paired pricing | `pairedPricing.ts`, `workspaceFlow.ts` | independent sales/IC fields and mode capabilities |
| IC effect | `icEffectiveness.ts` | Manager effect separate from later approval outcome |
| Evidence | `icEvidence.ts`, `exportData.ts`, `export.ts` | evidence-or-reason gates and customer/internal export separation |
| Reconciliation | `reconciliation.ts` | employee/vendor balances and cash allocation boundaries |
| Approval | `lib/workflow/approval.ts`, `approvalEvents.ts` | assigned actor, attempt/version token, no step skipping |
| Workflow docs | `documents.ts`, `lifecycle.ts`, `permissions.ts` | immutable submissions, replacement, signing and reader boundaries |
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
| `/api/projects/[id]/costflow/evidence/**` | Authorized evidence upload/download/preview |
| `/workflow` | Authorized inbox/list/create surfaces |
| `/workflow/[id]` | Dossier detail, decisions, files, signing, and history |
| `/api/workflow/files/[fileId]` | Authorized Workflow file bytes |

### UI composition

- `ModuleShell` and `ProjectTabs` keep the feature inside the existing TaskFlow navigation and project context.
- `CostFlowPanel` owns lifecycle-tab composition, not finance authority.
- `QuotationPanel` is the version/source hub.
- `CostFlowWorksheet` selects the correct shared editor mode and source.
- `PairedQuotationIcEditor` owns the editable worksheet interaction while domain helpers own calculations and validation.
- `InternalCostPanel`, `ApprovalRequestsPanel`, `ActualCostPanel`, `PaymentCashPanel`, and `SettlementPanel` expose distinct lifecycle screens.
- `WorkflowPanel` exposes document/template/approval/signing/history states.

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
| `costflow*.test.ts` | CostFlow service, evidence, cash, export, permissions |
| `workspace-flow.test.ts` | editor-mode capability and save-scope boundaries |

The `test:costflow` runner covers the currently registered 50 unit/static tests. DB-backed integration evidence from phase work remains useful, but final PR validation should rerun the intended integration suites against the isolated test database before deployment.

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
