import assert from "node:assert/strict";
import test from "node:test";
import { buildRecapPrompt, buildTranscriptionPrompt } from "../lib/meetingRecap";
import {
  addHeardAs,
  mergeGlossarySuggestions,
  suggestGlossaryFromEdit,
} from "../lib/recapGlossary";

test("edited names and terms become glossary suggestions", () => {
  const before = "## Tổng quan\nTuy L báo cáo doanh thu của Jabil.\n- Ai xi duyệt thêm 3 slot.";
  const after = "## Tổng quan\nTuyết Lê báo cáo doanh thu của Jabil.\n- IC duyệt thêm 3 slot.";
  assert.deepEqual(suggestGlossaryFromEdit(before, after), [
    { wrong: "Tuy L", right: "Tuyết Lê" },
    { wrong: "Ai xi", right: "IC" },
  ]);
});

test("pure insertions, number changes, punctuation and rewrites are not suggested", () => {
  assert.deepEqual(suggestGlossaryFromEdit("Doanh thu 3 tỷ.", "Doanh thu 5 tỷ."), []);
  assert.deepEqual(suggestGlossaryFromEdit("Họp xong rồi", "Họp xong rồi, nhé"), []);
  assert.deepEqual(suggestGlossaryFromEdit("Chốt, kế hoạch", "Chốt kế hoạch"), []);
  assert.deepEqual(
    suggestGlossaryFromEdit("a b c d e f g h", "một hai ba bốn năm sáu bảy tám chín"),
    []
  );
  assert.deepEqual(suggestGlossaryFromEdit("giống hệt", "giống hệt"), []);
});

test("suggestions merge without duplicates or terms already in the glossary", () => {
  const merged = mergeGlossarySuggestions(
    [{ wrong: "Tuy L", right: "Tuyết Lê" }],
    [
      { wrong: "tuy l", right: "tuyết lê" },
      { wrong: "Ai xi", right: "IC" },
      { wrong: "kê pi ai", right: "KPI" },
    ],
    ["KPI"]
  );
  assert.deepEqual(merged, [
    { wrong: "Tuy L", right: "Tuyết Lê" },
    { wrong: "Ai xi", right: "IC" },
  ]);
  assert.equal(addHeardAs("Ai xi", "ai xi"), "Ai xi");
  assert.equal(addHeardAs("Ai xi", "Ây xi"), "Ai xi / Ây xi");
});

test("glossary reaches both the transcription hint and the summary prompt", () => {
  assert.equal(buildTranscriptionPrompt("họp", ["Duy Quang"], ["Jabil", "IC"]), "Duy Quang, Jabil, IC.");
  const meeting = { title: "Họp", when: "x", room: null, organizer: "A", attendees: [], description: null };
  const plain = buildRecapPrompt(meeting, "nội dung");
  assert.ok(!plain.system.includes("Từ điển"));
  const withGlossary = buildRecapPrompt(meeting, "nội dung", {
    terms: [{ text: "Tuyết Lê", heardAs: "Tuy L" }],
    rules: ["Gọi là đám Strategy, không viết Chiến lược"],
  });
  assert.ok(withGlossary.system.includes("- Tuyết Lê (máy hay chép thành: Tuy L)"));
  assert.ok(withGlossary.system.includes("- Gọi là đám Strategy, không viết Chiến lược"));
});
