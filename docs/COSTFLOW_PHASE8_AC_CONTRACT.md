# Phase 8 approved-AC producer contract

Phase 7 consumes approved actual-cost facts but does not own their authoritative persistence. Production binding remains deliberately unavailable until Phase 8 implements this producer. Invoice/payment-proof completeness, an expense row, or a browser flag is never approval.

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
| `approvedAmount` | Positive integer VND actual amount approved for that line. |

The query contains `projectId`, `versionId`, `approvalEventId`, `approvalAttemptId` and unique `lineIds`. The producer must not accept browser-provided role, recipient, amount or approval status as authority. It must re-resolve all ownership and approval facts from persisted server state.

## Freshness and ownership rules

- The AC version is immutable after approval. A newer draft does not silently replace the selected approved version.
- The approval event and attempt must belong to the same Project and version, be current for that immutable submission, and represent final authoritative approval.
- Every requested stable line must belong to that version and Project. Missing, duplicated, foreign or stale lines fail the complete request; partial resolution is not allowed.
- Recipient identity comes from the approved line snapshot. Cross-recipient settlement or advance application is rejected.
- Phase 8 must define how superseded/revoked AC approval becomes unavailable without rewriting Phase 7 cash history.

## Consumer behavior already present

Phase 7 validates the producer output in `lib/costflow/approvedActualCost.ts`, calculates selected-source settlement without FIFO, and rejects cross-Project, cross-recipient, duplicate or over-consumed advance sources. The Account selects exact advance sources and amounts; evidence does not select or approve them.

The 10m advance → 8m approved actual = 2m refund and 10m → 12m = 2m additional payment cases currently have pure, test-only contract proof through `ApprovedAcConsumerFixture`. That fixture is never imported by production code.

## Required Phase 8 proof before enabling production actions

Phase 8, or a gap plan after Phase 8, owns:

1. Persisted approved AC versions, events/attempts and stable lines with the fields above.
2. A production `ApprovedActualCostConsumer` binding with transaction-safe stale and ownership checks.
3. Atomic advance application persistence and replay/concurrency protection.
4. Real refund IN and ordinary-approved additional OUT authorization and cash recording.
5. Guarded DB tests plus authenticated desktop/390px browser proof for both 10m/8m and 10m/12m flows.

Until those gates pass, `PAYMENT`, `ADVANCE_SETTLEMENT`, refund and additional-payment controls remain fail closed. Local Phase 7 tests are not evidence of company accounting acceptance, pilot acceptance, deployment or production readiness.

## PAY-06 boundary

Pre-approval payment exception is deferred. There is no Phase 7 exception model, endpoint, action, command or UI bypass. PAY-06 remains Pending and requires a future explicit policy decision before planning or implementation.
