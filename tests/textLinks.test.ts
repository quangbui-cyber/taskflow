import test from "node:test";
import assert from "node:assert/strict";
import { extractTextLinks } from "../lib/textLinks";

test("extracts http, https and www links from result text", () => {
  assert.deepEqual(
    extractTextLinks(
      "Bàn giao: https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing và www.example.com/file"
    ),
    [
      {
        href: "https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing",
        label: "https://docs.google.com/spreadsheets/d/abc/edit?usp=sharing",
      },
      { href: "https://www.example.com/file", label: "www.example.com/file" },
    ]
  );
});

test("removes sentence punctuation and de-duplicates links", () => {
  assert.deepEqual(
    extractTextLinks("Xem https://example.com/a. Link lại: https://example.com/a"),
    [{ href: "https://example.com/a", label: "https://example.com/a" }]
  );
});

test("ignores non-web protocols and incomplete URLs", () => {
  assert.deepEqual(extractTextLinks("javascript:alert(1) mailto:a@b.com https://"), []);
});
