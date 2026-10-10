# PR: CostFlow/Workflow finance, Excel intake, actual cost, and governed signing

> Copy this document into the GitHub pull request body. Update the branch/commit and final validation fields after all follow-up code changes are committed.

## Summary

This PR extends TaskFlow with a persisted CostFlow and Workflow operating slice while preserving existing authentication, project membership, tasks, files, revenue reporting, and notification behavior.

The change introduces:

- a shared sequential approval foundation for Workflow and CostFlow;
- versioned Workflow templates, immutable submission snapshots, files, decisions, signing state, and history;
- project-linked CostFlow workspaces with multiple PO versions, quotations, IC revisions, evidence, approval state, actual costs, requests, cash records, reconciliation, and financial close state;
- dedicated quotation, paired quotation/IC, IC-from-quotation, print, evidence, request, approval, Actual Cost, cash, and settlement surfaces;
- reusable quotation templates and typed event-pricing parameters with impact preview;
- guarded Excel intake and editable round-trip for paired quotation/IC drafts;
- normalized Actual Cost authority, evidence vault, role-scoped control center, customer liquidation, AR cash-in, margin, and customer-safe acceptance exports;
- profile-managed signature assets and six-digit PIN, immutable approved snapshots, ordered four-role digital signing, physical scan custody, SHA-256 verification, QR print/verification, revision, and post-signing cash separation;
- a shared TaskFlow UI foundation and module shell.

This is a feature-branch integration PR. It is not a production-release approval and does not mark all CostFlow/Workflow roadmap requirements complete.

## Branch and review baseline

- **Head branch:** `codex/costflow-ui-refactor`
- **Expected target:** `origin/main`
- **Remote refresh:** 2026-10-10; the local head was 103 commits ahead and 0 behind `origin/main` before the final documentation/validation commit.
- **Feature-branch remote:** the local head was 76 commits ahead and 0 behind `origin/codex/costflow-ui-refactor` before the final documentation/validation commit.
- **Final pushed SHA:** record the verified remote SHA in the PR after push.

Do not merge using a stale target branch. Refresh remote refs and resolve target-branch changes before relying on the snapshot counts above.

## Why this change

TaskFlow previously had Projects, members, tasks, attachments, PO import, authentication, and notifications, but it did not have durable finance or document-workflow state. The business flows require each financial/document record to retain its source, version, responsible actor, evidence, decisions, and outcome.

The implementation keeps these axes separate:

1. approval outcome;
2. IC budget effectiveness;
3. payment authorization;
4. actual cash movement;
5. paper signing/custody;
6. task/execution completion;
7. financial close.

In particular, Manager approval can make an IC revision effective while later Accountant/CEO outcomes remain separate. A rejected payment request does not become payment authority or cash evidence.

## Functional scope

### CostFlow

- Project finance workspace tied to existing Project membership and Admin access.
- Multiple PO sources and explicit replacement lineage.
- Versioned customer quotation with customer-safe projection and print route.
- Shared worksheet modes:
  - quotation only;
  - paired quotation and IC;
  - IC derived from an immutable quotation source.
- Independent sell/buy quantities, pricing basis, VAT, hierarchy, totals, and evidence.
- Draft/revision lineage without overwriting submitted or effective records.
- Typed event-pricing parameters and bounded formula evaluation; no free-form JavaScript evaluation.
- Impact preview before parameter changes are applied.
- IC submission through the shared approval engine.
- Separate budget-effect projection and approval-state projection.
- Actual Cost records and evidence tracking.
- Advance, vendor-payment, reimbursement, cancellation, close, and reopen request foundations.
- Actual cash records and allocation/reconciliation helpers.
- Customer and internal print/export routes with distinct projections.
- Excel workbook template generation, parser hardening, opaque preview sessions, atomic paired-draft confirmation, and editable round-trip diff/apply.
- Independent sell and buy `days` pricing inputs; blank buy days remain unknown and copying is explicit.
- Normalized Actual Cost occurrences, immutable DD approval provenance, multi-type evidence, IC-to-AC reconciliation, role-scoped operational views, and exact settlement tuples.
- Customer liquidation, AR Cash In, actual net margin, and customer-safe PDF/XLSX acceptance artifacts.

### Workflow

- Versioned Workflow template families and publication lifecycle.
- Owner confirmation and guarded Admin publication.
- Draft documents created from immutable template versions.
- Required document/checklist slots and file snapshots at submission time.
- Sequential Manager → Accountant → CEO decisions.
- Return, reject, withdrawal, resubmission, cancellation, replacement, and transfer history.
- Signing upload/custody state kept separate from approval.
- Reusable signature profile and six-digit signing PIN with password-gated reset.
- Four-role in-app signing for financial vouchers, immutable approved projections, SHA-256 tamper detection, QR-backed public verification, and corporate print views.
- Independent physical signing scans, keeper/location metadata, return/re-upload, archive confirmation, post-approval revision, reference-file additions, and execution start.
- Authorized file download and printable dossier-information pages.
- Inbox/history surfaces and durable notification intents.

### Shared UI and navigation

- UI Foundation tokens/primitives and `/design-system` gallery.
- `ModuleShell`, project tabs, module tabs, responsive tables, alerts, dialogs, and forms.
- Project-context CostFlow routes and `/workflow` inbox.
- Desktop table workflows with narrow-screen containment and detail editing paths.

## Explicitly out of scope for this PR

- Production deployment or production database migration.
- Company acceptance of finance rules, legal wording, templates, signatures, or retention policy.
- Native Vietnamese IME acceptance and company pilot completion.
- Real bank integration, third-party certificate-authority signing, object storage migration, FX, or multi-currency settlement.
- Automatic reminder/calendar policy where the company calendar and SLA are not yet confirmed.
- A company-approved signing-IP retention duration or automatic purge policy.
- Treating approval as proof of payment or cash movement.
- Treating local fixtures, generated PDFs, screenshots, or test accounts as production evidence.

## Data and migration impact

Fifteen feature-branch migrations are included relative to `origin/main`:

1. `20261002040000_costflow_standard_workflow`
2. `20261002060000_workflow_templates_documents`
3. `20261002080000_workflow_catalog`
4. `20261002090000_workflow_requirements`
5. `20261003050000_approval_provenance`
6. `20261005180000_quotation_reuse_templates`
7. `20261007090000_add_meetings`
8. `20261008140000_phase7_payment_dossier_lines`
9. `20261009_phase8_actual_cost_authority`
10. `20261010_phase9_approved_signing`
11. `20261010_phase9_physical_scans`
12. `20261010_phase9_public_verification`
13. `20261010_phase9_revision_guard`
14. `20261010_phase9_signature_assets`
15. `20261010_phase9_signing_event_preapproval`

They add Workflow requests/events/roles/readers/notifications/templates/files/history/decisions and CostFlow workspace/template/cash/evidence/history persistence. Existing Project/Task models remain the shared identity and project context.

Migration expectations:

- migrations must run in timestamp order through `prisma migrate deploy`;
- take a database backup or point-in-time restore checkpoint before production migration;
- do not run demo seed mode against production;
- `seed:quotation-templates` is an explicit administrative data action, not part of automatic migration;
- validate existing Project, User, membership, and file relationships after migration;
- rollback of schema/data must use a reviewed compensating migration or database restore, not `prisma migrate reset`.

See [COSTFLOW_WORKFLOW_RELEASE.md](../COSTFLOW_WORKFLOW_RELEASE.md) for the full runbook.

## Security and authorization notes

- Server-side membership/Admin checks remain authoritative; hidden UI is not treated as authorization.
- Workflow and CostFlow decisions validate actor, assigned step, current attempt, submitted version, and mutation version.
- Admin does not receive an implicit approval bypass.
- File routes authorize against the parent record and return file bytes separately from list metadata.
- Customer quotation projection excludes IC/internal-cost data.
- Evidence preview uses same-origin framing policy.
- Formula evaluation uses a normalized allowlisted AST and bounded depth; it does not execute arbitrary JavaScript.
- Environment files, credentials, original finance evidence, and local build output are excluded from commits.

## Recommended review order

Review by dependency, not filename order:

1. **Schema and invariants**
   - `prisma/schema.prisma`
   - the fifteen migrations listed above
   - `lib/costflow/types.ts`
2. **Shared approval and Workflow lifecycle**
   - `lib/workflow/approval.ts`
   - `lib/workflow/approvalEvents.ts`
   - `lib/workflow/permissions.ts`
   - `lib/workflow/service.ts`
3. **CostFlow calculations and state transitions**
   - `lib/costflow/money.ts`
   - `lib/costflow/budgetRevisions.ts`
   - `lib/costflow/icEffectiveness.ts`
   - `lib/costflow/quotationTotals.ts`
   - `lib/costflow/pairedPricing.ts`
   - `lib/costflow/reconciliation.ts`
4. **Mutation and API boundaries**
   - `app/actions/costflow.ts`
   - `app/actions/workflow.ts`
   - evidence/file/export route handlers
5. **Server data loading and authorization**
   - `lib/costflow/service.ts`
   - `app/workflow/**`
   - `app/projects/[id]/costflow/**`
6. **UI behavior and responsive flows**
   - `components/CostFlowPanel.tsx`
   - `components/CostFlowWorksheet.tsx`
   - `components/PairedQuotationIcEditor.tsx`
   - `components/InternalCostPanel.tsx`
   - `components/WorkflowPanel.tsx`
7. **Tests and operational docs**
   - `tests/**`
   - `scripts/test-costflow.mjs`
   - this PR package and release runbook

The detailed dependency map is in [COSTFLOW_WORKFLOW_ARCHITECTURE.md](../COSTFLOW_WORKFLOW_ARCHITECTURE.md).

## Validation evidence

Validated locally on Windows with Node 24.14.0, npm 11.9.0, Next.js 16.2.10, TypeScript 5.9.3, Prisma 6.19.3, and the isolated local PostgreSQL environment where required.

| Check | Result | Scope |
|---|---|---|
| `npm.cmd run test:costflow` | PASS — 140/140 | Registered unit/static CostFlow, Workflow, Excel intake/round-trip, Actual Cost, customer accounting, payment, route, and workspace coverage |
| Phase 9 suite with `--conditions=react-server` | PASS — 56/56 | SignaturePad, PIN, immutable snapshot, DIGITAL/PHYSICAL signing, print/QR/public verification, revision/reference, cash separation, and full-lifecycle contracts |
| `npx.cmd tsc --noEmit` | PASS | Current source tree |
| `npm.cmd run lint` | PASS | 0 errors; 10 non-blocking warnings recorded for reviewer follow-up |
| `npx.cmd prisma validate` | PASS | Prisma schema; Prisma 7 config deprecation warning remains informational |
| isolated `npx.cmd next build --webpack` | PASS | Direct optimized Next build in `.next.release-verify`; 23/23 static pages generated and all Phase 9 routes emitted |
| `git diff --check` | PASS | Explicit release allowlist before commit |

Important boundaries:

- The direct Next build passed; this does not claim every deployment wrapper or external provider passed.
- Node test workers and the Next build required execution outside the Windows sandbox after sandbox-only `spawn EPERM`; the same commands then passed.
- Next temporarily adds isolated build type paths to `tsconfig.json`; those generated entries were removed from the release diff after the successful build.
- Local tests/builds do not prove production database migration, real notification delivery, legal/template acceptance, or company pilot acceptance.
- Local browser evidence is partial: profile signing UI, Workflow hub, invalid public verification, and route round-trip were observed; valid signed-capability, mutation, print-preview, real-device, real-phone QR, A4, named-role, company, and production gates remain pending.

## Manual reviewer scenarios

Use only the isolated local environment on `http://localhost:3017` and the seeded admin account described in project instructions.

- [ ] Existing login, project list, project page, tasks, files, revenue, notifications, team, and admin routes still load.
- [ ] A project member can open CostFlow but cannot read another project through a forged URL.
- [ ] Create/save/reload a quotation; customer preview contains no IC/internal fields.
- [ ] Create paired quotation/IC and IC-from-quotation drafts; source quotation values remain immutable in IC mode.
- [ ] Submit an IC and process Manager/Accountant/CEO decisions with separate events.
- [ ] Confirm Manager effect and later CEO outcome display as separate axes.
- [ ] Upload/download evidence and verify unauthorized URLs do not expose bytes.
- [ ] Create a Workflow document from a published template, submit it, return/resubmit it, and inspect immutable history.
- [ ] Verify signing state is separate from approval state.
- [ ] Confirm request approval does not automatically create cash.
- [ ] Verify desktop and 390 px layouts keep all required actions reachable.

## Risks and mitigations

| Risk | Mitigation / reviewer focus |
|---|---|
| Large cross-cutting PR | Review in the dependency order above; keep schema/state invariants ahead of UI polish. |
| Additive schema touches core User/Project relations | Run migration on a restored staging snapshot and inspect relationship counts before production. |
| Approval and budget effect could be conflated | Tests and UI expose separate projections; review `icEffectiveness.ts` and approval events together. |
| Customer data leakage | Review projection allowlists, print routes, and negative tests for internal fields. |
| Concurrent decisions | Mutation version/current-attempt checks reject stale operations. |
| Windows build artifacts polluting commits | `.gitignore` and ESLint ignore all local `.next.*` and `.tmp` outputs. |
| Existing behavior regression | Smoke-test legacy TaskFlow routes before merge and after deployment. |

## Rollout recommendation

1. Review and merge only after the head branch is clean and rebased/merged with the current target branch without force-push.
2. Create a staging database backup/restore point.
3. Run `prisma migrate deploy` in staging.
4. Run automated checks and the manual smoke scenarios above against staging.
5. Obtain named business acceptance for the exact template/actor/finance cases intended for the pilot.
6. Schedule production migration with a database rollback owner and application rollback commit identified.
7. Deploy, then verify authentication, legacy TaskFlow routes, Workflow, CostFlow, file authorization, and notification health.

## Rollback summary

- **Before migration:** redeploy the previous application revision.
- **After additive migration but before feature data:** redeploy previous application only if it tolerates additive tables/columns; otherwise use the reviewed rollback plan.
- **After feature data exists:** do not drop new tables ad hoc. Disable entry points if necessary, preserve data, and restore from the approved backup or ship a compensating migration.
- Never use `prisma migrate reset` or demo seeding on production.

## PR checklist

- [ ] Target branch and merge base refreshed from remote.
- [ ] Head working tree clean; no unrelated concurrent changes included.
- [ ] Schema and migrations reviewed together.
- [ ] Authorization and customer-projection boundaries reviewed.
- [ ] Automated validation rerun on final head commit.
- [ ] Staging migration and smoke test completed.
- [ ] No `.env`, credentials, original XLSX/PDF/JPG evidence, or local build outputs included.
- [ ] Product/business acceptance items are named separately from technical checks.
- [ ] Rollout owner, migration owner, and rollback owner identified before production.

## Related documentation

- [CostFlow/Workflow architecture and review map](../COSTFLOW_WORKFLOW_ARCHITECTURE.md)
- [Release, migration, smoke-test, and rollback runbook](../COSTFLOW_WORKFLOW_RELEASE.md)
- [Workflow behavior](../WORKFLOW.md)
- [Workflow catalog/versioning](../WORKFLOW_CATALOG.md)
- [Design system](../DESIGN_SYSTEM.md)
