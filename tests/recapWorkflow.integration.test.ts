import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { completeRecapDraft, createLinkedRecapTask, lockRecap, publishRecap, resolveRecapSuggestion } from "../lib/recapWorkflow";
import { publishedActionProgress, readPublishedRecap, readRecapSuggestions, toRecapActionView } from "../lib/recapPublication";

const databaseUrl = process.env.TASKFLOW_TEST_DATABASE_URL;

test("recap publication, regeneration and concurrent review preserve data on PostgreSQL", { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.equal(url.hostname, "127.0.0.1", "Integration tests require an isolated local database");
  assert.match(url.pathname, /^\/taskflow_recap_test(?:_|$)/);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const key = randomUUID();
  const user = await db.user.create({ data: { name: "Recap test", email: `${key}@test.invalid`, passwordHash: "unused" } });
  const project = await db.project.create({ data: { name: "Recap test", ownerId: user.id } });
  const meeting = await db.meeting.create({ data: { title: "Recap test", startAt: new Date(), endAt: new Date(), organizerId: user.id, projectId: project.id } });
  let recap = await db.meetingRecap.create({ data: { meetingId: meeting.id, status: "PROCESSING", processingStartedAt: new Date("2026-10-22T01:00:00Z") } });
  const initialRow = { order: 0, title: "Gửi báo giá", ownerId: user.id, ownerName: null, dueDate: new Date("2026-10-23T10:00:00Z"), dueText: null };
  try {
    await t.test("first generation creates items, then publication freezes the reviewed version", async () => {
      assert.equal(await completeRecapDraft(db, recap.id, recap.processingStartedAt!, "Bản đầu đã duyệt", [initialRow], randomUUID), true);
      const snapshot = await publishRecap(db, recap.id, new Date("2026-10-22T02:00:00Z"));
      assert.equal(snapshot?.content, "Bản đầu đã duyệt");
      assert.equal(snapshot?.actionItems.length, 1);
    });

    const action = await db.meetingRecapActionItem.findFirstOrThrow({ where: { recapId: recap.id } });
    const task = await db.task.create({ data: { title: "Task đã tạo", projectId: project.id, creatorId: user.id, status: "DONE" } });
    await db.meetingRecapActionItem.update({ where: { id: action.id }, data: { title: "Việc sửa tay", dueDate: new Date("2026-11-03T10:00:00Z"), taskId: task.id, doneAt: new Date() } });
    // Explicitly share the reviewed edits and task link before starting another AI pass.
    await publishRecap(db, recap.id, new Date("2026-10-22T03:00:00Z"));
    const frozen = (await db.meetingRecap.findUniqueOrThrow({ where: { id: recap.id } })).publishedSnapshot;
    const before = await db.meetingRecapActionItem.findUniqueOrThrow({ where: { id: action.id } });

    await t.test("rewriting keeps the published snapshot and every edited field/task link", async () => {
      const startedAt = new Date("2026-10-22T04:00:00Z");
      await db.meetingRecap.update({ where: { id: recap.id }, data: { status: "PROCESSING", processingStartedAt: startedAt } });
      assert.equal(await publishRecap(db, recap.id, new Date()), null, "Cannot publish a running draft");
      assert.equal(await completeRecapDraft(db, recap.id, startedAt, "Bản nháp AI chưa gửi", [initialRow, { ...initialRow, title: "Việc mới từ AI" }], randomUUID), true);
      const after = await db.meetingRecapActionItem.findUniqueOrThrow({ where: { id: action.id } });
      assert.deepEqual(after, before);
      recap = await db.meetingRecap.findUniqueOrThrow({ where: { id: recap.id } });
      assert.deepEqual(recap.publishedSnapshot, frozen);
      assert.equal(readPublishedRecap(recap.publishedSnapshot)?.content, "Bản đầu đã duyệt");
      assert.equal(await db.meetingRecapActionItem.count({ where: { recapId: recap.id } }), 1);
      assert.equal(readRecapSuggestions(recap.actionSuggestions).length, 2);
      const snapshot = readPublishedRecap(recap.publishedSnapshot)!;
      const publicItems = publishedActionProgress(snapshot, [toRecapActionView({ ...after, owner: { id: user.id, name: user.name, avatarUrl: null }, task: { ...task, project: { name: project.name } } })]);
      assert.equal(publicItems[0].task?.id, task.id);
      assert.equal(publicItems[0].done, true);
    });

    await t.test("two clicks accept one suggestion once and never create a task", async () => {
      const suggestion = readRecapSuggestions(recap.actionSuggestions).find((row) => row.title === "Việc mới từ AI")!;
      const results = await Promise.all([resolveRecapSuggestion(db, recap.id, suggestion.id, true), resolveRecapSuggestion(db, recap.id, suggestion.id, true)]);
      assert.equal(results.filter((result) => "success" in result).length, 1);
      assert.equal(await db.meetingRecapActionItem.count({ where: { recapId: recap.id, title: suggestion.title } }), 1);
      assert.equal(await db.task.count({ where: { projectId: project.id } }), 1);
      assert.deepEqual((await db.meetingRecap.findUniqueOrThrow({ where: { id: recap.id } })).publishedSnapshot, frozen);
    });

    await t.test("failed or superseded AI work cannot alter the published version or existing tasks", async () => {
      await db.meetingRecap.update({ where: { id: recap.id }, data: { status: "FAILED", error: "AI failed" } });
      assert.equal(await completeRecapDraft(db, recap.id, new Date("2026-10-22T04:00:00Z"), "Stale content", [], randomUUID), false);
      assert.deepEqual((await db.meetingRecap.findUniqueOrThrow({ where: { id: recap.id } })).publishedSnapshot, frozen);
      assert.equal((await db.meetingRecapActionItem.findUniqueOrThrow({ where: { id: action.id } })).taskId, task.id);
    });

    await t.test("publishing waits for a concurrent writer, then snapshots a coherent draft", async () => {
      let release!: () => void;
      let acquired!: () => void;
      const ready = new Promise<void>((resolve) => { acquired = resolve; });
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const writer = db.$transaction(async (tx) => {
        await lockRecap(tx, recap.id);
        acquired();
        await gate;
        await tx.meetingRecap.update({ where: { id: recap.id }, data: { status: "READY", content: "Bản mới đã duyệt" } });
      });
      await ready;
      const sending = publishRecap(db, recap.id, new Date("2026-10-22T05:00:00Z"));
      release();
      await writer;
      const snapshot = await sending;
      assert.equal(snapshot?.content, "Bản mới đã duyệt");
      assert.equal(snapshot?.actionItems.length, 2);
      assert.equal(snapshot?.actionItems.find((row) => row.id === action.id)?.task?.id, task.id);
    });

    await t.test("migration backfills already-shared recaps with Vietnam dates and task metadata", async () => {
      await db.$executeRaw`UPDATE "MeetingRecap" SET "publishedSnapshot" = NULL WHERE id = ${recap.id}`;
      const sql = await readFile(new URL("../prisma/migrations/20261023150000_recap_drafts_and_publication/migration.sql", import.meta.url), "utf8");
      await db.$executeRawUnsafe(sql.slice(sql.indexOf('UPDATE "MeetingRecap"')));
      const snapshot = readPublishedRecap((await db.meetingRecap.findUniqueOrThrow({ where: { id: recap.id } })).publishedSnapshot)!;
      assert.equal(snapshot.content, "Bản mới đã duyệt");
      const published = snapshot.actionItems.find((row) => row.id === action.id)!;
      assert.equal(published.dueDate, "2026-11-03");
      assert.equal(published.task?.projectName, project.name);
      assert.equal(published.done, true);
    });

    await t.test("two create-task clicks link exactly one task using the latest reviewed fields", async () => {
      await db.projectMember.create({ data: { projectId: project.id, userId: user.id } });
      const row = await db.meetingRecapActionItem.findFirstOrThrow({ where: { recapId: recap.id, taskId: null } });
      await db.meetingRecapActionItem.update({ where: { id: row.id }, data: { title: "Đã chỉnh trước khi tạo task" } });
      const calls = await Promise.allSettled([
        createLinkedRecapTask(db, recap.id, row.id, project.id, user.id, "Test"),
        createLinkedRecapTask(db, recap.id, row.id, project.id, user.id, "Test"),
      ]);
      assert.equal(calls.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(await db.task.count({ where: { projectId: project.id } }), 2);
      const linked = await db.meetingRecapActionItem.findUniqueOrThrow({ where: { id: row.id }, include: { task: true } });
      assert.equal(linked.task?.title, "Đã chỉnh trước khi tạo task");
      assert.equal(linked.task?.assigneeId, user.id);
      assert.equal(linked.task?.dueDate?.toISOString(), initialRow.dueDate.toISOString());
    });
  } finally {
    await db.meeting.delete({ where: { id: meeting.id } });
    await db.project.delete({ where: { id: project.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
