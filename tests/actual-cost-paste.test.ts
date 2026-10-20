import test from "node:test";
import assert from "node:assert/strict";
import { parseActualCostPaste } from "../lib/costflow/actualCostPaste";

const revision = { lines: [{ id: "ic-1", description: "Âm thanh" }] };
const recipients = [{ key: "USER:member-1", label: "Lan" }, { key: "VENDOR:vendor-1", label: "NCC A" }];

test("Excel paste previews IC and outside-IC rows without sending an approval", () => {
  const text = [
    "Loại\tHạng mục IC\tNội dung chi\tNgười nhận / NCC\tSL\tNgày\tĐơn vị\tĐơn giá\tVAT %\tNguồn tiền\tLý do ngoài IC",
    "IC\tÂm thanh\tThuê loa\tNCC A\t2\t1\tbộ\t100000\t10\tThanh toán NCC\t",
    "Ngoài IC\t\tBổ sung pin\tLan\t1\t1\tbộ\t50000\t0\tNhân sự tự chi\tPhát sinh tại hiện trường",
  ].join("\r\n");
  const preview = parseActualCostPaste(text, revision, recipients);
  assert.equal(preview.ready, true);
  assert.equal(preview.rows.length, 2);
  assert.deepEqual(preview.rows.map(row => row.line.sourceKind), ["IC_LINKED", "UNBUDGETED"]);
  assert.equal(preview.rows[0].line.icLineId, "ic-1");
  assert.equal(preview.rows[0].line.recipientKey, "VENDOR:vendor-1");
  assert.equal(preview.rows[1].line.reason, "Phát sinh tại hiện trường");
});

test("Excel paste blocks malformed rows, ambiguous recipients and more than 100 rows", () => {
  const malformed = parseActualCostPaste("IC\tSai IC\t\tLan\t0\t1\tbộ\t-1\t101\tSai nguồn", revision, recipients);
  assert.equal(malformed.ready, false);
  assert.match(malformed.rows[0].errors.join(" "), /hạng mục IC|nội dung chi|SL|Đơn giá|VAT|Nguồn tiền/i);

  const ambiguous = parseActualCostPaste("IC\tÂm thanh\tThuê loa\tLan\t1\t1\tbộ\t100\t0\tNhân sự tự chi", revision, [...recipients, { key: "USER:member-2", label: "Lan" }]);
  assert.equal(ambiguous.ready, false);
  assert.match(ambiguous.rows[0].errors.join(" "), /trùng/);

  const validRow = "IC\tÂm thanh\tThuê loa\tLan\t1\t1\tbộ\t100\t0\tNhân sự tự chi";
  const tooMany = parseActualCostPaste(Array(101).fill(validRow).join("\n"), revision, recipients);
  assert.equal(tooMany.tooMany, true);
  assert.equal(tooMany.ready, false);
});
