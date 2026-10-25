import assert from "node:assert/strict";
import test from "node:test";
import { buildGmailRawMessage } from "../lib/googleGmail";

const decode = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

test("the Gmail message keeps the sender, CC and thread headers", async () => {
  const raw = await buildGmailRawMessage(
    { name: "Hà Account", address: "ha@creativestation.vn" },
    {
      fromName: "Hà Account",
      to: ["lan@creativestation.vn"],
      cc: ["minh@creativestation.vn"],
      messageId: "<ic-abc-1@creativestation.vn>",
      inReplyTo: "<ic-abc-0@creativestation.vn>",
      subject: "Re: [Duyệt IC] Annual Report – v1",
      text: "Đã duyệt",
      html: "<p>Đã duyệt</p>",
    },
  );
  const mime = decode(raw);
  assert.match(mime, /^From: =\?UTF-8\?.+\?= <ha@creativestation\.vn>$/m);
  assert.match(mime, /^To: lan@creativestation\.vn$/m);
  assert.match(mime, /^Cc: minh@creativestation\.vn$/m);
  assert.match(mime, /^Message-ID: <ic-abc-1@creativestation\.vn>$/m);
  assert.match(mime, /^In-Reply-To: <ic-abc-0@creativestation\.vn>$/m);
  assert.match(mime, /^References: <ic-abc-0@creativestation\.vn>$/m);
  // Tiêu đề tiếng Việt được mã hoá, không gửi ký tự thô.
  assert.match(mime, /^Subject: =\?UTF-8\?/m);
  assert.doesNotMatch(raw, /[+/=]/);
});

test("an empty CC list adds no Cc header", async () => {
  const mime = decode(
    await buildGmailRawMessage(
      { name: "Lan", address: "lan@creativestation.vn" },
      { fromName: "Lan", to: ["ha@creativestation.vn"], cc: [], subject: "x", text: "x", html: "x" },
    ),
  );
  assert.doesNotMatch(mime, /^Cc:/m);
});
