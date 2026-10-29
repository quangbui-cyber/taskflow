# Phase 15 Gemini provider governance

Updated: 2026-10-29. This is an engineering control record, not legal or company approval.

## Current operating boundary

- `AI_ENABLED` is false unless explicitly enabled. Key presence alone cannot enable AI.
- The rotated Gemini key passed sanitized connectivity, the application adapter and the hash-bound 40-case synthetic evaluation. The key is local-only and must never be committed, logged or placed in fixtures.
- Until the API project is verified as a paid service and the responsible company roles approve the data categories, only synthetic or irreversibly redacted content may be sent.
- Do not send names, email addresses, phone numbers, tax identifiers, bank details, signatures, confidential contract text, internal pricing, original files or other company/personal data under the current gate.
- The integration uses `generateContent`; it does not use Gemini File API, Interactions API, Live API, context caching, Maps grounding or log sharing/datasets.
- Phoenix telemetry is disabled by default. If later enabled, only allowlisted hashes, counts, versions, failure codes, token usage and latency may leave the app; never prompts, responses, document text or embeddings.

## Provider terms snapshot

Official Google sources reviewed on 2026-10-29:

- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API Additional Terms: https://ai.google.dev/gemini-api/terms
- Zero data retention guidance: https://ai.google.dev/gemini-api/docs/zdr
- Abuse monitoring: https://ai.google.dev/gemini-api/docs/usage-policies

Engineering consequence: unpaid Gemini API content may be used to improve Google products and may be reviewed; it must not receive sensitive, confidential or personal information. Paid Services do not use prompts/responses to improve products, but abuse-monitoring and operational data handling still apply. Billing status and applicable terms must therefore be verified before any company-data pilot; engineering cannot infer this from a successful API request.

## Measured synthetic baseline

The exact 40-case manifest produced 36 provider calls and skipped four unauthorized cases before provider access. Precision and recall were both 1.00. Latency was 2.790 s p50, 4.681 s p95 and 5.920 s max. Usage was 8,793 input tokens and 3,730 output tokens.

At the official 2026-10-29 paid Standard price for `gemini-3.8-flash` (USD 0.75 per million input tokens and USD 3.75 per million output tokens), the run is estimated at USD 0.0206, about USD 0.00057 per provider call. This is a test estimate, not an approved budget or future price guarantee.

## Gates before company-data pilot

The following require named human owners and cannot be self-certified by code:

1. Confirm the API project is a Paid Service and record the billing/project owner.
2. Approve allowed/prohibited data categories, retention posture and applicable privacy/legal terms.
3. Name the global SOP/policy publisher; publication remains fail-closed without this configuration.
4. Name pilot participants, projects, start/end dates, acceptance owner and monthly spend cap.
5. Complete physical Vietnamese IME checks and Phase 14 company acceptance for the workflows used by the pilot.
6. Approve production deployment and run authenticated production verification with AI initially disabled.

## Stop conditions

Disable AI immediately if unauthorized content reaches a provider or response, a citation/source hash no longer matches, a provider result affects approval/payment/cash/signature/close authority, the monthly cap or latency threshold is exceeded, or logs contain prompt/response/document content. Preserve only content-free run IDs, hashes, usage and failure metadata for investigation.
