import { PrismaClient } from "@prisma/client";

export function crmTestDatabaseUrl(): string | undefined {
  return process.env.TASKFLOW_TEST_DATABASE_URL;
}

export function assertCrmTestDb(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CRM tests require a valid local test database URL");
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !/^\/taskflow_crm_test(?:_|$)/.test(url.pathname)
  ) {
    throw new Error("CRM tests require a local taskflow_crm_test database");
  }
}

export function createCrmTestDb(): PrismaClient {
  const url = crmTestDatabaseUrl();
  if (!url) throw new Error("TASKFLOW_TEST_DATABASE_URL is required");
  assertCrmTestDb(url);
  return new PrismaClient({ datasources: { db: { url } } });
}

function assertFixturePrefix(prefix: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(prefix)) {
    throw new Error("CRM fixture prefix must be a unique, non-empty test identifier");
  }
}

export async function seedCrmFixture(db: PrismaClient, prefix: string) {
  assertFixturePrefix(prefix);
  return db.$transaction(async (tx) => {
    const createUser = (role: string, systemRole: string) => tx.user.create({
      data: { name: `${prefix} ${role}`, email: `${prefix}-${role}@test.invalid`, passwordHash: "unused", role: systemRole },
    });
    const admin = await createUser("admin", "ADMIN");
    const manager = await createUser("manager", "ACCOUNT");
    const pic = await createUser("pic", "ACCOUNT");
    const assignee = await createUser("assignee", "USER");
    const outsider = await createUser("outsider", "USER");
    const team = await tx.salesTeam.create({ data: { name: `${prefix} Team` } });
    const picAccount = await tx.account.create({ data: { name: `${prefix} PIC`, userId: pic.id, teamId: team.id } });
    const otherAccount = await tx.account.create({ data: { name: `${prefix} Other`, userId: manager.id, teamId: team.id } });
    await tx.salesTeam.update({ where: { id: team.id }, data: { leaderId: otherAccount.id } });
    const client = await tx.client.create({ data: { name: `${prefix} Client` } });
    return { admin, manager, pic, assignee, outsider, team, picAccount, otherAccount, client };
  });
}

export async function cleanupCrmFixture(db: PrismaClient, prefix: string): Promise<void> {
  assertFixturePrefix(prefix);
  await db.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { email: { startsWith: `${prefix}-`, endsWith: "@test.invalid" } }, select: { id: true } });
    const userIds = users.map(({ id }) => id);
    const projects = await tx.project.findMany({ where: { OR: [{ name: { startsWith: `${prefix} ` } }, { ownerId: { in: userIds } }] }, select: { id: true } });
    const projectIds = projects.map(({ id }) => id);
    await tx.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await tx.project.deleteMany({ where: { id: { in: projectIds } } });
    await tx.client.deleteMany({ where: { name: { startsWith: `${prefix} ` } } });
    await tx.salesTeam.updateMany({ where: { name: `${prefix} Team` }, data: { leaderId: null } });
    await tx.account.deleteMany({ where: { team: { name: `${prefix} Team` } } });
    await tx.salesTeam.deleteMany({ where: { name: `${prefix} Team` } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}
