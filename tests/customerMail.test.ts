import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignReadiness,
  cleanRecipient,
  fillTemplate,
  formatVietnamDateTime,
  mergeDuplicates,
  normalizeEmail,
  parseSalutation,
  parseVietnamDateTime,
  recipientIssues,
  recipientVariables,
  toVietnamDateTimeInput,
  unknownVariables,
} from "../lib/customerMail";
import { buildCustomerEmail, previewHtml } from "../lib/customerMailEmail";
import { extractWithGemini, importKind, importRecipients, mapTable, parseCsv } from "../lib/customerMailImport";
import { classifySmtpError, normalizeSmtpRef } from "../lib/email";

const row = (overrides: Partial<Parameters<typeof recipientIssues>[0]> = {}) => ({
  fullName: "Vũ Nguyễn Tuyết Nhung",
  email: "nhung@example.com",
  callName: "Nhung",
  salutation: "chi",
  group: "Nhà Hứng Khởi",
  confidence: null,
  reviewed: false,
  ...overrides,
});

test("greeting uses capitalised salutation and drops it for 'bạn'", () => {
  const greeting = "{{Xung_ho}} {{ten_goi}} thân mến,";
  assert.equal(fillTemplate(greeting, recipientVariables(row())), "Chị Nhung thân mến,");
  assert.equal(fillTemplate(greeting, recipientVariables(row({ salutation: "anh", callName: "Minh" }))), "Anh Minh thân mến,");
  assert.equal(fillTemplate(greeting, recipientVariables(row({ salutation: "ban" }))), "Nhung thân mến,");
  assert.equal(
    fillTemplate("Cảm ơn {{xung_ho}} và cả team {{nhom}}!", recipientVariables(row())),
    "Cảm ơn chị và cả team Nhà Hứng Khởi!"
  );
  assert.equal(fillTemplate("Chào {{nhom}}, hẹn gặp lại", recipientVariables(row({ group: null }))), "Chào, hẹn gặp lại");
  assert.deepEqual(unknownVariables("{{ten_goi}} {{TenGoi}} {{ xung_ho }}"), ["{{TenGoi}}"]);
});

test("salutations are read only from explicit labels", () => {
  assert.equal(parseSalutation("Chị"), "chi");
  assert.equal(parseSalutation("Mr."), "anh");
  assert.equal(parseSalutation("Ms"), "chi");
  assert.equal(parseSalutation("bạn"), "ban");
  assert.equal(parseSalutation("Nhung"), null);
  assert.equal(parseSalutation(""), null);
});

test("recipients are cleaned, call names default to the last word and duplicates merge", () => {
  const first = cleanRecipient({ full_name: "  Trần  Văn Minh ", email: " Minh.Tran@Example.com " }, "a.csv")!;
  assert.equal(first.fullName, "Trần Văn Minh");
  assert.equal(first.email, "minh.tran@example.com");
  assert.equal(first.callName, "Minh");
  const second = cleanRecipient({ full_name: "Minh Trần", email: "MINH.TRAN@example.com", salutation: "Anh", group: "Team A" }, "b.png")!;
  const { rows, merged } = mergeDuplicates([first, second]);
  assert.equal(merged, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].salutation, "anh");
  assert.equal(rows[0].group, "Team A");
  assert.equal(cleanRecipient({ full_name: "", email: "" }, null), null);
  assert.equal(normalizeEmail("mailto:A@B.VN"), "a@b.vn");
});

test("send stays locked until every row has email, salutation and review", () => {
  assert.deepEqual(recipientIssues(row()), []);
  assert.deepEqual(recipientIssues(row({ email: null })), ["missing-email"]);
  assert.deepEqual(recipientIssues(row({ email: "nhung@example" })), ["invalid-email"]);
  // Chưa chọn xưng hô thì gọi là "bạn", không chặn gửi.
  assert.deepEqual(recipientIssues(row({ salutation: null })), []);
  assert.equal(fillTemplate("{{Xung_ho}} {{ten_goi}} thân mến,", recipientVariables(row({ salutation: null }))), "Nhung thân mến,");
  assert.deepEqual(recipientIssues(row({ confidence: 0.6 })), ["low-confidence"]);
  assert.deepEqual(recipientIssues(row({ confidence: 0.6, reviewed: true })), []);

  assert.equal(campaignReadiness([]).ready, false);
  const ready = campaignReadiness([row(), row({ email: "minh@example.com", salutation: "anh" })]);
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.bySalutation, { anh: 1, chi: 1, ban: 0 });
  assert.deepEqual(campaignReadiness([row({ salutation: null })]).bySalutation, { anh: 0, chi: 0, ban: 1 });
  const duplicate = campaignReadiness([row(), row()]);
  assert.equal(duplicate.ready, false);
  assert.equal(duplicate.blocked, 2);
});

test("schedule times are read and shown in Vietnam time", () => {
  const date = parseVietnamDateTime("2026-11-15T19:00")!;
  assert.equal(date.toISOString(), "2026-11-15T12:00:00.000Z");
  assert.equal(toVietnamDateTimeInput(date), "2026-11-15T19:00");
  assert.equal(formatVietnamDateTime(date), "19:00 15/11/2026");
  assert.equal(parseVietnamDateTime("tối nay"), null);
});

test("customer email personalises greeting, escapes text and ships a plain-text part", () => {
  const content = {
    subject: "Cảm ơn {{xung_ho}} {{ten_goi}}",
    title: "Lời cảm ơn",
    greeting: "{{Xung_ho}} {{ten_goi}} thân mến,",
    body: "Cảm ơn {{xung_ho}} <3 đã chơi hết mình.\n\nHẹn gặp lại!",
    signOff: "Thân mến,",
    signature: "Ga",
  };
  const email = buildCustomerEmail(content, { ...row(), email: "nhung@example.com" });
  assert.deepEqual(email.to, ["nhung@example.com"]);
  assert.equal(email.subject, "Cảm ơn chị Nhung");
  assert.ok(email.text.startsWith("Chị Nhung thân mến,"));
  assert.ok(email.text.includes("Hẹn gặp lại!"));
  assert.ok(email.text.endsWith("Thân mến,\nGa"));
  assert.ok(email.html.includes("Cảm ơn chị &lt;3 đã chơi hết mình."));
  assert.ok(email.html.includes("font-family:'Be Vietnam Pro',Arial"));
  assert.ok(email.html.includes("fonts.googleapis.com/css2?family=Be+Vietnam+Pro"));
  assert.ok(email.html.includes('alt="Chị Nhung thân mến,"'));
  const cids = (email.inlineImages ?? []).map((image) => image.cid).sort();
  assert.deepEqual(cids, ["greeting@ga", "logo@ga", "sign@ga", "swash@ga", "title@ga"]);
  for (const image of email.inlineImages ?? []) assert.equal(image.content.subarray(1, 4).toString(), "PNG");
  const preview = previewHtml(email);
  assert.ok(!preview.includes("cid:"));
  assert.ok(preview.includes("data:image/png;base64,"));
  assert.ok(!preview.includes("fonts.googleapis.com"));
  assert.ok(preview.includes("/fonts/be-vietnam-pro/be-vietnam-pro-vietnamese-400.woff2"));
});

test("CSV and spreadsheet tables map columns by Vietnamese headers", () => {
  const rows = parseCsv('﻿STT;Họ và tên;Email;Xưng hô;Nhóm\n1;"Vũ Nguyễn Tuyết Nhung";Nhung@Example.com;Chị;Nhà Hứng Khởi\n2;Trần Minh;minh@example.com;;\n');
  assert.equal(rows.length, 3);
  const people = mapTable(rows, "list.csv")!;
  assert.equal(people.length, 2);
  assert.deepEqual(
    { email: people[0].email, salutation: people[0].salutation, callName: people[0].callName, group: people[0].group, source: people[0].source },
    { email: "nhung@example.com", salutation: "chi", callName: "Nhung", group: "Nhà Hứng Khởi", source: "list.csv" }
  );
  assert.equal(people[1].salutation, null);
  // Không có cột email rõ ràng thì để Gemini dò cột.
  assert.equal(mapTable([["Tên", "Liên hệ"], ["An", "an@example.com"]], "x.csv"), null);
  assert.equal(importKind("Danh sach.HEIC", "")?.mimeType, "image/heic");
  assert.equal(importKind("list.docx", "application/msword"), null);
});

test("Gemini extraction sends a JSON schema and flags unreadable emails", async () => {
  let body: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                people: [
                  { full_name: "Lê Thị Hoa", email: "hoa@example.com", call_name: "Hoa", salutation: "chi", confidence: 0.95 },
                  { full_name: "Phạm Nam", email: "nam@exarnple", confidence: 0.9 },
                ],
                summary: "2 người, 1 dòng email chưa rõ.",
              }),
            }],
          },
        }],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  const result = await extractWithGemini({
    parts: [{ text: "danh sách" }],
    source: "anh.png",
    env: { GEMINI_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv,
    fetchImpl: fakeFetch,
  });
  const config = body.generationConfig as Record<string, unknown>;
  assert.equal(config.responseMimeType, "application/json");
  assert.ok(config.responseSchema);
  assert.equal(result.people.length, 2);
  assert.equal(result.people[0].salutation, "chi");
  assert.ok((result.people[1].confidence ?? 1) <= 0.5);
  assert.equal(result.summary, "2 người, 1 dòng email chưa rõ.");

  await assert.rejects(
    importRecipients({ kind: "image", mimeType: "image/png", data: Buffer.from("x"), source: "a.png" }, { env: {} as unknown as NodeJS.ProcessEnv }),
    /GEMINI_API_KEY/
  );
  const direct = await importRecipients(
    { kind: "csv", mimeType: "text/csv", data: Buffer.from("Họ tên,Email\nAn,an@example.com\n"), source: "a.csv" },
    { env: {} as unknown as NodeJS.ProcessEnv }
  );
  assert.equal(direct.usedAi, false);
  assert.equal(direct.people[0].email, "an@example.com");
});

test("SMTP errors are split into retryable and permanent", () => {
  assert.equal(classifySmtpError({ code: "ETIMEDOUT" }).transient, true);
  assert.equal(classifySmtpError({ responseCode: 421 }).transient, true);
  assert.equal(classifySmtpError({ responseCode: 550, response: "550 5.1.1 user unknown" }).transient, false);
  assert.equal(classifySmtpError({ responseCode: 550, response: "550 5.1.1 user unknown" }).message, "Địa chỉ email không tồn tại.");
  assert.equal(classifySmtpError({ code: "EAUTH" }).transient, false);
  assert.equal(normalizeSmtpRef(" ga-mail "), "GAMAIL");
  assert.equal(normalizeSmtpRef(""), null);
});
