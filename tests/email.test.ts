import assert from "node:assert/strict";
import { mock, test } from "node:test";
import nodemailer from "nodemailer";
import { emailAppUrl, isEmailConfigured, sendEmail } from "../lib/email";

test("email links use valid web origins and fall back to the production host", () => {
  assert.equal(emailAppUrl({ APP_URL: "https://app.example.test/" }), "https://app.example.test");
  assert.equal(emailAppUrl({ VERCEL_PROJECT_PRODUCTION_URL: "app.example.test" }), "https://app.example.test");
  assert.equal(emailAppUrl({ APP_URL: "javascript:alert(1)" }), "");
  assert.equal(emailAppUrl({ APP_URL: "not a url" }), "");
  assert.equal(emailAppUrl({}), "");
});

test("SMTP handles missing configuration, TLS, calendar mail and delivery errors", async () => {
  const oldEnv = { ...process.env };
  const warnings = mock.method(console, "warn", () => {});
  let fail = false;
  let reject = false;
  const captured: string[] = [];
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
  let transportOptions: Record<string, unknown> | undefined;
  const factory = mock.method(nodemailer, "createTransport", (options: Record<string, unknown>) => {
    transportOptions = options;
    return {
      sendMail: async (message: Parameters<typeof stream.sendMail>[0]) => {
        if (fail) throw Object.assign(new Error("private authentication details"), { code: "EAUTH" });
        const result = await stream.sendMail(message);
        captured.push(result.message.toString());
        return { ...result, rejected: reject ? ["staff@example.test"] : [] };
      },
    };
  });
  const message = {
    to: ["staff@example.test"], subject: "Thông báo thử", text: "Nội dung", html: "<p>Nội dung</p>",
    calendar: { method: "REQUEST" as const, content: "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n" },
  };
  try {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_APP_PASSWORD;
    assert.equal(isEmailConfigured(), false);
    assert.equal((await sendEmail(message)).ok, false);
    assert.deepEqual(await sendEmail({ ...message, to: [] }), { ok: true });
    assert.equal(factory.mock.callCount(), 0);

    process.env.SMTP_USER = "noreply@example.test";
    process.env.SMTP_APP_PASSWORD = "test app code only";
    process.env.SMTP_PORT = "587";
    process.env.MAIL_FROM_NAME = "Creative Station";
    assert.equal(isEmailConfigured(), true);
    assert.deepEqual(await sendEmail(message), { ok: true });
    assert.equal(transportOptions?.requireTLS, true);
    assert.equal(transportOptions?.secure, false);
    assert.match(captured[0], /From: Creative Station <noreply@example.test>/);
    assert.match(captured[0], /To: staff@example.test/);
    assert.match(captured[0], /Content-Type: text\/calendar;[^\r\n]*method=REQUEST/);

    reject = true;
    assert.equal((await sendEmail(message)).ok, false);
    fail = true;
    assert.equal((await sendEmail(message)).ok, false);
    assert.ok(warnings.mock.calls.every((call) => !JSON.stringify(call.arguments).includes("private authentication")));
  } finally {
    process.env = oldEnv;
    factory.mock.restore();
    warnings.mock.restore();
  }
});
