# CostFlow v1.0 Release Sign-off Charter

## Current decision

- `RELEASE_VERDICT: NOT_READY`
- `PHASE_STATUS: human_needed`
- Evidence index: `PHASE12_EVIDENCE_INDEX.md`
- Rule: mọi criterion `GL-01`…`GL-05` phải có exact evidence; tất cả bốn người phải tự xác nhận. Automation/agent không được ký, điền thời gian hoặc đổi `PENDING`.

## Five-criterion decision form

| ID | Criterion | Evidence IDs | Status |
|---|---|---|---|
| `GL-01` | 100% applicable suites và production build pass | `EV-AUTO-05`, `EV-PROD-01` | `PENDING` |
| `GL-02` | DB/UI/6 XLSX-PDF reconcile đúng 0 VND | `EV-PILOT-01`, `EV-NATIVE-01`, `EV-NATIVE-02` | `PENDING` |
| `GL-03` | không lộ giá vốn, không bypass PIN/signing | `EV-AUTO-03`, `EV-NATIVE-02`, `EV-PILOT-02` | `PENDING` |
| `GL-04` | blocking issues = 0 | `EV-PILOT-03`, `EV-PROD-01` | `PENDING` |
| `GL-05` | đủ bốn quyết định độc lập | bốn `EV-SIGN-*` | `PENDING` |

## Named-role slots — only the named human may fill their row

| Evidence slot | Người / vai trò | Decision | Exact evidence IDs | Signature identity/hash | Observed at/environment |
|---|---|---|---|---|---|
| `EV-SIGN-HUY` | Võ Phạm Trọng Huy — Account/Creator | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| `EV-SIGN-QUANG` | Bùi Duy Quang — Manager | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| `EV-SIGN-UYEN` | Đỗ Vũ Phương Uyên — Accountant/Cashier | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| `EV-SIGN-SON` | Đoàn Thái Sơn — CEO/DD | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

## Required attachment record

Khi review thật diễn ra, mỗi quyết định phải trỏ: project ID, CostFlow version, request/attempt, source manifest/hash, 12 artifact identities/hashes, device/browser/native app version, environment, issue register và production change record (nếu có). Không dán PIN, password, token hoặc bank account.

Company/pilot decision và production decision là hai quyết định riêng. Nếu production chưa được chạy, `EV-PROD-01` và release vẫn `PENDING`/`NOT_READY` dù company pilot đã đạt.
