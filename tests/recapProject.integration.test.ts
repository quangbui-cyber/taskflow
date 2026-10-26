import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { archivePublishedRecap, attachMeetingProject } from "../lib/recapProject";
import { publishRecap } from "../lib/recapWorkflow";

const databaseUrl = process.env.TASKFLOW_TEST_DATABASE_URL;

test("attach standalone meetings to projects and archive only published recaps", { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/taskflow_recap_test(?:_|$)/);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const owner = await db.user.create({ data: { name: "Organizer", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" } });
  const other = await db.user.create({ data: { name: "Other", email: `${randomUUID()}@test.invalid`, passwordHash: "unused" } });
  const viewer = { id: owner.id, role: "USER" };
  const projects = await Promise.all(["Archive A", "Archive B", "Tasks stay here"].map((name) => db.project.create({
    data: { name, ownerId: owner.id, category: "INTERNAL", members: { create: [{ userId: owner.id }, { userId: other.id }] } },
  })));
  const meetings: string[] = [];
  async function standalone(published: boolean) {
    const meeting = await db.meeting.create({ data: {
      title: "Meeting already ended", organizerId: owner.id,
      startAt: new Date("2026-01-01T01:00:00Z"), endAt: new Date("2026-01-01T02:00:00Z"),
    } });
    meetings.push(meeting.id);
    const recap = await db.meetingRecap.create({ data: { meetingId: meeting.id, status: "READY", content: "PUBLIC_APPROVED_VERSION" } });
    if (published) await publishRecap(db, recap.id, new Date("2026-01-01T03:00:00Z"));
    await db.meetingRecap.update({ where: { id: recap.id }, data: { content: "PRIVATE_UNSENT_DRAFT" } });
    return { meeting, recap };
  }
  try {
    const { meeting, recap } = await standalone(true);
    const task = await db.task.create({ data: { title: "Existing follow-up", creatorId: owner.id, projectId: projects[2].id } });
    const action = await db.meetingRecapActionItem.create({ data: { recapId: recap.id, title: task.title, taskId: task.id } });

    await t.test("a project member who does not manage the meeting cannot attach it", async () => {
      const result = await attachMeetingProject(db, meeting.id, projects[0].id, { id: other.id, role: "USER" });
      assert.ok("error" in result);
      assert.equal((await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).projectId, null);
    });
    await t.test("organizer must have project access", async () => {
      await db.projectMember.delete({ where: { projectId_userId: { projectId: projects[0].id, userId: owner.id } } });
      assert.ok("error" in await attachMeetingProject(db, meeting.id, projects[0].id, viewer));
      await db.projectMember.create({ data: { projectId: projects[0].id, userId: owner.id } });
    });
    await t.test("ended meeting attaches and writes the published Word, leaving tasks untouched", async () => {
      const result = await attachMeetingProject(db, meeting.id, projects[0].id, viewer);
      assert.ok("archived" in result && result.archived);
      const file = await db.projectFile.findFirstOrThrow({ where: { projectId: projects[0].id } });
      assert.match(file.name, /\.docx$/);
      assert.ok(file.data, "the recap stays in the database until it is pushed to Drive");
      const docx = Buffer.from(file.data).toString("utf8");
      assert.match(docx, /PUBLIC_APPROVED_VERSION/);
      assert.doesNotMatch(docx, /PRIVATE_UNSENT_DRAFT/);
      assert.equal((await db.task.findUniqueOrThrow({ where: { id: task.id } })).projectId, projects[2].id);
      assert.equal((await db.meetingRecapActionItem.findUniqueOrThrow({ where: { id: action.id } })).taskId, task.id);
      assert.equal((await db.meetingRecap.findUniqueOrThrow({ where: { id: recap.id } })).projectFileId, file.id);
    });
    await t.test("repeated clicks do not create duplicate files, and cannot move a linked meeting", async () => {
      await Promise.all([attachMeetingProject(db, meeting.id, projects[0].id, viewer), attachMeetingProject(db, meeting.id, projects[0].id, viewer)]);
      assert.equal(await db.projectFile.count({ where: { projectId: projects[0].id } }), 1);
      assert.ok("error" in await attachMeetingProject(db, meeting.id, projects[1].id, viewer));
      assert.equal((await db.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).projectId, projects[0].id);
    });
    await t.test("unpublished draft links now but exports only when explicitly published", async () => {
      const pending = await standalone(false);
      const result = await attachMeetingProject(db, pending.meeting.id, projects[1].id, viewer);
      assert.ok("archived" in result && !result.archived);
      assert.equal(await db.projectFile.count({ where: { projectId: projects[1].id } }), 0);
      const sentAt = new Date();
      const publication = await publishRecap(db, pending.recap.id, sentAt);
      assert.ok(publication);
      assert.equal(await archivePublishedRecap(db, pending.meeting.id, viewer, publication, sentAt), true);
      assert.equal(await db.projectFile.count({ where: { projectId: projects[1].id } }), 1);
      assert.equal(await archivePublishedRecap(db, pending.meeting.id, viewer, publication, new Date(0)), false);
    });
    await t.test("two different projects chosen concurrently cannot split meeting and archive", async () => {
      const pending = await standalone(true);
      const results = await Promise.all(projects.slice(0, 2).map((project) => attachMeetingProject(db, pending.meeting.id, project.id, viewer)));
      assert.equal(results.filter((result) => "archived" in result).length, 1);
      const linked = await db.meeting.findUniqueOrThrow({ where: { id: pending.meeting.id }, include: { recap: true } });
      const file = await db.projectFile.findUniqueOrThrow({ where: { id: linked.recap!.projectFileId! } });
      assert.equal(file.projectId, linked.projectId);
    });
    await t.test("failed file creation rolls back the project link", async () => {
      const pending = await standalone(true);
      // Simulate the uploader being removed after authentication, forcing an FK failure.
      await assert.rejects(attachMeetingProject(db, pending.meeting.id, projects[0].id, { id: "deleted-uploader", role: "ADMIN" }));
      assert.equal((await db.meeting.findUniqueOrThrow({ where: { id: pending.meeting.id } })).projectId, null);
      assert.equal((await db.meetingRecap.findUniqueOrThrow({ where: { id: pending.recap.id } })).projectFileId, null);
    });
  } finally {
    await db.meeting.deleteMany({ where: { id: { in: meetings } } });
    await db.project.deleteMany({ where: { id: { in: projects.map((project) => project.id) } } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await db.$disconnect();
  }
});
