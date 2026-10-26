import assert from "node:assert/strict";
import test from "node:test";
import { formatViNumber, parseViNumber } from "../lib/viNumber";

test("Vietnamese number input is read correctly", () => {
  assert.equal(parseViNumber("1.234.567"), 1_234_567);
  assert.equal(parseViNumber("1429738,56"), 1_429_738.56);
  assert.equal(parseViNumber(" 2 000 000 "), 2_000_000);
  assert.equal(parseViNumber("0,5"), 0.5);
  assert.equal(parseViNumber(""), null);
});

test("garbage is flagged instead of guessed", () => {
  assert.ok(Number.isNaN(parseViNumber("12a")));
  assert.ok(Number.isNaN(parseViNumber("1,2,3")));
  assert.ok(Number.isNaN(parseViNumber("-5")));
});

test("numbers are shown with dots and a decimal comma", () => {
  assert.equal(formatViNumber(45_580_000), "45.580.000");
  assert.equal(formatViNumber(1_429_738.56), "1.429.738,56");
  assert.equal(formatViNumber(0.5, 3), "0,5");
  assert.equal(formatViNumber(null), "");
});
