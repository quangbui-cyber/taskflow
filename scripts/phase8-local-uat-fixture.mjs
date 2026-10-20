import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const DATABASE_URL = "postgresql://postgres@127.0.0.1:55439/taskflow";
const MARKER = "phase8-uat-local-20261020";
const PROJECT_NAME = `${MARKER} Bảng AC`;
const PASSWORD = "gasangtao1810"; // Same seeded local demo password; never use this fixture outside the pinned test DB.
const emails = {
  account: `${MARKER}-account@example.test`,
  contributor: `${MARKER}-contributor@example.test`,
  dd: `${MARKER}-dd@example.test`,
};

if (process.env.DATABASE_URL !== DATABASE_URL) throw new Error("Phase 8 UAT fixture only uses the pinned local taskflow database.");
if (!["create", "cleanup", "status"].includes(process.argv[2])) throw new Error("Use create, status or cleanup.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

function icLine(id, description, unit, unitPrice) {
  return {
    id, description, unit, quantity: "1", days: "1", unitPrice: String(unitPrice), basis: "NET", vatPercent: "0",
    cost: { rawNet: `${unitPrice}/1`, rawVat: "0/1", rawGross: `${unitPrice}/1`, net: String(unitPrice), vat: "0", gross: String(unitPrice) },
  };
}

async function status() {
  const project = await prisma.project.findFirst({ where: { name: PROJECT_NAME }, select: { id: true, name: true, ownerId: true } });
  if (!project) return { exists: false };
  const users = await prisma.user.findMany({ where: { email: { in: Object.values(emails) } }, select: { id: true, email: true, role: true } });
  const sheet = await prisma.actualCostSheet.findUnique({ where: { projectId: project.id }, select: { currentRevision: true, revisions: { select: { revision: true, state: true } } } });
  return { exists: true, projectId: project.id, projectName: project.name, users, sheet };
}

async function create() {
  if ((await status()).exists) throw new Error("Fixture đã tồn tại; hãy dùng status hoặc cleanup, không tạo trùng.");
  if (await prisma.user.count({ where: { email: { in: Object.values(emails) } } })) throw new Error("Đã có email fixture; dừng để tránh ghi đè.");
  if (await prisma.workflowRoleGrant.count({ where: { role: "AC_DD", revokedAt: null } })) throw new Error("Đã có DD đang hoạt động; không thay đổi vai trò hiện có.");
  const admin = await prisma.user.findUnique({ where: { email: "admin@mycreative.vn" }, select: { id: true, role: true, isActive: true } });
  if (!admin || admin.role !== "ADMIN" || !admin.isActive) throw new Error("Không tìm thấy Admin test được phép.");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const project = await prisma.$transaction(async tx => {
    const account = await tx.user.create({ data: { email: emails.account, name: "AC UAT · Account", role: "ACCOUNT", passwordHash } });
    const contributor = await tx.user.create({ data: { email: emails.contributor, name: "AC UAT · Người cùng nhập", role: "USER", passwordHash } });
    const dd = await tx.user.create({ data: { email: emails.dd, name: "AC UAT · Phó Giám đốc", role: "USER", passwordHash } });
    const project = await tx.project.create({
      data: { name: PROJECT_NAME, ownerId: account.id, status: "ON_PROCESS", members: { create: [
        { userId: account.id, role: "owner" }, { userId: contributor.id }, { userId: dd.id },
      ] } },
    });
    await tx.costFlowWorkspace.create({ data: { projectId: project.id, data: {
      config: { accountantId: account.id, managerId: account.id, ceoId: "", operationUserIds: [contributor.id] },
      closed: false,
      revisions: [{ id: `${MARKER}-ic-r1`, number: 1, requestId: `${MARKER}-ic-source`, effective: true, lines: [
        icLine(`${MARKER}-ic-sound`, "Âm thanh", "bộ", 100000),
        icLine(`${MARKER}-ic-staff`, "Nhân sự hiện trường", "người", 200000),
        icLine(`${MARKER}-ic-transport`, "Vận chuyển", "chuyến", 150000),
      ], poIds: [], evidenceIds: [], createdBy: account.id }],
      beneficiaries: [], expenses: [], pos: [], quotations: [], briefs: [], vendorPaymentMilestones: [],
    } } });
    await tx.workflowRoleGrant.create({ data: { userId: dd.id, role: "AC_DD", grantedById: admin.id } });
    return project;
  });
  console.log(JSON.stringify({ created: true, projectId: project.id, url: `http://localhost:3017/projects/${project.id}/costflow`, accounts: emails, password: PASSWORD, note: "Synthetic local fixture; no production data or cash" }, null, 2));
}

async function cleanup() {
  const fixture = await status();
  if (!fixture.exists) throw new Error("Không tìm thấy fixture chính xác để dọn.");
  const projectId = fixture.projectId;
  const userIds = fixture.users.map(user => user.id);
  if (fixture.users.length !== 3 || fixture.users.some(user => !Object.values(emails).includes(user.email))) throw new Error("Tài khoản fixture không khớp; dừng dọn.");
  if (fixture.users.find(user => user.email === emails.account)?.id !== (await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true } })).ownerId) throw new Error("Chủ Project không khớp fixture; dừng dọn.");
  const dependentCounts = {
    cash: await prisma.costFlowCash.count({ where: { projectId } }),
    payment: await prisma.actualCostApplication.count({ where: { projectId } }),
    settlement: await prisma.projectSettlementDossier.count({ where: { projectId } }),
    task: await prisma.task.count({ where: { projectId } }),
    projectFile: await prisma.projectFile.count({ where: { projectId } }),
  };
  if (Object.values(dependentCounts).some(Boolean)) throw new Error(`Fixture có bản ghi ngoài phạm vi AC; dừng dọn: ${JSON.stringify(dependentCounts)}`);
  const sheet = await prisma.actualCostSheet.findUnique({ where: { projectId }, select: { id: true } });
  const workflowRequestIds = (await prisma.workflowRequest.findMany({ where: { projectId }, select: { id: true, kind: true } })).map(item => item.id);
  if (await prisma.workflowRequest.count({ where: { projectId, kind: { not: "ACTUAL_COST_APPROVAL" } } })) throw new Error("Fixture có hồ sơ Trình duyệt khác AC; dừng dọn.");
  await prisma.actualCostSheetEvent.deleteMany({ where: { projectId } });
  await prisma.actualCostSheetRevisionLine.deleteMany({ where: { projectId } });
  await prisma.actualCostApproval.deleteMany({ where: { projectId } });
  await prisma.actualCostFundingAllocation.deleteMany({ where: { projectId } });
  await prisma.actualCostEvidenceLink.deleteMany({ where: { projectId } });
  await prisma.actualCostVersion.deleteMany({ where: { projectId } });
  await prisma.actualCostLine.deleteMany({ where: { projectId } });
  await prisma.actualCostSheetRevision.deleteMany({ where: { projectId } });
  if (sheet) await prisma.actualCostSheet.delete({ where: { id: sheet.id } });
  if (workflowRequestIds.length) await prisma.workflowRequest.deleteMany({ where: { id: { in: workflowRequestIds }, projectId } });
  await prisma.costFlowEvidence.deleteMany({ where: { projectId } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.workflowRoleGrant.deleteMany({ where: { userId: { in: userIds }, role: "AC_DD" } });
  await prisma.costFlowWorkspace.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { id: projectId, name: PROJECT_NAME } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, email: { in: Object.values(emails) } } });
  console.log(JSON.stringify({ cleaned: true, projectId, users: fixture.users.length }));
}

try {
  if (process.argv[2] === "create") await create();
  else if (process.argv[2] === "cleanup") await cleanup();
  else console.log(JSON.stringify(await status(), null, 2));
} finally {
  await prisma.$disconnect();
}
