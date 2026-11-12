/**
 * Tạo dữ liệu CRM tổng hợp để nghiệm thu trên đúng taskflow_crm_test ở localhost.
 * npx tsx scripts/crm/seed-manual-check.ts [--cleanup]
 * Mật khẩu thử nghiệm chỉ in khi tạo thành công. Cấu hình tổng hợp có bản sao để khôi phục.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { addDaysVn, crmWeekRange, vnDateKey, vnDayStart } from "../../lib/crm/dates";
import { planReminderSteps, type EventTiming } from "../../lib/crm/reminders";
import { getCrmSettings } from "../../lib/crm/settings";
import { produceMeetingDrafts } from "../../lib/crm/touchpoints";
import { assertCrmTestDb, cleanupCrmFixture, createCrmTestDb, crmTestDatabaseUrl } from "../../tests/helpers/crmTestDb";

const prefix = "manual-check";
const email = (role: string) => `${prefix}-${role}@test.invalid`;
const roles = [
  { key: "admin", role: "ADMIN", label: "Admin" },
  { key: "pic", role: "ACCOUNT", label: "PIC" },
  { key: "manager", role: "ACCOUNT", label: "AD/AM" },
  { key: "user", role: "USER", label: "USER" },
] as const;
const backupPrefix = `${prefix}.config.`;
type Db = ReturnType<typeof createCrmTestDb>;
type Backup = { value: Prisma.JsonValue; version: number; updatedById: string | null; updatedAt: string };

async function cleanup(db: Db) {
  const admin = await db.user.findUnique({ where: { email: email("admin") }, select: { id: true } });
  if (admin) {
    const migrated = await db.opportunity.count({ where: {
      legacyProjectId: { not: null }, client: { name: { startsWith: `${prefix} ` } },
    } });
    if (migrated) throw new Error("Khôi phục batch Project thử nghiệm trước khi dọn dữ liệu.");
    await db.$transaction(async (tx) => {
      const backups = await tx.crmSettingChange.findMany({
        where: { userId: admin.id, key: { startsWith: backupPrefix } },
      });
      for (const backup of backups) {
        const key = backup.key.slice(backupPrefix.length);
        const stored = backup.oldValue as Backup;
        const current = await tx.crmSetting.findUnique({ where: { key } });
        if (current?.updatedById !== admin.id) continue;
        await tx.crmSetting.update({ where: { key }, data: {
          value: stored.value === null ? Prisma.JsonNull : stored.value,
          version: stored.version, updatedById: stored.updatedById, updatedAt: new Date(stored.updatedAt),
        } });
      }
      await tx.crmSettingChange.deleteMany({ where: { userId: admin.id } });
    });
  }
  await cleanupCrmFixture(db, prefix);
}

async function seed(db: Db) {
  const now = new Date();
  const today = vnDayStart(now);
  const week = crmWeekRange(now);
  const credentials = await Promise.all(roles.map(async (role) => {
    const password = randomBytes(12).toString("base64url");
    return { ...role, email: email(role.key), password, passwordHash: await bcrypt.hash(password, 10) };
  }));
  const levels = ["S", "A", "B", "C"] as const;
  const created = await db.$transaction(async (tx) => {
    if (await tx.user.count({ where: { email: { in: credentials.map((row) => row.email) } } })) {
      throw new Error("Dữ liệu nghiệm thu đã tồn tại. Dùng --cleanup trước khi tạo lại.");
    }
    const users = await Promise.all(credentials.map(({ label, role, email: address, passwordHash }) =>
      tx.user.create({ data: { name: `${prefix} ${label}`, role, email: address, passwordHash } })));
    const [admin, pic, manager, viewer] = users;
    const team = await tx.salesTeam.create({ data: { name: `${prefix} Team thử` } });
    const account = await tx.account.create({ data: { name: pic.name, userId: pic.id, teamId: team.id } });
    const managerAccount = await tx.account.create({ data: { name: manager.name, userId: manager.id, teamId: team.id } });
    await tx.salesTeam.update({ where: { id: team.id }, data: { leaderId: managerAccount.id } });
    await tx.crmTeamManager.create({ data: { teamId: team.id, userId: manager.id } });

    const syntheticSettings = {
      "tier.potentialScale": levels.map((level) => ({ key: level, label: `Mức thử ${level}` })),
      "tier.matrix": { revenueBands: [{ key: "sample", label: "Dải thử nghiệm", minPercentile: 0 }], cells: { sample: Object.fromEntries(levels.map((level) => [level, level])) } },
      "pipeline.mode": { mode: "OPPORTUNITY_OFFICIAL", pilotTeamIds: [team.id], plannedCutoverDate: null },
    } satisfies Record<string, Prisma.InputJsonValue>;
    for (const [key, value] of Object.entries(syntheticSettings)) {
      const previous = await tx.crmSetting.findUniqueOrThrow({ where: { key } });
      await tx.crmSettingChange.create({ data: {
        key: backupPrefix + key, userId: admin.id, userName: admin.name, newValue: value,
        oldValue: { value: previous.value, version: previous.version, updatedById: previous.updatedById, updatedAt: previous.updatedAt.toISOString() },
      } });
      await tx.crmSetting.update({ where: { key }, data: { value, version: { increment: 1 }, updatedById: admin.id } });
    }
    const clients = await Promise.all(Array.from({ length: 20 }, (_, i) => tx.client.create({ data: {
      name: `${prefix} Khách ${String(i + 1).padStart(2, "0")}`,
      picAccountId: account.id, responsibleTeamId: team.id, potentialLevel: levels[i % 5] ?? null,
    } })));
    await tx.buyingUnit.create({ data: { clientId: clients[0].id, name: "Đơn vị mua thử" } });
    await tx.task.createMany({ data: clients.slice(0, 13).map((client, i) => ({
      clientId: client.id, creatorId: pic.id, assigneeId: pic.id, title: `Liên hệ khách ${i + 1}`,
      dueDate: i < 6 ? addDaysVn(week.end, -1) : addDaysVn(week.start, -1),
      crmKind: i === 0 ? "APPOINTMENT" : "NEXT_STEP", status: "TODO",
    })) });
    const { reminderOffsets } = await getCrmSettings(tx);
    const programs = ["MICE", "OUTING", "YEP"];
    for (const [i, programTypeCode] of programs.entries()) {
      const date = addDaysVn(today, 100 + 15 * i);
      const [year, month] = vnDateKey(date).split("-").map(Number);
      const timing: EventTiming = { precision: "DAY", date, year, month, quarter: null };
      const steps = planReminderSteps(timing, reminderOffsets[programTypeCode] ?? [], today);
      await tx.expectedEvent.create({ data: {
        ...timing, clientId: clients[i].id, createdById: pic.id, source: "CLIENT_CONFIRMED", programTypeCode,
        expectedEventSteps: { create: steps.map((step) => ({ ...step, revision: 0 })) },
      } });
    }
    const stages = ["CARE", "BRIEF", "BIDDING", "BIDDING"];
    const expected = vnDateKey(addDaysVn(today, 60)).split("-").map(Number);
    const opportunities = await Promise.all(stages.map((stage, i) => tx.opportunity.create({ data: {
      clientId: clients[i].id, name: `${prefix} ${["Chăm sóc", "Brief", "Bidding bàn giao", "Bidding hủy"][i]}`,
      picAccountId: account.id, responsibleTeamId: team.id, stage, source: "OTHER",
      programTypeCode: programs[i % programs.length], expectedYear: expected[0], expectedMonth: expected[1],
      demandSignal: "Nhu cầu tổng hợp để nghiệm thu",
    } })));
    for (const opportunity of opportunities.slice(2)) {
      await tx.task.create({ data: { opportunityId: opportunity.id, creatorId: pic.id, assigneeId: pic.id,
        title: "Chuẩn bị thầu thử nghiệm", dueDate: addDaysVn(week.end, -1), status: "TODO", crmKind: "BID_PREP" } });
    }
    await tx.projectFile.create({ data: {
      opportunityId: opportunities[2].id, uploaderId: pic.id, name: "tai-lieu-thu.txt",
      mimeType: "text/plain", size: 8, data: Buffer.from("CRM demo"),
    } });
    const startAt = new Date(addDaysVn(today, 1).getTime() + 9 * 3600_000);
    await tx.meeting.create({ data: {
      opportunityId: opportunities[2].id, organizerId: pic.id, title: `${prefix} Họp chuẩn bị thầu`,
      startAt, endAt: new Date(startAt.getTime() + 3600_000),
    } });
    const past = addDaysVn(startAt, -3);
    const recapMeeting = await tx.meeting.create({ data: {
      clientId: clients[0].id, organizerId: pic.id, title: `${prefix} Họp chăm sóc`,
      startAt: past, endAt: new Date(past.getTime() + 3600_000),
      attendees: { create: [{ userId: manager.id }, { userId: viewer.id }] },
      recap: { create: { status: "READY", content: "Biên bản tổng hợp", sentAt: now,
        publishedSnapshot: { content: "Biên bản tổng hợp", actionItems: [] } } },
    } });
    const legacy = await Promise.all(["BIDDING", "FAIL"].map((status, i) => tx.project.create({ data: {
      name: `${prefix} Project cũ ${status}`, ownerId: admin.id, accountId: account.id,
      clientId: clients[18 + i].id, category: "CLIENT", status, type: "MICE",
      createdAt: new Date("2026-08-01T00:00:00Z"),
    } })));
    return { recapMeeting, team, clients, opportunities, legacy };
  }, { timeout: 20_000 });
  try {
    const draft = await produceMeetingDrafts(db, created.recapMeeting.id, "RECAP");
    if (draft.created !== 1) throw new Error("Không tạo được nháp nghiệm thu.");
  } catch (error) {
    await cleanup(db);
    throw error;
  }
  console.log("Dữ liệu tổng hợp: 20 khách, 4 Cơ hội, 2 Project cũ.");
  console.log(`Team: ${created.team.id} · Khách mẫu: ${created.clients[0].id}`);
  console.log(`Bidding bàn giao: ${created.opportunities[2].id} · Bidding hủy: ${created.opportunities[3].id}`);
  console.log(`Biên bản mẫu: ${created.recapMeeting.id} · Project cũ: ${created.legacy.map(({ id }) => id).join(",")}`);
  for (const { label, email: address, password } of credentials) console.log(`${label} | ${address} | ${password}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--cleanup")) throw new Error("Tham số không hợp lệ.");
  const url = crmTestDatabaseUrl();
  if (!url) throw new Error("Cần URL DB CRM test.");
  assertCrmTestDb(url);
  const target = new URL(url);
  if (target.pathname !== "/taskflow_crm_test" || target.hash ||
    [...target.searchParams.keys()].some((key) => ["host", "hostname", "hostaddr", "port", "dbname", "database", "service", "servicefile", "options"].includes(key.toLowerCase()))) {
    throw new Error("Chỉ dùng đúng database local taskflow_crm_test.");
  }
  const db = createCrmTestDb();
  try {
    if (args[0] === "--cleanup") {
      await cleanup(db);
      console.log("Đã dọn dữ liệu nghiệm thu CRM.");
    } else {
      await seed(db);
    }
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  console.error(/^(CRM tests require|Chỉ dùng đúng|Tham số|Cần URL|Dữ liệu nghiệm thu|Khôi phục batch|Không tạo được nháp)/.test(message)
    ? message : "Không thể chuẩn bị dữ liệu nghiệm thu CRM.");
  process.exitCode = 1;
});
