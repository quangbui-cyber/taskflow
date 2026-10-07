import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentDisposition } from "../lib/contentDisposition";

const NAMES = [
  "SOW_Notebook.xlsx",
  "BÁO GIÁ - LE NAM.xlsx",
  "BÁO GIÁ - LE NAM.xlsx".normalize("NFD"), // tên file từ macOS
  "Nguyễn Phong BÁO GIÁ -.xlsx",
  "Đề nghị tạm ứng (bản 2).pdf",
  'ten "la".pdf',
  "日本語.pdf",
];

test("download headers are accepted for Vietnamese and other non-ASCII file names", () => {
  for (const name of NAMES) {
    const header = attachmentDisposition(name);
    // Trước đây tên có dấu làm new Response ném lỗi → HTTP 500 khi tải file.
    assert.doesNotThrow(
      () => new Response("x", { headers: { "Content-Disposition": header } }),
      name
    );
    assert.ok(/^[\x20-\x7e]+$/.test(header), name);
  }
});

test("the full name survives in filename* and the fallback stays readable", () => {
  const header = attachmentDisposition("BÁO GIÁ - LE NAM.xlsx".normalize("NFD"));
  assert.match(header, /filename="BAO GIA - LE NAM\.xlsx"/);
  const encoded = /filename\*=UTF-8''(.+)$/.exec(header)![1];
  assert.equal(decodeURIComponent(encoded), "BÁO GIÁ - LE NAM.xlsx".normalize("NFC"));

  assert.match(attachmentDisposition("Đề nghị (bản 2).pdf"), /filename="De nghi \(ban 2\)\.pdf"/);
  assert.match(attachmentDisposition("Đề nghị (bản 2).pdf"), /%28b%E1%BA%A3n%202%29/);
  assert.match(attachmentDisposition("日本語.pdf"), /filename="___\.pdf"/);
  assert.match(attachmentDisposition('a"b.pdf'), /filename="a_b\.pdf"/);
});
