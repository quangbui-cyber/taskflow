# Phase 8 approved-AC producer contract

Phase 7 consumes approved actual-cost facts but does not own their authoritative persistence. Phase 8 now provides the production DB binding over normalized AC lines, immutable versions and DD approval decisions. Invoice/payment-proof completeness, a legacy expense row, or a browser flag is never approval.

## Producer output

`ApprovedActualCostConsumer.resolveApprovedLines(query)` must resolve only immutable, authority-backed rows matching every requested field:

| Field | Required meaning |
|---|---|
| `projectId` | Exact owning Project; cross-Project resolution is forbidden. |
| `versionId` | Immutable AC version selected for settlement. A mutable draft ID is invalid. |
| `approvalEventId` | Durable approval event that made this AC version effective for consumption. |
| `approvalAttemptId` | Exact submission/approval attempt; an event from an older attempt is stale. |
| `approvalState` | Literal `APPROVED`; returned, rejected, withdrawn, cancelled or draft data is invalid. |
| `stableLineId` | Stable AC line identity inside the immutable version. All requested IDs must resolve exactly once. |
| `recipientKey` | Authoritative employee/vendor recipient for the approved actual line. |
| `fundingSource` | Persisted funding route: employee/vendor advance, employee out-of-pocket or vendor payment. |
| `approvedAmount` | Positive integer VND actual amount approved for that line. |

The query accepts the original shared tuple (`versionId`, `approvalEventId`, `approvalAttemptId`, unique `lineIds`) and the backward-compatible per-line `lineRefs` form for lines approved independently. The producer does not accept browser-provided role, recipient, amount, funding route or approval status as authority; all facts are re-resolved from persisted server state.

## Freshness and ownership rules

- The AC version is immutable after approval. A newer draft does not silently replace the selected approved version.
- The approval event and attempt must belong to the same Project and version, be current for that immutable submission, and represent final authoritative approval.
- Every requested stable line must belong to that version and Project. Missing, duplicated, foreign or stale lines fail the complete request; partial resolution is not allowed.
- Recipient identity comes from the approved line snapshot. Cross-recipient settlement or advance application is rejected.
- A submitted settlement creates an `ActualCostApplication`. Active applications lock resubmission and evidence mutation; a valid withdrawal or approved no-cash cancellation releases the lock without rewriting cash history.

## Implemented consumer behavior

The production resolver in `lib/costflow/approvedActualCost.ts` requires an exact Project/line/version/event/attempt match and a persisted `APPROVED` version. Partial, legacy, draft, returned, stale and duplicated sets fail atomically.

Settlement re-resolves Account-selected advance line IDs, gross OUT cash and previously applied amounts in the same serializable transaction. It does not apply FIFO. Employee/vendor advances require explicit eligible sources; employee out-of-pocket routes to reimbursement/additional OUT; vendor-payment AC routes to the vendor obligation. Creating or approving AC and creating a settlement request never imply cash or financial close.

Refund IN and additional OUT are authorized only against the exact server-derived obligation. The 10m advance → 8m approved actual = 2m refund and 10m → 12m = 2m additional-payment paths are covered by guarded DB integration tests using persisted AC approvals, advance lines, cash allocations and application locks. `ApprovedAcConsumerFixture` remains test-only and is not imported by production code.

## Verification boundary

This is local technical evidence only. It does not establish authenticated desktop/390px acceptance, company accounting acceptance, pilot acceptance, deployment or production readiness. Those remain separate Phase 8 verification and human-acceptance gates.

## PAY-06 boundary

Pre-approval payment exception is deferred. There is no Phase 7 exception model, endpoint, action, command or UI bypass. PAY-06 remains Pending and requires a future explicit policy decision before planning or implementation.
