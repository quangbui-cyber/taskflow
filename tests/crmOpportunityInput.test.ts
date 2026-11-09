import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMoneyInput, parseVnDateKey, parseOpenOpportunityPayload, parseAdvancePayload, parseClosePayload, parseWinPayload, parseEditPayload, parseChangePicPayload } from "../lib/crm/opportunityInput";
const base = { opportunityId: "opp", expectedVersion: 1 };
const win = { ...base, contractValue: "1.200.000.000", wonAt: "2026-10-15", projectName: "Signed event" };
test("money is a safe nonnegative integer with supported formatting", () => {
  assert.equal(parseMoneyInput("1.200.000.000"), 1200000000);
  for (const raw of ["1,2 tỷ", -5, 12.5, "", " ", true, {}, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(parseMoneyInput(raw), null);
  assert.equal(parseMoneyInput(0), 0); assert.equal(parseMoneyInput("1 200 000"), 1200000);
});
test("VN keys represent a real date at VN day start", () => {
  assert.equal(parseVnDateKey("2026-10-15")?.toISOString(), "2026-10-14T17:00:00.000Z");
  for (const raw of ["2026-02-30", "15/10/2026", "2026-10-15T00:00:00Z", 1, null]) assert.equal(parseVnDateKey(raw), null);
});
test("win requires a positive contract value", () => {
  const result = parseWinPayload({ ...win, contractValue: 0 }); assert.ok("fieldErrors" in result && result.fieldErrors?.contractValue === "Nhập giá trị hợp đồng.");
});
test("past win is accepted by parser and future-day policy stays in the service", () => {
  const result = parseWinPayload(win); assert.ok("ok" in result); assert.equal(result.value.wonAt.toISOString(), "2026-10-14T17:00:00.000Z"); assert.equal(result.value.contractValue, 1200000000);
  assert.ok("ok" in parseWinPayload({ ...win, wonAt: "2099-01-01" }));
});
test("close rejects WON, requires a reason and validates follow-up", () => {
  assert.ok("error" in parseClosePayload({ ...base, outcome: "WON", reasonId: "reason" }));
  const r = parseClosePayload({ ...base, outcome: "CUSTOMER_CANCELLED", reasonId: "" }); assert.ok("fieldErrors" in r && r.fieldErrors?.reasonId === "Chọn lý do.");
  assert.ok("error" in parseClosePayload({ ...base, outcome: "CS_DECLINED", reasonId: "reason", followUp: { title: "Call", assigneeId: "user", dueDate: "2026-02-30" } }));
});
test("advance requires Brief date and rejects CARE", () => {
  assert.ok("error" in parseAdvancePayload({ ...base, to: "BRIEF" })); assert.ok("error" in parseAdvancePayload({ ...base, to: "CARE" }));
  assert.ok("ok" in parseAdvancePayload({ ...base, to: "BRIEF", briefReceivedAt: "2026-10-15", budgetMin: "100.000" }));
});
test("open delegates source and demand field messages", () => {
  const open = { clientId: "client", programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, source: "REPEAT", demandSignal: "Confirmed need" };
  assert.ok("error" in parseOpenOpportunityPayload({ ...open, source: "FRIEND" }));
  const missing = parseOpenOpportunityPayload({ ...open, demandSignal: undefined }); assert.ok("fieldErrors" in missing && missing.fieldErrors?.demandSignal === "Nhập tín hiệu nhu cầu.");
  assert.ok("ok" in parseOpenOpportunityPayload({ ...open, budgetMin: "100.000", budgetMax: "200.000" }));
});
test("all mutation parsers reject malformed identity/version and restrict edit fields", () => {
  const parsers = [parseAdvancePayload, parseClosePayload, parseWinPayload, parseEditPayload, parseChangePicPayload];
  for (const parse of parsers) for (const patch of [{ expectedVersion: "1" }, { expectedVersion: -1 }, { opportunityId: 42 }]) assert.ok("error" in parse({ ...win, to: "BIDDING", outcome: "CS_DECLINED", reasonId: "reason", name: "Changed", picAccountId: "pic", responsibleTeamId: null, ...patch }));
  const parsed = parseEditPayload({ ...base, name: "Changed", stage: "WON", outcome: "WON", budgetMin: "1.000", proposalDueAt: "2026-10-15" }); assert.ok("ok" in parsed); assert.equal("stage" in parsed.value, false); assert.equal("outcome" in parsed.value, false); assert.equal(parsed.value.budgetMin, 1000);
  for (const raw of [null, [], true, "bad"]) for (const parse of [...parsers, parseOpenOpportunityPayload]) assert.ok("error" in parse(raw));
  assert.ok("error" in parseEditPayload({ ...base, source: [], briefSummary: {} }));
});
