import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { crmEnabled } from "../lib/features";
import { HUBS, visibleSections, type NavFlags } from "../lib/navigation";

const root = join(__dirname, "..");
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : entry.isFile() ? [file] : [];
  });
}

const crmPages = filesUnder(join(root, "app", "crm")).filter((file) => /[\\/]page\.tsx$/.test(file));
const crmLayouts = filesUnder(join(root, "app", "crm")).filter((file) => /[\\/]layout\.tsx$/.test(file));
const crmApi = filesUnder(join(root, "app", "api", "crm")).filter((file) => /[\\/]route\.ts$/.test(file));

test("CRM hub appears between work and projects only when enabled", () => {
  const index = HUBS.findIndex(({ key }) => key === "crm");
  assert.ok(index > 0);
  assert.deepEqual(HUBS.slice(index - 1, index + 2).map(({ key }) => key), ["work", "crm", "projects"]);
  const hub = HUBS[index];
  assert.equal(hub.label, "Khách hàng");
  assert.equal(hub.href, "/crm");
  const flags: NavFlags = { showCrm: false, showMeetings: true, showRevenue: true, showSuppliers: false, showHr: false };
  assert.equal(hub.visible?.(flags), false);
  assert.deepEqual(visibleSections(hub, flags), []);
  assert.equal(hub.visible?.({ ...flags, showCrm: true }), true);
});

test("every CRM page and API checks the person (crm54); layout and reminder cron keep the master switch", () => {
  assert.ok(crmPages.length > 0);
  assert.ok(crmApi.length > 0);
  for (const file of [...crmLayouts, join(root, "app", "api", "cron", "crm-reminders", "route.ts")]) assert.match(readFileSync(file, "utf8"), /\bcrmEnabled\s*\(/, relative(root, file));
  for (const file of crmApi) assert.match(readFileSync(file, "utf8"), /\bcrmEnabledForUser\s*\(/, relative(root, file));
  // Pages deny with notFound() from the per-person check, exactly like flag-off.
  for (const file of [...crmPages, join(root, "app", "admin", "crm-data", "page.tsx")]) {
    assert.match(readFileSync(file, "utf8"), /if \(!\(await crmAllowed\(user\)\)\) notFound\(\)/, relative(root, file));
  }
});

test("CRM pages have a not-found boundary when disabled", () => {
  assert.ok(crmPages.length > 0);
  for (const file of crmPages) assert.match(readFileSync(file, "utf8"), /\bnotFound\s*\(/, relative(root, file));
  const layout = readFileSync(join(root, "app", "crm", "layout.tsx"), "utf8");
  assert.match(layout, /if\s*\(!crmEnabled\(\)\)\s*notFound\(\)/);
  assert.doesNotMatch(layout, /\bawait\b|\bSuspense\b/);
});

test("CRM stays off unless enabled explicitly", () => {
  assert.equal(crmEnabled({ NODE_ENV: "test" }), false);
  assert.equal(crmEnabled({ NODE_ENV: "test", CRM_ENABLED: "true" }), true);
});
