# Phase 12 Evidence Index

## Provenance vocabulary

- `automated_local`: test/build trong `costflow_test` hoặc process cục bộ.
- `browser_local`: authenticated read-only trên `localhost:3017` với DB `taskflow`.
- `native_human`: người thật quan sát Excel/PDF/A4/QR, thiết bị và IME native.
- `company_pilot`: Project đại diện và quyết định của vai trò công ty.
- `production`: target deployment/migration/backup/smoke/monitoring thực tế.

Không provenance thấp nào tự lấp slot provenance cao hơn.

## Exact evidence records

| Evidence ID | Provenance | Requirement / criterion | Exact reference | Status |
|---|---|---|---|---|
| `EV-AUTO-01` | `automated_local` | CFP-01 lifecycle/lineage | `12-02-SUMMARY.md`, app commits `f3defc9`, `952dcf8` | `PASS_LOCAL` |
| `EV-AUTO-02` | `automated_local` | CFP-02 negative/correction | `12-03-SUMMARY.md`, app commit `c4d2cf7` | `PASS_LOCAL` |
| `EV-AUTO-03` | `automated_local` | six export families, QR/privacy | `12-04-SUMMARY.md`, app commit `05d9c18` | `PASS_LOCAL` |
| `EV-AUTO-04` | `automated_local` | performance/continuous scroll | `12-05-SUMMARY.md`, app commit `018d20f` | `PASS_LOCAL` |
| `EV-AUTO-05` | `automated_local` | CFP-03 regression/build | `12-VALIDATION.md` Plan 12-06 ledger, app commit `8088490` | `PASS_LOCAL` |
| `EV-BROWSER-01` | `browser_local` | login/revenue/project/CostFlow render | `12-VALIDATION.md` Plan 12-06 routes | `PASS_LOCAL` |
| `EV-DOC-01` | `automated_local` | operating docs and anti-claim checker | `12-07-SUMMARY.md`, app commit `77d312e` | `PASS_LOCAL` |
| `EV-NATIVE-01` | `native_human` | six XLSX native Excel recalculation/rounding | exact artifact IDs/hashes not yet recorded | `PENDING` |
| `EV-NATIVE-02` | `native_human` | six PDF/A4/signatures/QR | exact artifact IDs/hashes not yet recorded | `PENDING` |
| `EV-NATIVE-03` | `native_human` | physical 390px/touch/keyboard/Escape/focus/IME | device/browser/observer not yet recorded | `PENDING` |
| `EV-PILOT-01` | `company_pilot` | CFP-01 representative Project + DB/UI/file balance | project/version/attempt/manifest/hash not yet recorded | `PENDING` |
| `EV-PILOT-02` | `company_pilot` | CFP-02 named-role edge decisions | actor/decision IDs not yet recorded | `PENDING` |
| `EV-PILOT-03` | `company_pilot` | blocking issues = 0 | issue register and owners not yet recorded | `PENDING` |
| `EV-SIGN-HUY` | `company_pilot` | Account decision | Huy evidence/signature slot | `PENDING` |
| `EV-SIGN-QUANG` | `company_pilot` | Manager decision | Quang evidence/signature slot | `PENDING` |
| `EV-SIGN-UYEN` | `company_pilot` | Accountant/Cashier decision | Uyên evidence/signature slot | `PENDING` |
| `EV-SIGN-SON` | `company_pilot` | CEO decision | Sơn evidence/signature slot | `PENDING` |
| `EV-PROD-01` | `production` | backup/migration/deployment/smoke | `PRODUCTION_READINESS_RUNBOOK.md`; target evidence absent | `PENDING` |

## Five go-live criteria

| Criterion | Required evidence slots | Current verdict |
|---|---|---|
| `GL-01` 100% applicable suites and production build pass | `EV-AUTO-05` plus target `EV-PROD-01` | `PENDING` — local pass, target absent |
| `GL-02` Database/UI/six export families reconcile to exactly 0 VND | `EV-PILOT-01`, `EV-NATIVE-01`, `EV-NATIVE-02` | `PENDING` |
| `GL-03` no internal cost leak and no PIN/signing bypass | `EV-AUTO-03`, `EV-NATIVE-02`, `EV-PILOT-02` | `PENDING` |
| `GL-04` blocking issues = 0 | `EV-PILOT-03`, `EV-PROD-01` | `PENDING` |
| `GL-05` four independent named decisions | `EV-SIGN-HUY`, `EV-SIGN-QUANG`, `EV-SIGN-UYEN`, `EV-SIGN-SON` | `PENDING` |

## Requirement verdicts

- `CFP-01`: `PENDING` — automated lifecycle exists; representative company Project/native reconciliation absent.
- `CFP-02`: `PENDING` — automated edge cases exist; named-role direct observation absent.
- `CFP-03`: `PENDING` — local regression/build/browser evidence exists; production and four-party decision absent.
- Release: `NOT_READY`.
- Phase status: `human_needed`.
