import assert from "node:assert/strict";
import test from "node:test";
import { executionWishWhere, projectWishChatMessage, readProjectWish } from "../lib/projectWishes";
import { deliverProjectWish, saveProjectWish, type ProjectWishDependencies } from "../lib/projectWishService";

const id = "48a9a654-1f1a-4057-a997-f58b4c96c651";
const input = { id, projectId: "p1", body: "Chúc team thành công!" };

function fixture() {
  type Row = { id: string; projectId: string; authorId: string; body: string; chatSpaceName: string | null; chatSentAt: Date | null };
  const rows = new Map<string, Row>();
  const events: string[] = [];
  const sends: { space: string; requestId: string }[] = [];
  const config = { space: "spaces/AAA" as string | null, ready: true, sendOK: true, available: true, failSave: false, failMark: false };
  const db = {
    project: {
      findFirst: async () => config.available ? { id: "p1", googleChatSpaceName: config.space } : null,
    },
    projectWish: {
      upsert: async ({ create }: { create: Omit<Row, "chatSentAt"> }) => {
        if (config.failSave) throw new Error("DB unavailable");
        if (!rows.has(create.id)) { rows.set(create.id, { ...create, chatSentAt: null }); events.push("saved"); }
        return rows.get(create.id)!;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id);
        return row ? { ...row, author: { name: "Đồng nghiệp ngoài dự án" }, project: { name: "Chương trình", googleChatSpaceName: config.space } } : null;
      },
      updateMany: async ({ where, data }: { where: { id: string }; data: { chatSpaceName: string } }) => {
        const row = rows.get(where.id)!;
        if (!row.chatSpaceName) row.chatSpaceName = data.chatSpaceName;
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: { chatSentAt: Date } }) => {
        if (config.failMark) throw new Error("DB acknowledgement failed");
        Object.assign(rows.get(where.id)!, data);
      },
    },
  };
  const deps: ProjectWishDependencies = {
    db: db as unknown as ProjectWishDependencies["db"],
    chatReady: () => config.ready,
    send: async (space, _message, requestId) => {
      events.push("sent"); sends.push({ space, requestId });
      return config.sendOK ? { ok: true } : { ok: false, error: "Chat unavailable" };
    },
  };
  return { deps, rows, config, events, sends };
}

test("execution window uses Vietnam midnight on both sides of a UTC day boundary", () => {
  for (const [now, start] of [
    ["2026-11-04T16:59:59Z", "2026-11-03T17:00:00Z"],
    ["2026-11-04T17:00:00Z", "2026-11-04T17:00:00Z"],
  ]) {
    const where = executionWishWhere(new Date(now));
    const dayStart = new Date(start);
    assert.deepEqual(where.executionStartAt, { lt: new Date(+dayStart + 86400000) });
    assert.deepEqual(where.OR, [
      { executionEndAt: { gte: dayStart } },
      { executionEndAt: null, executionStartAt: { gte: dayStart } },
    ]);
    assert.deepEqual(where.status, { notIn: ["DONE", "CANCEL", "PENDING", "FAIL"] });
    assert.equal(where.members, undefined, "the celebration board also serves colleagues outside the project");
  }
});

test("wish text is trimmed and rejected when empty, missing or over 500 characters", () => {
  assert.deepEqual(readProjectWish("  Thành công nhé!  "), { body: "Thành công nhé!" });
  for (const body of [null, "  ", "a", "x".repeat(501)]) assert.ok("error" in readProjectWish(body));
  assert.ok("body" in readProjectWish("x".repeat(500)));
});

test("Chat card identifies the author, escapes markup and has no project link", () => {
  const message = projectWishChatMessage("Dự án A", "An <all>", "Cố lên <users/all> & team!\nThành công nhé!");
  const card = message.cardsV2![0].card;
  assert.equal(card.header.subtitle, "Dự án A");
  assert.match(JSON.stringify(card), /An &lt;all&gt;/);
  assert.match(JSON.stringify(card), /&lt;users\/all&gt; &amp; team!<br>/);
  assert.ok(!JSON.stringify(card).includes("openLink"));
});

test("a colleague's wish is saved before Chat and repeated submissions do not send again", async () => {
  const f = fixture();
  assert.ok((await saveProjectWish(input, "outside-member", f.deps)).success);
  assert.deepEqual(f.events, ["saved", "sent"]);
  assert.equal(f.rows.get(id)!.authorId, "outside-member");
  await saveProjectWish(input, "outside-member", f.deps);
  assert.equal(f.rows.size, 1);
  assert.equal(f.sends.length, 1);
});

test("failed delivery preserves the comment and retries reuse the same Chat request ID", async () => {
  const f = fixture(); f.config.sendOK = false;
  const result = await saveProjectWish(input, "u1", f.deps);
  assert.ok(result.success && result.warning);
  assert.equal(f.rows.get(id)!.chatSentAt, null);
  f.config.sendOK = true;
  assert.ok((await deliverProjectWish(id, "u1", f.deps)).success);
  assert.deepEqual(f.sends, [{ space: "spaces/AAA", requestId: id }, { space: "spaces/AAA", requestId: id }]);
  assert.ok(f.rows.get(id)!.chatSentAt);
});

test("an acknowledgement failure can retry without changing the Chat request ID", async () => {
  const f = fixture(); f.config.failMark = true;
  assert.ok((await saveProjectWish(input, "u1", f.deps)).warning);
  f.config.failMark = false;
  await deliverProjectWish(id, "u1", f.deps);
  assert.equal(new Set(f.sends.map((call) => call.requestId)).size, 1);
});

test("no group or no app configuration keeps local wishes and sends nothing", async () => {
  for (const mode of ["space", "ready"] as const) {
    const f = fixture();
    if (mode === "space") f.config.space = null;
    else f.config.ready = false;
    const result = await saveProjectWish(input, "u1", f.deps);
    assert.ok(result.success && result.warning);
    assert.equal(f.rows.size, 1);
    assert.equal(f.sends.length, 0);
    f.config.space = "spaces/AAA"; f.config.ready = true;
    await deliverProjectWish(id, "u1", f.deps);
    assert.equal(f.sends.length, 1);
  }
});

test("a different author, reused request or relinked group cannot redirect a wish", async () => {
  const f = fixture(); f.config.sendOK = false;
  await saveProjectWish(input, "u1", f.deps);
  assert.ok((await deliverProjectWish(id, "u2", f.deps)).error);
  assert.ok((await saveProjectWish(input, "u2", f.deps)).error);
  assert.ok((await saveProjectWish({ ...input, body: "Changed content" }, "u1", f.deps)).error);
  f.config.space = "spaces/BBB";
  assert.ok((await deliverProjectWish(id, "u1", f.deps)).warning);
  assert.equal(f.sends.length, 1);
});

test("invalid submissions, programs outside today and persistence failures never call Chat", async () => {
  const f = fixture();
  assert.ok((await saveProjectWish({ ...input, id: "bad-id" }, "u1", f.deps)).error);
  assert.ok((await saveProjectWish({ ...input, body: "  " }, "u1", f.deps)).error);
  f.config.available = false;
  assert.ok((await saveProjectWish(input, "u1", f.deps)).error);
  f.config.available = true; f.config.failSave = true;
  assert.ok((await saveProjectWish(input, "u1", f.deps)).error);
  assert.equal(f.sends.length, 0);
  assert.equal(f.rows.size, 0);
});
