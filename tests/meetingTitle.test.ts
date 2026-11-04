import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { renameRecapMeeting } from "../lib/recapProject";

function fixture(published = false) {
  const meeting = {
    title: "Tên cũ", organizerId: "organizer", recorderId: "recorder", projectId: published ? "project" : null,
    startAt: new Date("2020-01-01T02:00:00Z"), endAt: new Date("2020-01-01T03:00:00Z"), status: "SCHEDULED",
    room: null, organizer: { name: "Người tổ chức" }, attendees: [],
    recap: {
      id: "recap", sentAt: new Date("2020-01-01T04:00:00Z"), projectFileId: "file",
      content: "Bản nháp chưa gửi", publishedSnapshot: { content: "## Tóm tắt\n- Nội dung đã gửi", actionItems: [] },
    },
  };
  const updates: unknown[] = [];
  const files: { name: string; data: Uint8Array }[] = [];
  const syncUpdates: unknown[] = [];
  const tx = {
    $queryRaw: async () => [],
    meeting: {
      findUnique: async () => meeting,
      findUniqueOrThrow: async () => meeting,
      update: async ({ data }: { data: { title: string } }) => {
        updates.push(data);
        Object.assign(meeting, data);
      },
    },
    meetingRecap: {
      findUnique: async () => published ? { id: "recap" } : null,
      update: async () => undefined,
      updateMany: async (query: unknown) => { syncUpdates.push(query); return { count: 1 }; },
    },
    projectFile: {
      findFirst: async () => ({ id: "file" }),
      update: async ({ data }: { data: { name: string; data: Uint8Array } }) => { files.push(data); return { id: "file" }; },
    },
  };
  const db = { $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx) } as unknown as PrismaClient;
  return { db, meeting, updates, files, syncUpdates };
}

for (const viewer of [
  { id: "organizer", role: "MEMBER" }, { id: "recorder", role: "MEMBER" }, { id: "admin", role: "ADMIN" },
]) {
  test(`authorized ${viewer.id} can rename a finished meeting without changing its schedule`, async () => {
    const f = fixture();
    const before = { startAt: f.meeting.startAt, endAt: f.meeting.endAt, status: f.meeting.status };
    const result = await renameRecapMeeting(f.db, "meeting", "  Tên mới  ", viewer);
    assert.ok(!("error" in result));
    assert.deepEqual(f.updates, [{ title: "Tên mới" }]);
    assert.deepEqual({ startAt: f.meeting.startAt, endAt: f.meeting.endAt, status: f.meeting.status }, before);
    assert.deepEqual(f.syncUpdates, [{ where: { meetingId: "meeting" }, data: { driveSyncedSentAt: null } }]);
  });
}

test("attendees and other users cannot rename the meeting", async () => {
  const f = fixture();
  assert.ok("error" in await renameRecapMeeting(f.db, "meeting", "Tên khác", { id: "attendee", role: "MEMBER" }));
  assert.deepEqual(f.updates, []);
});

test("empty, short and oversized titles are rejected; identical titles cause no writes", async () => {
  const f = fixture();
  const viewer = { id: "organizer", role: "MEMBER" };
  for (const title of ["   ", "A", "x".repeat(121)]) {
    assert.ok("error" in await renameRecapMeeting(f.db, "meeting", title, viewer));
  }
  assert.deepEqual(await renameRecapMeeting(f.db, "meeting", "Tên cũ", viewer), { projectId: null, archived: false, changed: false });
  assert.deepEqual(f.updates, []);
  assert.deepEqual(f.syncUpdates, []);
});

test("renaming updates the archived Word title while preserving the published content and file identity", async () => {
  const f = fixture(true);
  const result = await renameRecapMeeting(f.db, "meeting", "Buổi họp mới", { id: "recorder", role: "MEMBER" });
  assert.ok(!("error" in result) && result.archived);
  assert.equal(f.files.length, 1);
  assert.match(f.files[0].name, /Buổi họp mới/);
  const document = Buffer.from(f.files[0].data).toString();
  assert.match(document, /Buổi họp mới/);
  assert.match(document, /Nội dung đã gửi/);
  assert.ok(!document.includes("Bản nháp chưa gửi"));
  assert.equal(f.meeting.recap.projectFileId, "file");
  assert.equal(f.meeting.recap.sentAt.toISOString(), "2020-01-01T04:00:00.000Z");
});
