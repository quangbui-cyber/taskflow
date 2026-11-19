import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const databaseUrl = process.env.TASKFLOW_TEST_DATABASE_URL;

test("customer mail sends each recipient once, retries temporary errors and closes the campaign", { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.equal(url.hostname, "127.0.0.1", "Integration tests require an isolated local database");
  assert.match(url.pathname, /_test(?:_|$)/);
  process.env.DATABASE_URL = databaseUrl;
  const { prisma } = await import("../lib/prisma");
  const { releaseStuckRecipients, sendCampaignBatch, startDueCampaigns, STUCK_ERROR } = await import("../lib/customerMailSend");

  const key = randomUUID().slice(0, 8);
  const sender = await prisma.mailSender.create({ data: { name: `Ga test ${key}`, replyTo: "hello@example.com" } });
  const content = {
    subject: "Cảm ơn {{xung_ho}} {{ten_goi}}",
    title: "Lời cảm ơn",
    greeting: "{{Xung_ho}} {{ten_goi}} thân mến,",
    body: "Cảm ơn {{xung_ho}}.",
    signOff: "Thân mến,",
    signature: "Ga",
  };
  const campaign = (name: string, status = "sending") =>
    prisma.mailCampaign.create({ data: { ...content, name: `${name} ${key}`, senderId: sender.id, status } });
  const people = (campaignId: string, count: number) =>
    prisma.mailRecipient.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        campaignId,
        fullName: `Người ${index}`,
        email: `p${index}-${key}@example.com`,
        callName: `N${index}`,
        salutation: index % 2 ? "anh" : "chi",
        createdAt: new Date(Date.now() + index),
      })),
    });

  try {
    await t.test("temporary errors retry on the next run, permanent ones fail with a reason", async () => {
      const first = await campaign("retry");
      await people(first.id, 3);
      const calls: string[] = [];
      let p1Attempts = 0;
      const deliver = async (message: { to: string[]; subject: string }, options: { fromName: string; replyTo?: string | null }) => {
        const to = message.to[0];
        calls.push(to);
        assert.equal(options.fromName, sender.name);
        assert.equal(options.replyTo, "hello@example.com");
        if (to.startsWith("p0-")) {
          assert.equal(message.subject, "Cảm ơn chị N0");
          return { ok: true as const };
        }
        if (to.startsWith("p1-")) {
          p1Attempts += 1;
          return p1Attempts === 1 ? { ok: false as const, transient: true, error: "Mất kết nối tới máy chủ email." } : { ok: true as const };
        }
        return { ok: false as const, transient: false, error: "Địa chỉ email không tồn tại." };
      };

      const run1 = await sendCampaignBatch(first.id, { gapMs: 0, deliver });
      assert.deepEqual(run1, { sent: 1, failed: 0, attempted: 2 });
      const run2 = await sendCampaignBatch(first.id, { gapMs: 0, deliver });
      assert.deepEqual(run2, { sent: 1, failed: 1, attempted: 2 });

      const rows = await prisma.mailRecipient.findMany({ where: { campaignId: first.id }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(rows.map((row) => row.status), ["sent", "sent", "failed"]);
      assert.equal(rows[2].error, "Địa chỉ email không tồn tại.");
      assert.equal(rows[1].attempts, 2);
      const done = await prisma.mailCampaign.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(done.status, "done");
      assert.ok(done.finishedAt);
      assert.equal(calls.length, 4);
    });

    await t.test("two runs at the same time never send the same letter twice", async () => {
      const second = await campaign("race");
      await people(second.id, 12);
      const counts = new Map<string, number>();
      const deliver = async (message: { to: string[] }) => {
        counts.set(message.to[0], (counts.get(message.to[0]) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true as const };
      };
      await Promise.all([
        sendCampaignBatch(second.id, { gapMs: 0, deliver, limit: 20 }),
        sendCampaignBatch(second.id, { gapMs: 0, deliver, limit: 20 }),
        sendCampaignBatch(second.id, { gapMs: 0, deliver, limit: 20 }),
      ]);
      assert.equal(counts.size, 12);
      assert.ok([...counts.values()].every((count) => count === 1));
      assert.equal(await prisma.mailRecipient.count({ where: { campaignId: second.id, status: "sent" } }), 12);
    });

    await t.test("draft campaigns send nothing; due schedules start; stuck rows are failed, not resent", async () => {
      const draft = await campaign("draft", "draft");
      await people(draft.id, 1);
      const never = async () => assert.fail("draft campaign must not send");
      assert.deepEqual(await sendCampaignBatch(draft.id, { gapMs: 0, deliver: never }), { sent: 0, failed: 0, attempted: 0 });

      const scheduled = await prisma.mailCampaign.create({
        data: { ...content, name: `scheduled ${key}`, senderId: sender.id, status: "scheduled", sendAt: new Date(Date.now() - 1000) },
      });
      const later = await prisma.mailCampaign.create({
        data: { ...content, name: `later ${key}`, senderId: sender.id, status: "scheduled", sendAt: new Date(Date.now() + 3600_000) },
      });
      await startDueCampaigns();
      assert.equal((await prisma.mailCampaign.findUniqueOrThrow({ where: { id: scheduled.id } })).status, "sending");
      assert.equal((await prisma.mailCampaign.findUniqueOrThrow({ where: { id: later.id } })).status, "scheduled");

      const stuck = await prisma.mailRecipient.create({
        data: {
          campaignId: scheduled.id, fullName: "Kẹt", email: `stuck-${key}@example.com`, callName: "Kẹt", salutation: "ban",
          status: "sending", claimedAt: new Date(Date.now() - 20 * 60_000),
        },
      });
      await releaseStuckRecipients();
      const released = await prisma.mailRecipient.findUniqueOrThrow({ where: { id: stuck.id } });
      assert.equal(released.status, "failed");
      assert.equal(released.error, STUCK_ERROR);
    });
  } finally {
    await prisma.mailCampaign.deleteMany({ where: { senderId: sender.id } });
    await prisma.mailSender.delete({ where: { id: sender.id } });
    await prisma.$disconnect();
  }
});
