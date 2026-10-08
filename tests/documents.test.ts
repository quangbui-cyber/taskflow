import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canManageDocuments,
  documentDownloadName,
  normalizeDocumentName,
  normalizeDocumentUrl,
  titleFromFileName,
} from "../lib/documents";

test("only admins manage shared documents", () => {
  assert.ok(canManageDocuments("ADMIN"));
  assert.equal(canManageDocuments("ACCOUNT"), false);
  assert.equal(canManageDocuments("USER"), false);
});

test("document names are trimmed, single-spaced and never empty", () => {
  assert.equal(normalizeDocumentName("  Hợp   đồng mẫu "), "Hợp đồng mẫu");
  assert.equal(normalizeDocumentName("a/b\\c"), "a b c");
  assert.equal(normalizeDocumentName("   "), null);
  assert.equal(normalizeDocumentName(null), null);
  assert.equal(normalizeDocumentName("x".repeat(500))?.length, 120);
});

test("downloads keep the original extension under the custom name", () => {
  assert.equal(titleFromFileName("Hop dong mau.docx"), "Hop dong mau");
  assert.equal(titleFromFileName("README"), "README");
  assert.equal(documentDownloadName("Hợp đồng", "scan_001.PDF"), "Hợp đồng.pdf");
  assert.equal(documentDownloadName("BBNT.pdf", "x.pdf"), "BBNT.pdf");
  assert.equal(documentDownloadName("Ghi chú", "notes"), "Ghi chú");
});

test("document links must be plain http(s) addresses", () => {
  assert.equal(
    normalizeDocumentUrl(" https://docs.google.com/document/d/abc/edit "),
    "https://docs.google.com/document/d/abc/edit"
  );
  assert.equal(
    normalizeDocumentUrl("drive.google.com/file/d/1"),
    "https://drive.google.com/file/d/1"
  );
  for (const bad of [
    "",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "ftp://example.com/a",
    "mailto:a@example.com",
    "https://user:pass@example.com",
    "localhost",
    "not a link",
  ]) {
    assert.equal(normalizeDocumentUrl(bad), null, bad);
  }
});
