# Phase 15 dependency audit

Updated: 2026-10-29.

`npm audit --omit=dev` reports 0 critical, 4 high and 2 moderate advisories. They belong to two upstream dependency families; npm offers only incompatible downgrades, not safe current upgrades.

| Family | Advisory surface | Reachability and control |
| --- | --- | --- |
| `@vercel/blob` → `@vercel/oidc` → `@vercel/cli-config` → nested `zod` | Four high package entries; constrained-collection memory exhaustion in nested Zod | The app uses Blob upload/download, not the affected Vercel CLI configuration validator directly. Keep upload size/auth checks, do not pass unbounded user collections to provider configuration, and upgrade when Vercel publishes a fixed compatible release. Npm's suggested `@vercel/blob@2.4.0` is a breaking downgrade and was not applied. |
| `exceljs` → `uuid` | Two moderate package entries; missing buffer bounds check in UUID v3/v5/v6 with a caller-provided buffer | The installed ExcelJS path uses UUID v4 and does not supply a buffer to v3/v5/v6. XLSX preflight and resource limits remain enforced. Upgrade when ExcelJS ships a compatible fixed UUID dependency. Npm's suggested `exceljs@3.4.0` is a breaking downgrade and was not applied. |

Cloudflare deployment tooling and LlamaIndex provider smoke dependencies were moved to `devDependencies`, reducing production advisories from 14 to 6. This record does not claim the advisories are fixed; it documents why forced downgrades were rejected and the release controls that remain in force.

Recheck before every production release:

```powershell
npm audit --omit=dev
npm outdated
```

Block release if a critical advisory appears, a currently constrained path becomes reachable, or a compatible fixed version exists and has not been evaluated.
