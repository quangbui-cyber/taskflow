import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { parseServiceAccount, sendChatAppMessage } from "../lib/googleChatApp";
import { hasProjectChat, sendProjectChat } from "../lib/projectChatMessage";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const account = JSON.stringify({ client_email: "chat-app@demo.iam.gserviceaccount.com", private_key: pem });

function withFetch(handler: (url: string, init?: RequestInit) => Response) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("the service account key is read from JSON or base64, escaped newlines included", () => {
  assert.equal(parseServiceAccount(account)?.client_email, "chat-app@demo.iam.gserviceaccount.com");
  assert.equal(parseServiceAccount(Buffer.from(account).toString("base64"))?.private_key, pem);
  const escaped = JSON.stringify({ client_email: "a@b.c", private_key: "-----BEGIN PRIVATE KEY-----\\nabc" });
  assert.equal(parseServiceAccount(escaped)?.private_key, "-----BEGIN PRIVATE KEY-----\nabc");
  assert.equal(parseServiceAccount(""), null);
  assert.equal(parseServiceAccount("not a key"), null);
  assert.equal(parseServiceAccount(JSON.stringify({ client_email: "x" })), null);
});

test("projects with a Chat space post as the Chat app; old projects keep their webhook until then", async (t) => {
  const previous = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
    else process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = previous;
  });
  const webhook = "https://chat.googleapis.com/v1/spaces/OLD/messages?key=k&token=t";

  delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
  assert.equal(hasProjectChat({ googleChatSpaceName: "spaces/AAA", googleChatWebhookUrl: null }), false);
  assert.equal(await sendProjectChat({ googleChatSpaceName: "spaces/AAA", googleChatWebhookUrl: null }, "x"), null);

  process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = account;
  const fake = withFetch((url) =>
    url.startsWith("https://oauth2.googleapis.com/token")
      ? Response.json({ access_token: "app-token", expires_in: 3600 })
      : Response.json({ name: "spaces/AAA/messages/1" })
  );
  t.after(fake.restore);

  assert.equal(hasProjectChat({ googleChatSpaceName: "spaces/AAA", googleChatWebhookUrl: webhook }), true);
  const sent = await sendProjectChat({ googleChatSpaceName: "spaces/AAA", googleChatWebhookUrl: webhook }, "Xin chào");
  assert.deepEqual(sent, { ok: true });
  const message = fake.calls.find((call) => call.url === "https://chat.googleapis.com/v1/spaces/AAA/messages");
  assert.ok(message, "posts to the space through the Chat API, not the webhook");
  assert.equal(new Headers(message.init?.headers).get("authorization"), "Bearer app-token");
  assert.deepEqual(JSON.parse(String(message.init?.body)), { text: "Xin chào" });

  fake.calls.length = 0;
  await sendProjectChat({ googleChatSpaceName: null, googleChatWebhookUrl: webhook }, "Cũ");
  assert.equal(fake.calls[0]?.url, webhook);
});

test("a Chat app that is not in the space gets a clear message", async (t) => {
  const previous = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
  process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = account;
  const fake = withFetch((url) =>
    url.startsWith("https://oauth2.googleapis.com/token")
      ? Response.json({ access_token: "app-token", expires_in: 3600 })
      : new Response("not a member", { status: 404 })
  );
  t.after(() => {
    fake.restore();
    if (previous === undefined) delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
    else process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = previous;
  });
  const result = await sendChatAppMessage("spaces/BBB", "x");
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : "", /myCreative chưa có trong nhóm/);
  assert.deepEqual(await sendChatAppMessage("not-a-space", "x"), { ok: false, error: "Nhóm Google Chat không hợp lệ." });
});

test("common paste mistakes in the key are repaired, and unreadable values say why", async () => {
  const { chatAppProblem } = await import("../lib/googleChatApp");
  const pretty = JSON.stringify({ type: "service_account", client_email: "a@b.iam.gserviceaccount.com", private_key: pem }, null, 2);
  // Ngoặc cong do trình soạn thảo đổi.
  assert.equal(parseServiceAccount(pretty.replace(/"/g, (_, i) => (i % 2 ? "“" : "”")))?.client_email, "a@b.iam.gserviceaccount.com");
  // Khoá xuống dòng thật bên trong chuỗi.
  const rawNewlines = pretty.replace(/\\n/g, "\n");
  assert.equal(parseServiceAccount(rawNewlines)?.private_key, pem);
  // Cả khối bị bọc thành một chuỗi.
  assert.equal(parseServiceAccount(JSON.stringify(pretty))?.client_email, "a@b.iam.gserviceaccount.com");

  const previous = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
  try {
    delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
    assert.match(chatAppProblem() ?? "", /Chưa có biến/);
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = '{"client_email": "x"}';
    assert.match(chatAppProblem() ?? "", /thiếu client_email hoặc private_key/);
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = "{ phần đầu file bị cắt";
    assert.match(chatAppProblem() ?? "", /không đọc được/);
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = account;
    assert.equal(chatAppProblem(), null);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_CHAT_SERVICE_ACCOUNT;
    else process.env.GOOGLE_CHAT_SERVICE_ACCOUNT = previous;
  }
});
