import assert from "node:assert/strict";
import test from "node:test";
import { buildBirthdayEmail } from "../lib/birthdayEmail";

test("birthday email embeds the logo and handwriting as inline images", () => {
  const email = buildBirthdayEmail("Minh Anh", "minh.anh@example.com");
  assert.deepEqual(email.to, ["minh.anh@example.com"]);
  const cids = email.inlineImages?.map((image) => image.cid) ?? [];
  assert.deepEqual(cids.sort(), ["greeting@ga", "logo@ga", "sign@ga", "swash@ga", "title@ga"]);
  for (const image of email.inlineImages ?? []) {
    assert.equal(image.content.subarray(1, 4).toString(), "PNG");
    assert.ok(email.html.includes(`cid:${image.cid}`));
  }
  assert.ok(email.html.includes('alt="Creative Station"'));
});

test("birthday email copy has no filler line and escapes the name", () => {
  const email = buildBirthdayEmail('<b>An</b> & "Bình"', "a@example.com");
  assert.ok(!email.html.includes("<b>An</b>"));
  assert.ok(!email.text.includes("tận đáy lòng"));
  assert.ok(email.text.includes("Cả nhà Ga"));
});
