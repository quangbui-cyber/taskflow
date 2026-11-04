import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Prisma } from "@prisma/client";
// Supply an in-memory client before loading the routes: no database connection in these tests.
const prisma = {
  extensionToken: { findUnique: async () => null, update: async () => ({}) },
  meeting: { findMany: async () => [], create: async () => ({}) },
};
(globalThis as unknown as { prisma: unknown }).prisma = prisma;
let GET: typeof import("../app/api/ext/meetings/lookup/route").GET;
let POST: typeof import("../app/api/ext/meetings/quick/route").POST;
before(async () => {
  ({ GET } = await import("../app/api/ext/meetings/lookup/route"));
  ({ POST } = await import("../app/api/ext/meetings/quick/route"));
});

const user = { id: "user-1", isActive: true, deletedAt: null };
const meeting = (meetingUrl: string, meetCode: string | null = null) => ({
  id: "m1", title: "Scheduled", meetingUrl, meetCode,
  startAt: new Date(), endAt: new Date(), organizerId: user.id, recorderId: user.id, recap: null,
});

for (const [invitation, browser] of [
  ["https://us02web.zoom.us/j/12345678901?pwd=abc", "https://app.zoom.us/wc/12345678901/join?pwd=def"],
  ["https://teams.microsoft.com/l/meetup-join/19%3ameeting_Test%40thread.v2/0", "https://teams.cloud.microsoft/v2/#/meet/19%3ameeting_Test%40thread.v2"],
  ["https://teams.microsoft.com/meet/123456789012?p=abc", "https://teams.microsoft.com/meet/123456789012?p=def"],
]) {
  test(`lookup matches stored invitation to browser URL: ${invitation}`, async (t) => {
    t.mock.method(prisma.extensionToken, "findUnique", async () => ({ id: "token", revokedAt: null, user }) as never);
    t.mock.method(prisma.extensionToken, "update", async () => ({}) as never);
    t.mock.method(prisma.meeting, "findMany", async (query: Prisma.MeetingFindManyArgs) => {
      assert.deepEqual(query?.where?.OR, [
        { organizerId: user.id }, { recorderId: user.id }, { attendees: { some: { userId: user.id } } },
      ]);
      assert.equal(query?.where?.status, "SCHEDULED");
      assert.ok(query?.where?.startAt && query?.where?.endAt);
      return [meeting("https://zoom.us/j/98765432101"), meeting(invitation)] as never;
    });
    const response = await GET(new Request(`https://mycreative.test/api/ext/meetings/lookup?url=${encodeURIComponent(browser)}`, {
      headers: { Authorization: "Bearer mcr_test" },
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).meeting.meetingUrl, invitation);
  });
}

test("lookup preserves Google Meet code clients and rejects missing authentication", async (t) => {
  const unauthenticated = await GET(new Request("https://mycreative.test/api/ext/meetings/lookup?code=abc-defg-hij"));
  assert.equal(unauthenticated.status, 401);
  t.mock.method(prisma.extensionToken, "findUnique", async () => ({ id: "token", revokedAt: null, user }) as never);
  t.mock.method(prisma.extensionToken, "update", async () => ({}) as never);
  t.mock.method(prisma.meeting, "findMany", async (query: Prisma.MeetingFindManyArgs) => {
    assert.equal(query?.where?.meetCode, "abc-defg-hij");
    return [meeting("https://meet.google.com/abc-defg-hij", "abc-defg-hij")] as never;
  });
  const response = await GET(new Request("https://mycreative.test/api/ext/meetings/lookup?code=abc-defg-hij", {
    headers: { Authorization: "Bearer mcr_test" },
  }));
  assert.equal((await response.json()).meeting.id, "m1");
});

test("invalid links do not query meetings or match arbitrary room-like text", async (t) => {
  t.mock.method(prisma.extensionToken, "findUnique", async () => ({ id: "token", revokedAt: null, user }) as never);
  t.mock.method(prisma.extensionToken, "update", async () => ({}) as never);
  const find = t.mock.method(prisma.meeting, "findMany", async () => []);
  const response = await GET(new Request("https://mycreative.test/api/ext/meetings/lookup?url=https://evil.test/abc-defg-hij", {
    headers: { Authorization: "Bearer mcr_test" },
  }));
  assert.equal((await response.json()).meeting, null);
  assert.equal(find.mock.callCount(), 0);
});

test("quick meetings preserve Zoom URL and use a provider-specific default title", async (t) => {
  t.mock.method(prisma.extensionToken, "findUnique", async () => ({ id: "token", revokedAt: null, user }) as never);
  t.mock.method(prisma.extensionToken, "update", async () => ({}) as never);
  const meetingUrl = "https://zoom.us/j/12345678901?pwd=abc";
  t.mock.method(prisma.meeting, "create", async (query: Prisma.MeetingCreateArgs) => {
    assert.equal(query.data.meetingUrl, meetingUrl);
    assert.equal(query.data.title, "Họp Zoom (12345678901)");
    assert.equal(query.data.meetCode, null);
    return { ...meeting(meetingUrl), title: query.data.title } as never;
  });
  const response = await POST(new Request("https://mycreative.test/api/ext/meetings/quick", {
    method: "POST", headers: { Authorization: "Bearer mcr_test", "Content-Type": "application/json" },
    body: JSON.stringify({ meetingUrl }),
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).meeting.meetingUrl, meetingUrl);
});
