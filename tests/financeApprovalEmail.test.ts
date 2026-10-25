import assert from "node:assert/strict";
import test from "node:test";
import { buildFinanceApprovalEmail, type FinanceEmailEvent } from "../lib/financeApprovalEmail";

const base: FinanceEmailEvent = {
  kind: "SUBMITTED",
  projectName: "Vietjet – Chuyến bay đồng hành",
  clientName: "Vietjet",
  version: 1,
  submitterName: "Lan Account",
  actorName: "Lan Account",
  message: "Anh xem giúp em trước thứ 6",
  reason: null,
  selfApproval: false,
  costSubtotal: 28_881_840,
  sell: { gross: 49_226_400, profit: 16_698_160, margin: 0.3663 },
  link: "https://app.example/projects/p1?tab=finance",
};

test("the request email carries the numbers, the note and the link", () => {
  const email = buildFinanceApprovalEmail(base);
  assert.equal(email.subject, "[Duyệt IC] Vietjet – Chuyến bay đồng hành – v1");
  for (const part of ["28.881.840 đ", "49.226.400 đ", "16.698.160 đ", "36,6%", "Anh xem giúp em", "Mở IC để duyệt", "https://app.example/projects/p1?tab=finance"]) {
    assert.ok(email.text.includes(part), part);
    assert.ok(email.html.includes(part), `html: ${part}`);
  }
});

test("sell price, profit and margin disappear when someone cannot see them", () => {
  const email = buildFinanceApprovalEmail({ ...base, sell: null });
  assert.ok(!email.text.includes("49.226.400"));
  assert.ok(!email.text.includes("Lợi nhuận"));
  assert.ok(!email.html.includes("36,6%"));
  assert.ok(email.text.includes("28.881.840 đ"));
  assert.match(email.text, /không được xem số liệu bán/);
});

test("decisions reply in the same thread and explain themselves", () => {
  const approved = buildFinanceApprovalEmail({ ...base, kind: "APPROVED", actorName: "Hà Account", selfApproval: true });
  assert.equal(approved.subject, "Re: [Duyệt IC] Vietjet – Chuyến bay đồng hành – v1");
  assert.match(approved.text, /Hà Account đã duyệt IC v1/);
  assert.match(approved.text, /Doanh thu dự án được cập nhật thành 49\.226\.400 đ/);
  assert.match(approved.text, /người duyệt cũng là người gửi/);
  assert.ok(!approved.text.includes("Anh xem giúp em"), "lời nhắn chỉ ở thư gửi duyệt");

  const rejected = buildFinanceApprovalEmail({ ...base, kind: "REJECTED", actorName: "Hà Account", reason: "Thiếu VAT dòng biên đạo" });
  assert.match(rejected.text, /đã từ chối/);
  assert.match(rejected.text, /Lý do: Thiếu VAT dòng biên đạo/);
});

test("names and notes are escaped in the HTML version", () => {
  const email = buildFinanceApprovalEmail({ ...base, message: "<script>x</script> & co" });
  assert.ok(!email.html.includes("<script>"));
  assert.ok(email.html.includes("&lt;script&gt;x&lt;/script&gt; &amp; co"));
});
