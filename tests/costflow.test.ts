import test from "node:test";
import assert from "node:assert/strict";
import { calculateCost, decimal, displayMoney, moneyInWords, round, totals } from "../lib/costflow/money";
import { closeBlockers, reconcile, settlement } from "../lib/costflow/reconciliation";
import { emptyFinance } from "../lib/costflow/types";
import { decide } from "../lib/workflow/approval";
import { reimbursementXlsx, reimbursementRows } from "../lib/costflow/export";
import { formatPriceInput, ungroupPriceInput } from "../lib/costflow/inputFormat";

test("quotation input grouping preserves exact values and partial decimals", () => {
  for (const [raw, display] of [["1000000", "1,000,000"], ["1234.50", "1,234.50"], ["9007199254740993.5", "9,007,199,254,740,993.5"], ["1234.", "1,234."], ["", ""], ["-1234.5", "-1,234.5"]]) {
    assert.equal(formatPriceInput(raw), display);
    assert.equal(ungroupPriceInput(display), raw);
  }
  assert.equal(calculateCost({ quantity: "2", unitPrice: ungroupPriceInput("1,000,000"), basis: "NET", vatPercent: "8" }).gross, "2160000");
  assert.equal(formatPriceInput("bad"), "bad");
  assert.equal(formatPriceInput("1234,50"), "1,234.50");
});

test("exact rounding handles ties, negatives, large integers and decimal comma", () => {
  for (const [value, expected] of [["100.4", "100"], ["100.5", "101"], ["-100.5", "-101"], ["-100.4", "-100"], ["-0.49", "0"], ["100,5", "101"], ["9007199254740993.5", "9007199254740994"]]) assert.equal(round(decimal(value)), expected);
  assert.equal(displayMoney("1000000"), "1.000.000 ₫");
  assert.throws(() => decimal("#VALUE!"));
  assert.throws(() => calculateCost({ quantity: "1", unitPrice: "100", basis: "NET", vatPercent: "" }));
});

test("document total sums original values, not rounded row totals", () => {
  const cost = calculateCost({ quantity: "1", unitPrice: "100.4", basis: "NET", vatPercent: "0" });
  assert.equal(cost.gross, "100");
  assert.equal(totals([cost, cost, cost]).gross, "301");
  const inverse = calculateCost({ quantity: "1", unitPrice: "100", basis: "GROSS", vatPercent: "8" });
  assert.deepEqual([inverse.rawNet, inverse.net, inverse.vat, inverse.gross], ["2500/27", "93", "7", "100"]);
});

test("reconciliation keeps employee and vendor balances separate; incomplete evidence blocks reimbursement", () => {
  const data = emptyFinance();
  let expenses = [] as import("../lib/costflow/reconciliation").ReconciliationCost[];
  const cost = (gross: string) => calculateCost({ quantity: "1", unitPrice: gross, basis: "GROSS", vatPercent: "0" });
  const input = { quantity: "1", unitPrice: "0", basis: "NET" as const, vatPercent: "0" };
  expenses = [{ id: "e1", recipientKey: "USER:1", cost: cost("8000000"), invoiceId: "i1", paymentProofId: "p1" }, { id: "e2", recipientKey: "VENDOR:1", cost: cost("8000000"), invoiceId: "i2", paymentProofId: "p2" }];
  const cash = [{ id: "c1", requestId: "r1", recipientKey: "USER:1", direction: "OUT", amount: "10000000", reference: "bank1", evidenceId: "proof1" }, { id: "c2", requestId: "r2", recipientKey: "VENDOR:1", direction: "OUT", amount: "5000000", reference: "bank2", evidenceId: "proof2" }];
  const rows = reconcile(expenses, cash);
  assert.deepEqual(rows.map(r => r.balance), ["-2000000", "3000000"]);
  assert.equal(settlement(expenses, cash, "USER:1").refund, "2000000");
  assert.equal(closeBlockers(expenses, cash).length, 1);
  expenses = expenses.map((expense, index) => index === 0 ? { ...expense, invoiceId: null } : expense);
  assert.throws(() => settlement(expenses, cash, "USER:1"), /đủ IC\/AC/);
  assert.equal(closeBlockers(expenses, cash).length, 2);
});

test("rounded monetary obligations settle without a hidden fractional remainder", () => {
  const data = emptyFinance();
  const expenses: import("../lib/costflow/reconciliation").ReconciliationCost[] = [];
  const input = { quantity: "1", unitPrice: "100.49", basis: "NET" as const, vatPercent: "8" };
  expenses.push({ id: "e", recipientKey: "USER:1", cost: calculateCost(input), invoiceId: "i", paymentProofId: "p" });
  assert.equal(expenses[0].cost.gross, "109");
  const cash = [{ id: "c", requestId: "r", recipientKey: "USER:1", direction: "OUT", amount: "109", reference: "b", evidenceId: "p" }];
  assert.equal(reconcile(expenses, cash)[0].rawBalance, "0/1");
  assert.deepEqual(closeBlockers(expenses, cash), []);
});

test("shared workflow never skips a step for the same actor or grants Admin an approval bypass", () => {
  const record = { creatorId: "same", state: "SUBMITTED", currentStep: 0, steps: ["MANAGER", "ACCOUNTANT", "CEO"].map(role => ({ role, assigneeId: "same" })) };
  const first = decide(record, "same", "APPROVE", "");
  assert.deepEqual(first, { state: "SUBMITTED", currentStep: 1 });
  assert.throws(() => decide(record, "admin", "APPROVE", ""));
  assert.throws(() => decide(record, "same", "WITHDRAW", ""));
  assert.equal(decide(record, "same", "WITHDRAW", "Đổi hồ sơ").state, "WITHDRAWN");
});

test("reimbursement words use actual gross, exports carry source and cannot inject formulas", () => {
  assert.equal(moneyInWords("12000000"), "Mười hai triệu đồng");
  assert.equal(moneyInWords("100000.5"), "Một trăm nghìn không trăm lẻ một đồng");
  const data = { id: "request1", title: "=HYPERLINK(\"bad\")<&", requester: "Nhân viên", project: "Dự án", createdDate: "02/10/2026", approval: "Chờ duyệt", payload: { actualGross: "12000000", advance: "10000000", additional: "2000000", refund: "0" } };
  const rows = reimbursementRows(data);
  assert.equal(rows[9][1], "Mười hai triệu đồng");
  assert.equal(rows[7][6], "2000000");
  const xlsx = reimbursementXlsx(data);
  assert.equal(xlsx.readUInt32LE(0), 0x04034b50);
  assert.ok(xlsx.includes(Buffer.from("&lt;&amp;")));
  assert.ok(!xlsx.includes(Buffer.from("<f>")));
});
