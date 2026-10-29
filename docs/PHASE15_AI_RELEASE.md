# Phase 15 AI release evidence

Updated: 2026-10-29. This record separates technical verification from company, pilot and production acceptance. It does not authorize deployment or processing company records with a provider.

## Acceptance matrix

| Axis | Status | Evidence or remaining decision |
| --- | --- | --- |
| `automated_local` | PASS, scoped | 40 synthetic/redacted fixtures in `tests/fixtures/ai/manifest.json`; `npm run test:ai-evals` checks hash, spans, authorization and deterministic rules. Registered unit/integration and build results are recorded below. This is not a provider quality or company acceptance result. |
| `schema_isolation` | PASS, scoped | Phase 15 integration tests create disposable `phase15_*` schemas in the dedicated `costflow_test` database. Its public test schema was backed up to `.codex-tmp/costflow-test-before-phase15-12-20261029.dump` and synchronized to the current Prisma model after the first full integration run found missing columns. The SQL diff had no table/column/data drops. No seed/reset of the long-lived `taskflow` UI database. |
| `human_desktop_390` | ACCEPTED WITH LIMITS | Plans 15-06, 15-08, 15-09 and 15-11 checkpoints were accepted with their recorded local UI limits. Acceptance covers technical UI review only. |
| `physical_ime` | PENDING | Vietnamese IME behavior needs a physical input check; keyboard/composition handling is implemented and simulated keyboard checks passed. |
| `provider_governance` | PARTIAL, NOT_READY FOR COMPANY DATA | Gemini is the user-selected Phase 15 provider and the app has an explicit `gemini-3.8-flash` adapter/config path. The key may be used only for synthetic/redacted verification until data categories, retention, security terms and real-record processing are approved. |
| `phoenix_hosting` | NOT_READY | Hosting/location, access and retention for redacted telemetry need company approval. Phoenix operational traces are not a business audit trail. |
| `global_publishing_owner` | NOT_READY | Named owner and publication authority for company SOP/policy remain unresolved; publishing is disabled without configuration. |
| `named_pilot_group` | NOT_READY | Named users, pilot scope and business sign-off are pending. |
| `absolute_cost_latency` | NOT_READY | Absolute spend and latency limits for provider-backed use have not been approved. The offline timings below do not substitute for a provider budget or SLA. |
| `phase14_company_acceptance` | NOT_READY | Phase 14 technical work and company acceptance are separate; no accepted company evidence is recorded here. |
| `production` | NOT_READY | No production deployment or authenticated production workflow verification was performed in this phase. |
| `legal_compliance_freshness` | PENDING | Current privacy, tax and retention requirements need review by the responsible company roles before provider-backed pilot/release. |

Latest Gemini connectivity check (2026-10-29): the three-ID sanitized Promptfoo smoke passed 3/3 against `gemini-3.8-flash` with schema-constrained JSON and 239 total tokens. No company content was sent. This verifies key/model connectivity and the synthetic response contract only; extraction/Q&A quality, the hash-bound 40-case provider score and company-data governance remain unverified.

## Offline evaluation

The `15-12-v1` manifest has exactly 40 cases: 10 clean, 8 numeric, 8 version/lineage, 6 retrieval/question-answer, 5 permission/adversarial and 3 operational. Each case includes a content hash, exact span, actor scope, expected result and prohibited authority mutations. The offline evaluator uses the actual deterministic finance rule function for 16 numeric/version cases and checks a synthetic lexical top-six retrieval benchmark. These scores demonstrate the fixture contract; they do not measure production retrieval or provider accuracy.

Latest focused result: 40/40 manifest integrity; 45/45 critical authority/permission gates; 16/16 deterministic rule cases; synthetic recall@6 1.00 and precision@6 1.00; unauthorized chunks and claims 0. Provider model-flag precision/recall are `NOT_MEASURED_OFFLINE`. The release thresholds (precision ≥ 0.80, recall ≥ 0.90) remain **NOT_READY** until an approved, labeled provider run measures them. OCR stays a manual/incomplete fallback unless separately approved.

| Check | Result |
| --- | --- |
| `npm run test:ai-evals` | PASS on synthetic 40-case manifest; see command output for manifest SHA-256 |
| `npm run test:costflow -- --unit` | PASS: 261 passed, 0 failed in 37.5 s with provider key and Phoenix endpoint unset |
| `npm run test:costflow -- --integration` | PASS: 313 passed, 0 failed, 2 intentional skips; 246.3 s after `costflow_test` schema sync |
| `npx tsc --noEmit` | PASS after Plan 15-12 code changes |
| `npm run build:app` | PASS in a separate local output directory. Webpack warned about `unpdf` import.meta and retried one socket connection; compilation, TypeScript, static generation and trace collection completed. No production deploy. |

## Provider regression and secret handling

`scripts/ai-evals/promptfooconfig.yaml` is an opt-in Gemini contract smoke using only synthetic fixture IDs. It is excluded from default unit/integration commands. For the approved synthetic/redacted check, supply `GEMINI_API_KEY` through the process environment and run `npx promptfoo eval -c scripts/ai-evals/promptfooconfig.yaml`. Never put keys, internal document bytes, bank/tax/personal values or unmasked workbook data in config, fixtures, command output or telemetry. A successful provider smoke is not an extraction/QA quality score and does not authorize company records.

For an approved 40-case model-flag run, normalize results to `{ "manifestHash": "...", "flags": [{ "id": "...", "flagged": true }] }` with one row per manifest ID, then set `AI_EVAL_PROVIDER_RESULTS_FILE` for `npm run test:ai-evals`. The evaluator binds results to the exact manifest hash and fails below precision 0.80 or recall 0.90. No provider score is inferred when that file is absent.

## Monitoring and stop conditions

Operational tracing allows only hashed IDs, counts, usage, versions, failure codes and latency; model inputs, outputs, prompts and embedding vectors are hidden. Business decisions and immutable source/application receipts remain in the application records, not Phoenix. Immediately disable the AI feature and investigate if any unauthorized content is returned, an AI path mutates approval/payment/cash/signature/close authority, an accepted source hash or version mismatches, or a duplicate payable/cash effect appears. Preserve the affected run, citation and receipt IDs for investigation without logging source contents.
