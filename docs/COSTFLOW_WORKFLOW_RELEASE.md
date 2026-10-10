# CostFlow & Workflow release runbook

This runbook separates source readiness, staging validation, business acceptance, and production release. A green local build is necessary but is not authorization to migrate or deploy production.

## Roles required

Assign named owners before production:

| Responsibility | Named owner |
|---|---|
| Merge/release coordinator |  |
| Database migration and restore |  |
| CostFlow business acceptance |  |
| Workflow template/legal acceptance |  |
| Security/authorization review |  |
| Smoke-test operator |  |
| Rollback decision |  |

Do not proceed with unnamed migration or rollback ownership.

## 1. Final branch gate

- [ ] Refresh remote target branch.
- [ ] Confirm the PR head is clean and contains no unrelated local work.
- [ ] Review `git diff --check` and the final PR file list.
- [ ] Confirm no `.env`, credentials, original XLSX/PDF/JPG evidence, `.next.*`, `.tmp`, or local database files are included.
- [ ] Run:

```powershell
npm.cmd run test:costflow
node --conditions=react-server --import=tsx --test tests/signature-pad.test.tsx
node --conditions=react-server --import=tsx --test tests/workflow-profile-signature.test.ts tests/workflow-approved-snapshot.test.ts tests/workflow-digital-sign.integration.test.ts tests/workflow-print-layout.test.ts tests/workflow-qr-roundtrip.test.ts tests/workflow-public-verification.test.ts tests/workflow-paper-sign.integration.test.ts tests/workflow-revision.integration.test.ts tests/workflow-signing-security.test.ts tests/workflow-phase9-full.integration.test.ts
npx.cmd tsc --noEmit
npm.cmd run lint
npx.cmd prisma validate
npx.cmd next build --webpack
```

The Phase 9 component/lifecycle suites require the `react-server` condition because the codebase intentionally uses `server-only`. Treat omission of that condition as a command defect, not a reason to bypass the guard.

Use process-scoped local environment values for validation. Never write validation secrets into repository files.

## 2. Database preflight

The release contains these migrations:

```text
20261002040000_costflow_standard_workflow
20261002060000_workflow_templates_documents
20261002080000_workflow_catalog
20261002090000_workflow_requirements
20261003050000_approval_provenance
20261005180000_quotation_reuse_templates
20261007090000_add_meetings
20261008140000_phase7_payment_dossier_lines
20261009_phase8_actual_cost_authority
20261010_phase9_approved_signing
20261010_phase9_physical_scans
20261010_phase9_public_verification
20261010_phase9_revision_guard
20261010_phase9_signature_assets
20261010_phase9_signing_event_preapproval
```

Before staging or production migration:

- [ ] Verify the target `DATABASE_URL` environment without printing it.
- [ ] Confirm the migration table and current migration head.
- [ ] Capture database size and counts for User, Project, ProjectMember, ProjectFile, Task, Notification, and existing migration rows.
- [ ] Create a tested backup or point-in-time restore checkpoint.
- [ ] Confirm the previous application version can tolerate additive schema if application rollback is needed.
- [ ] Review migration locks/runtime against the target PostgreSQL service.

Never run `prisma migrate reset`, development migration generation, or demo seed mode on production.

## 3. Staging migration

Use a production-like restored staging database:

```powershell
npx.cmd prisma migrate deploy
```

Then verify:

- [ ] all fifteen feature-branch migrations are recorded once and in order;
- [ ] existing User/Project/member/task/file counts are unchanged;
- [ ] new tables and constraints exist;
- [ ] no orphaned project/user relationships were created;
- [ ] existing login and legacy TaskFlow screens still work;
- [ ] quotation-template seed is run only if explicitly approved, using `npm.cmd run seed:quotation-templates`;
- [ ] seed rerun is idempotent in staging before considering production.

## 4. Staging smoke tests

### Existing TaskFlow

- [ ] Login/logout and session invalidation.
- [ ] Project list/detail and membership boundaries.
- [ ] Task create/update/move and notifications.
- [ ] Project/task file download authorization.
- [ ] Revenue, team, recognition, and Admin pages.

### CostFlow

- [ ] Open authorized project CostFlow; forged project URL is rejected.
- [ ] Create, save, reload, preview, and print a customer quotation.
- [ ] Confirm customer output excludes IC/internal evidence/supplier details.
- [ ] Create paired and IC-from-quotation drafts.
- [ ] Download the Excel template, reject invalid/MIME-mismatched files, preview a valid workbook, confirm it once, and prove replay/stale-source attempts fail closed.
- [ ] Export a draft round-trip workbook, preview a deterministic diff, apply selected changes atomically, and verify stable row identity after row moves.
- [ ] Submit IC and process assigned approval steps.
- [ ] Verify Manager budget effect and later approval outcome are shown independently.
- [ ] Upload/download evidence and reject forged evidence URLs.
- [ ] Compare IC against normalized Actual Cost, exercise the Account/self/DD-accountant/Project-Operation lenses, and confirm filtered totals do not leak hidden rows.
- [ ] Approve one exact AC tuple and verify settlement consumes only that Project/version/stable-line/event/attempt tuple.
- [ ] Freeze customer liquidation/AR/margin and inspect customer-safe PDF/XLSX outputs for internal-field leakage.
- [ ] Create an expense/request without automatically creating cash.
- [ ] Record cash only through the explicit authorized action.
- [ ] Exercise close/reopen guards with history preserved.

### Workflow

- [ ] Create/confirm/publish a template using staging-only content.
- [ ] Create a document and fill required slots.
- [ ] Submit, return with corrections, resubmit, approve, and inspect history.
- [ ] Verify same-person multi-role steps remain separate.
- [ ] Verify Admin cannot approve without assignment.
- [ ] Upload signed evidence and confirm signing remains separate from approval.
- [ ] Create/replace/delete the current user's saved signature and exercise the six-digit PIN/password reset gate without logging credentials or signature bytes.
- [ ] Complete four ordered DIGITAL signatures and confirm no cash row is created.
- [ ] Upload/return/re-upload/confirm a PHYSICAL scan batch and verify private downloads re-authorize.
- [ ] Print an approved snapshot, scan its QR, verify the public allowlist, and confirm tampered/revoked/replaced/invalid tokens expose no private rejection reason.
- [ ] Revise an approved document, add a reference file, and confirm the old snapshot remains readable until the new CEO-approved snapshot replaces it.
- [ ] Verify authorized and unauthorized file access.

### UI

- [ ] Desktop primary flows.
- [ ] 390 px primary flows with no lost actions.
- [ ] Keyboard navigation, focus restoration, error summaries, and dialog escape behavior.
- [ ] Vietnamese text entry/IME on an actual supported browser/device.
- [ ] Signature drawing/clearing on a real touch or stylus device without scroll conflict.
- [ ] Physical A4 print inspection for page breaks, amounts, four signature blocks, QR legibility, and scanability on a real phone.

## 5. Business acceptance gate

Technical checks do not satisfy this gate. Obtain explicit approval for:

- finance formulas and example cases;
- named role assignments and separation of duties;
- exact Workflow template content and required documents;
- signature/custody procedure;
- signing-IP retention duration and purge authority (or an explicit manual/indefinite retention decision);
- evidence retention/access policy;
- pilot project and pilot users;
- production notification destinations;
- close/reopen and exception handling.

Record accepted cases and unresolved exceptions in the release ticket/PR.

## 6. Production deployment

1. Announce the change window and pause conflicting schema/data administration.
2. Confirm backup/restore checkpoint and rollback owner.
3. Deploy migrations with `prisma migrate deploy` through the approved production mechanism.
4. Deploy the reviewed application commit.
5. Do not run demo seeding. Run quotation-template seeding only when separately approved.
6. Execute the production smoke subset using dedicated authorized accounts and non-sensitive pilot data.
7. Monitor application errors, database locks/connections, authorization failures, file endpoints, and notification delivery.

## 7. Production smoke subset

- [ ] Existing login and one legacy Project/Task flow.
- [ ] Existing file download for an authorized member.
- [ ] CostFlow page read for one pilot project.
- [ ] Save/reload one draft without approval or cash side effects.
- [ ] Workflow inbox and one staging-approved template read.
- [ ] Negative authorization check using a non-member test account.
- [ ] Notification intent/transport health without sending to unintended recipients.

Stop the rollout if authorization, data integrity, existing TaskFlow behavior, or migration state is uncertain.

## 8. Rollback decision tree

### Application fails before migrations

Redeploy the previous application revision. No database rollback is required.

### Application fails after additive migrations but before feature data

If the previous application has been verified against the additive schema, redeploy it and keep the new tables unused while investigating. Do not drop tables during the incident.

### Feature data has been written

Prefer disabling feature entry points and preserving data. Ship a reviewed corrective migration/application patch. If integrity or confidentiality is at risk, invoke the database restore plan owned by the migration owner.

### Migration is partial or inconsistent

Stop application writes, capture logs and migration-table state, and restore from the approved checkpoint or apply a reviewed compensating migration. Never improvise destructive SQL or run `prisma migrate reset`.

## 9. Post-release evidence

Attach to the release record:

- deployed commit SHA;
- migration output and final migration head;
- backup/restore checkpoint identifier;
- smoke-test operator, time, and results;
- business acceptance references;
- known limitations and deferred items;
- incidents/rollback actions, if any.

Local validation, staging acceptance, company acceptance, and production verification must remain separately labeled.
