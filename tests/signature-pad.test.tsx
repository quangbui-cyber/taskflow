import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("SignaturePad exposes draw, protected saved and upload modes", async () => {
  const source = await readFile(new URL("../components/SignaturePad.tsx", import.meta.url), "utf8");
  assert.match(source, /"draw" \| "saved" \| "upload"/);
  assert.match(source, /onPointerDown/);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /touchAction:\s*"none"/);
  assert.match(source, /toDataURL\("image\/png"\)/);
  assert.doesNotMatch(source, /image\/svg/);
});

test("SignaturePad requires explicit commitment and exactly six numeric PIN digits", async () => {
  const source = await readFile(new URL("../components/SignaturePad.tsx", import.meta.url), "utf8");
  assert.match(source, /agreedLegal/);
  assert.match(source, /maxLength=\{6\}/);
  assert.match(source, /replace\(\/\\D\/g,\s*""\)\.slice\(0,\s*6\)/);
  assert.match(source, /isSignatureReady\s*&&\s*agreedLegal\s*&&\s*isPinValid/);
  assert.match(source, /pin\.length === 6/);
});

test("closing the dialog clears transient image, PIN and commitment state", async () => {
  const source = await readFile(new URL("../components/SignaturePad.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(!open\)[\s\S]*setUploadedDataUrl\(null\)/);
  assert.match(source, /if \(!open\)[\s\S]*setPin\(""\)/);
  assert.match(source, /if \(!open\)[\s\S]*setAgreedLegal\(false\)/);
  assert.match(source, /canvasRef\.current\.width\s*=\s*0/);
});

test("SignaturePad does not receive a general User DTO", async () => {
  const source = await readFile(new URL("../components/SignaturePad.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\buser:\s*(?:User|\{)/);
  assert.doesNotMatch(source, /signaturePinHash|passwordHash/);
});
