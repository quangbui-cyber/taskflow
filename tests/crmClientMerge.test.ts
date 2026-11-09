import assert from "node:assert/strict";
import test from "node:test";
import { clientNameKey } from "../lib/clientCatalog";
import { clientDuplicateKey, findDuplicateClientPairs } from "../lib/crm/clientMerge";

test("legal forms and punctuation do not hide duplicate companies", () => {
  for (const name of ["Công ty TNHH ABC", "ABC Co., Ltd", "ＣＴＹ ABC", "ABC JSC", "Công ty cổ phần ABC", "ABC Corporation"]) assert.equal(clientDuplicateKey(name), "abc");
});
test("Vietnamese accents and crossed d normalize", () => assert.equal(clientDuplicateKey("Đông Á"), clientDuplicateKey("dong a")));
test("distinct names and substrings stay distinct", () => {
  assert.notEqual(clientDuplicateKey("ABC"), clientDuplicateKey("ABD"));
  assert.equal(clientDuplicateKey("Cooper MTVision"), "cooper mtvision");
});
test("legal-only names fall back to the plain catalog key", () => assert.equal(clientDuplicateKey("Công ty TNHH"), clientNameKey("Công ty TNHH")));
test("duplicate groups yield every unordered pair deterministically", () => {
  const clients = ["Công ty ABC", "ABC JSC", "abc", "XYZ"].map((name, i) => ({ id: String(i), name, createdAt: new Date(i) }));
  const pairs = findDuplicateClientPairs(clients);
  assert.equal(pairs.length, 3); assert.ok(pairs.every((p) => p.key === "abc" && p.a.name !== "XYZ" && p.b.name !== "XYZ"));
  assert.equal(new Set(pairs.map((p) => [p.a.id, p.b.id].sort().join(":"))).size, 3);
  assert.deepEqual(findDuplicateClientPairs([...clients].reverse()), pairs);
});
