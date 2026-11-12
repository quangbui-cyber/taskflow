import assert from "node:assert/strict";
import { test } from "node:test";
import { diffClientFields, matchClient, normalizeTaxCode, normalizeWebsite, validateParentChain, CLIENT_NOTES_MAX, validateClientNotes } from "../lib/crm/clientProfile";
import { clientDuplicateKey } from "../lib/crm/clientMerge";

test("tax code strips whitespace and accepts 10 digits or 10-3 digits", () => {
  assert.deepEqual(normalizeTaxCode(" 0319 633 663 "), { ok: true, value: "0319633663" });
  assert.deepEqual(normalizeTaxCode("0319633663-001"), { ok: true, value: "0319633663-001" });
  assert.deepEqual(normalizeTaxCode("0319633663 - 001"), { ok: true, value: "0319633663-001" });
  assert.deepEqual(normalizeTaxCode(""), { ok: true, value: null });
  assert.deepEqual(normalizeTaxCode("   "), { ok: true, value: null });
  assert.deepEqual(normalizeTaxCode(null), { ok: true, value: null });
});

test("tax code with a wrong shape is rejected in Vietnamese and never auto-corrected", () => {
  for (const raw of ["031963366", "03196336631", "0319633663001", "0319633663-01", "03196336AB", "0319633663_001", "0319633663-0011"]) {
    const result = normalizeTaxCode(raw);
    assert.ok("error" in result, raw);
    assert.match(result.error, /Mã số thuế/);
  }
});

test("website accepts bare domains, keeps http(s) and rejects other schemes", () => {
  assert.deepEqual(normalizeWebsite("vpbank.com.vn"), { ok: true, value: "https://vpbank.com.vn" });
  assert.deepEqual(normalizeWebsite(" https://VPBank.com.vn/ "), { ok: true, value: "https://vpbank.com.vn" });
  assert.deepEqual(normalizeWebsite("http://example.vn/about"), { ok: true, value: "http://example.vn/about" });
  assert.deepEqual(normalizeWebsite(""), { ok: true, value: null });
  for (const raw of ["javascript:alert(1)", "ftp://example.vn", "not a site", "localhost", "https://"]) assert.ok("error" in normalizeWebsite(raw), raw);
  assert.ok("error" in normalizeWebsite(`https://example.vn/${"a".repeat(300)}`));
});

test("notes are optional and capped at 2000 characters", () => {
  assert.equal(CLIENT_NOTES_MAX, 2000);
  assert.equal(validateClientNotes(null), null);
  assert.equal(validateClientNotes("a".repeat(2000)), null);
  assert.match(validateClientNotes("a".repeat(2001))!, /2000/);
});

test("parent chain blocks self reference, cycles and more than three levels", () => {
  const parents = new Map<string, string | null>([
    ["root", null], ["mid", "root"], ["leaf", "mid"], ["solo", null], ["other", null], ["kid", "solo"],
  ]);
  assert.equal(validateParentChain({ clientId: "solo", parentId: null, parents }), null);
  assert.match(validateParentChain({ clientId: "solo", parentId: "solo", parents })!, /chính/);
  assert.match(validateParentChain({ clientId: "root", parentId: "leaf", parents })!, /vòng/);
  assert.match(validateParentChain({ clientId: "root", parentId: "mid", parents })!, /vòng/);
  // leaf is already level 3; a child under it would be level 4.
  assert.match(validateParentChain({ clientId: "other", parentId: "leaf", parents })!, /3 cấp/);
  assert.equal(validateParentChain({ clientId: "other", parentId: "mid", parents }), null);
  // solo has a child, so solo under mid would push kid to level 4.
  assert.match(validateParentChain({ clientId: "solo", parentId: "mid", parents })!, /3 cấp/);
  assert.equal(validateParentChain({ clientId: "solo", parentId: "root", parents }), null);
  assert.match(validateParentChain({ clientId: "solo", parentId: "missing", parents })!, /Không tìm thấy/);
});

test("field diff ignores untouched and equal values and keeps old and new values", () => {
  const before = { taxCode: null, legalName: "A", parentClientId: "p1", tags: ["x", "y"] };
  assert.deepEqual(diffClientFields(before, { taxCode: "0319633663", legalName: "A", tags: ["x", "y"] }), [
    { field: "taxCode", oldValue: null, newValue: "0319633663" },
  ]);
  assert.deepEqual(diffClientFields(before, { parentClientId: null, tags: ["y"] }), [
    { field: "parentClientId", oldValue: "p1", newValue: null },
    { field: "tags", oldValue: ["x", "y"], newValue: ["y"] },
  ]);
  assert.deepEqual(diffClientFields(before, {}), []);
});

test("client matching uses tax code first, then alias key, then name key", () => {
  const candidates = [
    { id: "vpb", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", taxCode: "0100233583", aliasKeys: [clientDuplicateKey("VPBank")] },
    { id: "vpb-name", name: "VPBank", taxCode: null, aliasKeys: [] },
    { id: "abc", name: "ABC Corp", taxCode: null, aliasKeys: [] },
  ];
  assert.deepEqual(matchClient({ name: "Tên khác hẳn", taxCode: "0100 233 583" }, candidates), { by: "TAX_CODE", ids: ["vpb"] });
  assert.deepEqual(matchClient({ name: "VPBank" }, candidates), { by: "ALIAS", ids: ["vpb"] });
  assert.deepEqual(matchClient({ name: "  abc corp " }, candidates), { by: "NAME", ids: ["abc"] });
  assert.deepEqual(matchClient({ name: "Không có" }, candidates), { by: null, ids: [] });
  // An invalid or unknown tax code falls through to the next rule instead of failing the row.
  assert.deepEqual(matchClient({ name: "ABC Corp", taxCode: "sai" }, candidates), { by: "NAME", ids: ["abc"] });
  assert.deepEqual(matchClient({ name: "ABC Corp", taxCode: "0000000000" }, candidates), { by: "NAME", ids: ["abc"] });
});

test("history values render in Vietnamese with references, labels and empty values", async () => {
  const { describeClientFieldChange } = await import("../lib/crm/clientProfile");
  assert.deepEqual(describeClientFieldChange({ field: "taxCode", oldValue: null, newValue: "0319633663" }), { label: "Mã số thuế", text: "Chưa có → 0319633663" });
  assert.deepEqual(describeClientFieldChange({ field: "parentClientId", oldValue: { id: "p", name: "Tập đoàn A" }, newValue: null }), { label: "Công ty mẹ", text: "Tập đoàn A → Chưa có" });
  assert.deepEqual(describeClientFieldChange({ field: "potentialLevel", oldValue: "LOW", newValue: "HIGH" }, { LOW: "Thấp", HIGH: "Cao" }), { label: "Tiềm năng", text: "Thấp → Cao" });
  assert.deepEqual(describeClientFieldChange({ field: "tags", oldValue: [], newValue: ["VIP", "Ngân hàng"] }), { label: "Nhãn", text: "Chưa có → VIP, Ngân hàng" });
  assert.deepEqual(describeClientFieldChange({ field: "archived", oldValue: null, newValue: { reason: "Ngừng" } }), { label: "Lưu trữ", text: "Lưu trữ (Ngừng)" });
  assert.deepEqual(describeClientFieldChange({ field: "archived", oldValue: { reason: null }, newValue: null }), { label: "Lưu trữ", text: "Khôi phục khách" });
  assert.deepEqual(describeClientFieldChange({ field: "budgetSeasonMonth", oldValue: 3, newValue: null }), { label: "Tháng lập ngân sách", text: "Tháng 3 → Chưa có" });
});
