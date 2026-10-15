import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("../components/EditIcLineModal.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../components/InternalCostPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/modules.css", import.meta.url), "utf8");

test("internal cost editor prioritizes editable IC before the read-only quotation reference", () => {
  const icPosition = editor.indexOf("tf-ic-primary-card");
  const quotationPosition = editor.indexOf("tf-ic-reference-card");

  assert.ok(icPosition >= 0, "IC primary section must exist");
  assert.ok(quotationPosition > icPosition, "quotation reference must follow IC in DOM order");
  assert.match(editor, /Dữ liệu Báo giá chỉ dùng để tham chiếu và không bị sửa tại đây/);
  assert.match(editor, /Tạm tính chi phí mua/);
  assert.match(editor, /calculateLineCost/);
  assert.match(editor, /calculateMargin/);
});

test("internal cost editor uses a responsive right drawer with navigation and unsaved guards", () => {
  assert.match(editor, /className="tf-ic-line-drawer"/);
  assert.match(editor, /Bạn có thay đổi chưa lưu\. Đóng trình chỉnh sửa\?/);
  assert.match(editor, /Bạn có thay đổi chưa lưu\. Chuyển sang hạng mục khác\?/);
  assert.match(editor, /Lưu & sang dòng tiếp/);
  assert.match(panel, /onSelectLine=\{setEditingLine\}/);
  assert.match(styles, /dialog\.tf-ui-dialog\.tf-ic-line-drawer\[open\]/);
  assert.match(styles, /width: min\(760px, 100vw\)/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*tf-ic-line-drawer\[open\][^}]*width: 100vw/);
  assert.match(styles, /\.tf-ic-drawer-scroll[\s\S]*overflow-y: auto/);
});

