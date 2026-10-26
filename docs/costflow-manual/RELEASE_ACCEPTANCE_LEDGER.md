# Release and Acceptance Ledger

## Decision boundary

- `RELEASE_VERDICT: NOT_READY`
- `LEDGER_STATUS: human_needed`
- Updated: `2026-10-26`
- Technical automation, authenticated smoke, native-file review, company acceptance and production acceptance are separate evidence classes. A pass in one class never fills another.
- This ledger is an index. Exact evidence remains in the linked phase verification, evidence index and sign-off records; no agent-generated row is a human signature.

## Consolidated status

| Scope | Automated local | Authenticated local | Authenticated production | Native / physical | Company acceptance | Current decision |
|---|---|---|---|---|---|---|
| Phase 3.1 — PAIR-01..23 | `PASS` at app commit `7cd812d` | `PENDING` for exact role flow | `PENDING` | `PENDING` for 390px, IME and real workbook | `PENDING` | `human_needed` |
| Phase 5 — APR-01..08 | `PASS` on 2026-10-26, 17/17 focused checks | `PENDING` | `PENDING` | n/a | `PENDING` | `human_needed` |
| Phase 8 — CST-01..05 / Bảng AC | `PASS` for the registered contract and integration scope; direct sheet suite remains disposable-schema-only | `PENDING` | `PENDING` in the combined batch below | `PENDING` for native XLSX/PDF reconciliation | `PENDING` | `human_needed` |
| Phase 10 — SET-01..06 | `PASS` on 2026-10-26 after Plan 10-17 restored the composite dossier-version/Project FK and registered its verifier | `PENDING` | `PENDING` | `PENDING` for all six native XLSX/PDF families | `PENDING` | `human_needed` |
| Phase 12 — CFP-01..03 / Plan 08 | release packet and fail-closed gate exist; final rerun recorded in `12-08-SUMMARY.md` | prior read-only local smoke only | `PENDING` | `PENDING` | four named sign-offs `PENDING` | `NOT_READY` |
| Phase 14 — SUP/VAT | automated technical closure recorded by Phase 14 | `PENDING` | `PENDING` in the combined batch below | n/a unless an exported file is inspected | `PENDING` | `human_needed` |

## One combined authenticated production confirmation batch

The Bảng AC and Phase 14 checks must be performed in one authorized, read-only-first production session against the exact deployed revision. Do not seed, reset, migrate, approve, pay, close, or alter a real financial record merely to create evidence.

| Batch ID | Check | Required actor/session | Evidence to record | Status |
|---|---|---|---|---|
| `PROD-AC14-01` | Identify production URL, deployment revision and migration state | authorized Admin/ops | URL, revision, observation time, non-secret migration record | `PENDING` |
| `PROD-AC14-02` | Open a populated Bảng AC and verify sheet totals, version/attempt identity, DD authority and no per-line approval path | authorized finance member and assigned DD | project/sheet/version IDs, role, screenshots or hashes with private values redacted | `PENDING` |
| `PROD-AC14-03` | Verify supplier directory read scope and exact supplier identity reuse | authorized company member | supplier IDs and route response/UI evidence without bank details | `PENDING` |
| `PROD-AC14-04` | Verify post-AC VAT ĐNTT remains bound to approved AC and supplier invoice identity | authorized Accountant/DD | request/source/AC/invoice IDs and state tuple; no new payment authorization | `PENDING` |
| `PROD-AC14-05` | Verify outsider/incorrect-role denial and private-field redaction | session with permitted test identity only | HTTP/UI denial evidence; no production credential disclosure | `PENDING` |
| `PROD-AC14-06` | Record company acceptance separately from technical smoke | named company reviewer(s) | explicit decision, evidence IDs and timestamp entered by the human reviewer | `PENDING` |

A Chrome window titled `myCreative — Quản lý công việc` was visible in the desktop inventory, but browser control is disabled in Work settings and the read-only window-observation approval timed out. Its URL, actor and authentication state could not be verified. No production credential was supplied, so this batch is prepared but not represented as executed.

## Phase 12 release sign-off

The canonical named-role form remains `RELEASE_SIGN_OFF.md`. `EV-SIGN-HUY`, `EV-SIGN-QUANG`, `EV-SIGN-UYEN` and `EV-SIGN-SON` remain `PENDING`. The Phase 12 production evidence slot `EV-PROD-01` also remains `PENDING`, even if a separate Phase 14 deployment record exists.

## Phase 11 lock

- `PHASE_11_STATUS: LOCKED_PENDING_DIRECT_CONFIRMATION`
- Do not plan or implement OPS-01..04 until both items are directly confirmed:
  1. the exact actor(s) allowed to mark post-approval execution complete, including delegate/admin behavior;
  2. the company calendar and reminder schedule, including workdays, holidays, send time, overdue cadence and escalation recipient.
- Existing Phase 11 context values are proposals, not accepted decisions.

## Promotion rule

`RELEASE_VERDICT` may become `READY` only when all applicable production/native/company slots contain exact evidence and each named human fills their own sign-off row. Until then it remains `NOT_READY`.
