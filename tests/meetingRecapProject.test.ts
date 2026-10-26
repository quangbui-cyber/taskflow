import assert from "node:assert/strict";
import { test } from "node:test";
import { meetingStartPromptKey, meetingStartPromptMessage } from "../lib/meetingStartPromptText";
import { notificationDestination } from "../lib/pushPolicy";
import {
  DOCX_MIME_TYPE,
  buildRecapDocumentXml,
  buildRecapDocx,
  buildStoredZip,
  crc32,
  recapDocxFileName,
} from "../lib/recapDocx";

const sample = {
  title: "Kickoff <Jabil> & đối tác",
  when: "09:00 – 10:00, Thứ Năm, 22/10/2026",
  room: null,
  organizer: "Duy Quang",
  attendees: ["Ngọc Giàu"],
  content:
    "## Tóm tắt\nChốt LED 6x3m.\n\n## Nội dung thảo luận\n### Ngân sách\n- Trần 200 triệu\n\n## Việc cần làm\n- Gửi báo giá — Phụ trách: Lan — Hạn: Thứ Sáu",
  sentAt: new Date("2026-10-22T08:30:00Z"),
};

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("the zip container lists every file with matching sizes and checksums", () => {
  const files = [
    { name: "a.txt", data: new TextEncoder().encode("xin chào") },
    { name: "thư mục/b.xml", data: new TextEncoder().encode("<b/>") },
  ];
  const zip = buildStoredZip(files, new Date("2026-10-22T08:30:00Z"));
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);

  let central = view.getUint32(end + 16, true);
  for (const file of files) {
    assert.equal(view.getUint32(central, true), 0x02014b50);
    assert.equal(view.getUint32(central + 16, true), crc32(file.data));
    assert.equal(view.getUint32(central + 24, true), file.data.length);
    const nameLength = view.getUint16(central + 28, true);
    const local = view.getUint32(central + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const name = new TextDecoder().decode(zip.slice(central + 46, central + 46 + nameLength));
    assert.equal(name, file.name);
    const dataStart = local + 30 + view.getUint16(local + 26, true);
    assert.deepEqual(zip.slice(dataStart, dataStart + file.data.length), file.data);
    central += 46 + nameLength;
  }
});

test("the Word document holds the meeting details and recap, safely escaped", () => {
  const xml = buildRecapDocumentXml(sample);
  assert.match(xml, /Kickoff &lt;Jabil&gt; &amp; đối tác/);
  assert.ok(!xml.includes("<Jabil>"));
  assert.match(xml, /Không dùng phòng/);
  assert.match(xml, /Ngọc Giàu/);
  assert.match(xml, /<w:b\/>.*Tóm tắt/);
  assert.match(xml, /• Gửi báo giá — Phụ trách: Lan — Hạn: Thứ Sáu/);
  assert.match(xml, /gửi lúc 15:30 22\/10\/2026/);

  const docx = buildRecapDocx(sample);
  const text = new TextDecoder().decode(docx);
  assert.ok(text.includes("[Content_Types].xml"));
  assert.ok(text.includes("word/document.xml"));
  assert.equal(DOCX_MIME_TYPE, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
});

test("recap files get a readable, filesystem-safe name with the meeting date", () => {
  assert.equal(
    recapDocxFileName("Kickoff: Jabil/VIP?", new Date("2026-10-22T02:00:00Z")),
    "Biên bản họp - Kickoff Jabil VIP - 22-10-2026.docx"
  );
  // 23:30 UTC = 06:30 ngày hôm sau giờ Việt Nam
  assert.match(recapDocxFileName("Họp", new Date("2026-10-22T23:30:00Z")), /23-10-2026\.docx$/);
  assert.match(recapDocxFileName("///", new Date("2026-10-22T02:00:00Z")), /^Biên bản họp - Cuộc họp - /);
});

test("the meeting-start prompt opens the recap page ready to record, once per meeting", () => {
  assert.equal(
    notificationDestination({ type: "MEETING_RECAP_PROMPT", meetingId: "m1" }),
    "/meetings/m1/recap?record=1"
  );
  assert.equal(notificationDestination({ type: "MEETING_RECAP_READY", meetingId: "m1" }), "/meetings/m1/recap");
  assert.equal(meetingStartPromptKey("m1"), "meeting-start:m1");
  assert.match(meetingStartPromptMessage("Kickoff"), /“Kickoff” đã bắt đầu\. Bấm để ghi âm/);
});
