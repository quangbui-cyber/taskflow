# Phase 15 AI release evidence

Updated: 2026-10-29. This record separates technical verification from company, pilot and production acceptance. It does not authorize deployment or processing company records with a provider.

## Acceptance matrix

| Axis | Status | Evidence or remaining decision |
| --- | --- | --- |
| `automated_local` | PASS, scoped | 40 synthetic/redacted fixtures in `tests/fixtures/ai/manifest.json`; both the offline evaluator and the hash-bound live Gemini evaluator pass. Registered unit/integration and build results are recorded below. This is not company acceptance. |
| `schema_isolation` | PASS, scoped | Phase 15 integration tests create disposable `phase15_*` schemas in the dedicated `costflow_test` database. Its public test schema was backed up to `.codex-tmp/costflow-test-before-phase15-12-20261029.dump` and synchronized to the current Prisma model after the first full integration run found missing columns. The SQL diff had no table/column/data drops. No seed/reset of the long-lived `taskflow` UI database. |
| `human_desktop_390` | ACCEPTED WITH LIMITS | Plans 15-06, 15-08, 15-09 and 15-11 checkpoints were accepted with their recorded local UI limits. Acceptance covers technical UI review only. |
| `physical_ime` | PENDING | Vietnamese IME behavior needs a physical input check; keyboard/composition handling is implemented and simulated keyboard checks passed. |
| `provider_governance` | TECHNICAL CONTROLS PASS; COMPANY DATA BLOCKED | Gemini is the selected provider and the rotated key passed the adapter and live 40-case checks. `AI_ENABLED` remains false by default. Only synthetic/redacted content is allowed until the API project is verified as paid and the company approves data categories, retention and real-record processing. See `PHASE15_PROVIDER_GOVERNANCE.md`. |
| `phoenix_hosting` | NOT REQUIRED WHILE DISABLED | Phoenix telemetry is disabled by default and is not a release dependency. Hosting/location, access and retention approval become gates only before telemetry is enabled. Phoenix traces are never the business audit trail. |
| `global_publishing_owner` | NOT_READY | Named owner and publication authority for company SOP/policy remain unresolved; publishing is disabled without configuration. |
| `named_pilot_group` | NOT_READY | Named users, pilot scope and business sign-off are pending. |
| `absolute_cost_latency` | BASELINE PASS; OWNER CAP PENDING | Live synthetic baseline: p50 2.790 s, p95 4.681 s, max 5.920 s over 36 provider calls. At the 2026-10-29 paid Standard list price for `gemini-3.8-flash`, the full run is estimated at USD 0.0206. A named budget owner must still approve the monthly cap before company-data pilot. |
| `phase14_company_acceptance` | NOT_READY | Phase 14 technical work and company acceptance are separate; no accepted company evidence is recorded here. |
| `production` | NOT_READY | No production deployment or authenticated production workflow verification was performed in this phase. |
| `legal_compliance_freshness` | PENDING | Current privacy, tax and retention requirements need review by the responsible company roles before provider-backed pilot/release. |

Latest Gemini connectivity check (2026-10-29): the three-ID sanitized Promptfoo smoke passed 3/3 against `gemini-3.8-flash` with schema-constrained JSON and 239 total tokens. No company content was sent.

Latest application-adapter check (2026-10-29): the real `GeminiGenerationModel` extracted the synthetic `vendor` and `amount` candidates, returned a provider request ID, preserved exact authorized provenance, marked both candidates for human review, and reported 329 total tokens. The rotated key was then accepted by a fresh adapter request.

Latest hash-bound provider evaluation (2026-10-29): manifest SHA-256 `fc553f44a424ec6d437826030ed7a35652434fb200af2ffb1dae0db116ca55ac`; 40 cases; 36 provider calls; 4 authorization cases skipped before provider access; no provider failures; precision 1.00 and recall 1.00 against the labeled suspicion cases. Latency was 1.752 s minimum, 2.790 s p50, 4.681 s p95 and 5.920 s maximum. Usage was 8,793 input and 3,730 output tokens (12,523 total). The ignored result file stores only hashes, flags, usage and latency, never prompts, outputs or the key. This remains synthetic technical evidence only.

## Offline evaluation

The `15-12-v1` manifest has exactly 40 cases: 10 clean, 8 numeric, 8 version/lineage, 6 retrieval/question-answer, 5 permission/adversarial and 3 operational. Each case includes a content hash, exact span, actor scope, expected result and prohibited authority mutations. The offline evaluator uses the actual deterministic finance rule function for 16 numeric/version cases and checks a synthetic lexical top-six retrieval benchmark. These scores demonstrate the fixture contract; they do not measure production retrieval or provider accuracy.

Latest focused result: 40/40 manifest integrity; 45/45 critical authority/permission gates; 16/16 deterministic rule cases; synthetic retrieval recall@6 1.00 and precision@6 1.00; unauthorized chunks and claims 0; live provider model-flag precision 1.00 and recall 1.00. The release thresholds (precision ≥ 0.80, recall ≥ 0.90) pass for this exact synthetic manifest. OCR stays a manual/incomplete fallback unless separately approved.

| Check | Result |
| --- | --- |
| `npm run test:ai-evals` | PASS on synthetic 40-case manifest; see command output for manifest SHA-256 |
| `npm run test:costflow -- --unit` | PASS: 266 passed, 0 failed |
| `npm run test:costflow -- --integration` | PASS: complete registered unit/integration runner, including provider adapter, extraction, review, retrieval, findings, Excel mapping and cited assistant; final summary 19/19 Phase 12 wrapper tests and all subsequent registered suites passed, with one intentional legacy skip |
| `npx tsc --noEmit` | PASS after Plan 15-12 code changes |
| `npx eslint scripts/ai-evals/provider.ts tests/ai-provider-eval.test.ts scripts/test-costflow.mjs` | PASS. Full-repository lint remains polluted by existing generated `.open-next/` output and unrelated legacy findings; no generated artifact was edited or deleted. |
| `npm run build:app` | PASS in separate local output directory `.next.phase15-final`; compilation, TypeScript, 41-page static generation and trace collection completed. Existing warnings remain for `unpdf` import.meta and two generated CSS empty selectors. No production deploy. |
| `npm audit --omit=dev` | 0 critical; 6 advisories remain in two upstream families with no safe current upgrade. See `PHASE15_DEPENDENCY_AUDIT.md`. |

## Provider regression and secret handling

`scripts/ai-evals/promptfooconfig.yaml` is an opt-in Gemini contract smoke using only synthetic fixture IDs. It is excluded from default unit/integration commands. For the approved synthetic/redacted check, supply `GEMINI_API_KEY` through the process environment and run `npx promptfoo eval -c scripts/ai-evals/promptfooconfig.yaml`. Never put keys, internal document bytes, bank/tax/personal values or unmasked workbook data in config, fixtures, command output or telemetry. A successful provider smoke is not an extraction/QA quality score and does not authorize company records.

Run `npm run test:ai-evals:provider` only with a rotated key in the process environment. It calls Gemini only for authorized synthetic cases and writes an ignored, content-free result file. Then set `AI_EVAL_PROVIDER_RESULTS_FILE` to that file and run `npm run test:ai-evals`. The evaluator binds results to the exact manifest hash and fails below precision 0.80 or recall 0.90. No provider score is inferred when that file is absent.

## Monitoring and stop conditions

Operational tracing allows only hashed IDs, counts, usage, versions, failure codes and latency; model inputs, outputs, prompts and embedding vectors are hidden. Business decisions and immutable source/application receipts remain in the application records, not Phoenix. Immediately disable the AI feature and investigate if any unauthorized content is returned, an AI path mutates approval/payment/cash/signature/close authority, an accepted source hash or version mismatches, or a duplicate payable/cash effect appears. Preserve the affected run, citation and receipt IDs for investigation without logging source contents.
