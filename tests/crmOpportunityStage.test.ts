import assert from "node:assert/strict";
import { test } from "node:test";
import { canAdvance, canClose, validateOpenOpportunityInput, defaultOpportunityName } from "../lib/crm/opportunityStage";

test("only the next open Opportunity stage is reachable", () => {
  assert.equal(canAdvance({ stage: "CARE", outcome: null }, "BRIEF"), true);
  assert.equal(canAdvance({ stage: "BRIEF", outcome: null }, "BIDDING"), true);
  assert.equal(canAdvance({ stage: "CARE", outcome: null }, "BIDDING"), false);
  assert.equal(canAdvance({ stage: "BRIEF", outcome: null }, "BRIEF"), false);
  assert.equal(canAdvance({ stage: "BIDDING", outcome: "WON" }, "BRIEF"), false);
});

test("competitive results require Bidding; cancellation or decline can end any open stage", () => {
  for (const outcome of ["WON", "LOST_COMPETITIVE"]) {
    assert.equal(canClose({ stage: "BIDDING", outcome: null }, outcome), true);
    assert.equal(canClose({ stage: "BRIEF", outcome: null }, outcome), false);
    assert.equal(canClose({ stage: "CARE", outcome: null }, outcome), false);
  }
  for (const stage of ["CARE", "BRIEF", "BIDDING"]) {
    for (const outcome of ["CUSTOMER_CANCELLED", "CS_DECLINED"]) assert.equal(canClose({ stage, outcome: null }, outcome), true);
    assert.equal(canClose({ stage, outcome: "CS_DECLINED" }, "WON"), false);
  }
  assert.equal(canClose({ stage: "CARE", outcome: null }, "LEGACY_UNCLASSIFIED"), false);
  assert.equal(canClose({ stage: "INVALID", outcome: null }, "CS_DECLINED"), false);
});

const valid = { clientId: "client-test", programTypeCode: "MICE", expectedYear: 2027, expectedMonth: 3, demandSignal: "  Client requested a proposal  ", source: "REFERRAL", budgetMin: 10, budgetMax: 20 };
test("opening input requires a client, catalog type, expected time and demand signal", () => {
  const missing = validateOpenOpportunityInput({});
  assert.ok("errors" in missing);
  if (!("errors" in missing)) throw new Error("Missing errors");
  assert.equal(missing.errors.programTypeCode, "Chọn loại chương trình.");
  assert.equal(missing.errors.expectedMonth, "Nhập tháng hoặc quý dự kiến.");
  assert.equal(missing.errors.demandSignal, "Nhập tín hiệu nhu cầu.");
  assert.ok("errors" in validateOpenOpportunityInput({ ...valid, demandSignal: " " }));
  const parsed = validateOpenOpportunityInput(valid);
  assert.ok("ok" in parsed);
  if ("ok" in parsed) assert.equal(parsed.value.demandSignal, valid.demandSignal.trim());
});

test("opening accepts exactly a month or quarter and approved sources", () => {
  assert.ok("ok" in validateOpenOpportunityInput({ ...valid, expectedMonth: null, expectedQuarter: 2 }));
  for (const input of [{ expectedMonth: 13 }, { expectedMonth: 3, expectedQuarter: 1 }, { expectedMonth: null, expectedQuarter: 5 }, { expectedYear: 2027.5 }, { source: "UNKNOWN" }]) assert.ok("errors" in validateOpenOpportunityInput({ ...valid, ...input }));
  for (const source of ["REPEAT", "REFERRAL", "INBOUND", "INDUSTRY_EVENT", "OTHER"]) assert.ok("ok" in validateOpenOpportunityInput({ ...valid, source }));
});

test("money must be safe nonnegative integers with minimum no greater than maximum", () => {
  for (const input of [{ budgetMin: 10, budgetMax: 5 }, { budgetMin: -1 }, { budgetMin: 1.5 }, { budgetMax: Infinity }, { budgetMax: Number.MAX_SAFE_INTEGER + 1 }]) assert.ok("errors" in validateOpenOpportunityInput({ ...valid, ...input }));
  assert.ok("ok" in validateOpenOpportunityInput({ ...valid, budgetMin: null, budgetMax: null }));
  assert.ok("ok" in validateOpenOpportunityInput({ ...valid, budgetMin: 0, budgetMax: 0 }));
});

test("optional identifiers and text reject malformed data; default names remain editable", () => {
  assert.ok("errors" in validateOpenOpportunityInput({ ...valid, picAccountId: [] }));
  assert.ok("errors" in validateOpenOpportunityInput({ ...valid, name: "x".repeat(201) }));
  assert.equal(defaultOpportunityName("Tiệc cuối năm", 2027), "Tiệc cuối năm 2027");
});
