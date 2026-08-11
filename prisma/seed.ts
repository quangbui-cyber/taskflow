import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH } from "../lib/password";

const prisma = new PrismaClient();
const DEFAULT_PASSWORD = "gasangtao1810";

const USERS = [
  { key: "admin", name: "Quản trị Creative", email: "admin@mycreative.vn", role: "ADMIN" },
  { key: "lan", name: "Lan Account", email: "lan@mycreative.vn", role: "ACCOUNT" },
  { key: "minh", name: "Minh Account", email: "minh@mycreative.vn", role: "ACCOUNT" },
  { key: "ha", name: "Hà Account", email: "ha@mycreative.vn", role: "ACCOUNT" },
  { key: "an", name: "An Thiết kế", email: "an@mycreative.vn", role: "USER" },
  { key: "binh", name: "Bình Nội dung", email: "binh@mycreative.vn", role: "USER" },
  { key: "dung", name: "Dũng Kỹ thuật", email: "dung@mycreative.vn", role: "USER" },
  { key: "huong", name: "Hương Media", email: "huong@mycreative.vn", role: "USER" },
  { key: "nam", name: "Nam Sản xuất", email: "nam@mycreative.vn", role: "USER" },
  { key: "mai", name: "Mai Điều phối", email: "mai@mycreative.vn", role: "USER" },
] as const;

type UserKey = (typeof USERS)[number]["key"];

const PROJECTS: Array<{
  name: string;
  description: string;
  status: string;
  type: string;
  revenue: number;
  color: string;
  owner: "lan" | "minh" | "ha";
  client: number;
  memberKeys: UserKey[];
  /** Ngày bắt đầu thực hiện, tính từ hôm nay (âm = đã qua); undefined = chưa đặt lịch */
  execStartInDays?: number;
  /** Số ngày chạy (1 = trong ngày) */
  execDurationDays?: number;
}> = [
  {
    name: "Tái định vị thương hiệu Nova Bank",
    description: "Chiến lược thương hiệu và hệ thống nhận diện mới.",
    status: "BIDDING",
    type: "OTHER",
    revenue: 1_200_000_000,
    color: "#a855f7",
    owner: "lan",
    client: 0,
    memberKeys: ["an", "binh", "mai"],
  },
  {
    name: "Website thương mại Mộc Living",
    description: "Thiết kế và phát triển website bán hàng nội thất.",
    status: "ON_PROCESS",
    type: "OTHER",
    execStartInDays: -1,
    execDurationDays: 3,
    revenue: 450_000_000,
    color: "#6366f1",
    owner: "minh",
    client: 1,
    memberKeys: ["an", "dung", "mai"],
  },
  {
    name: "Chiến dịch Tết GreenFoods",
    description: "Ý tưởng lớn, nội dung và sản xuất hình ảnh Tết.",
    status: "ON_PROCESS",
    type: "ACTIVATION",
    execStartInDays: 9,
    execDurationDays: 3,
    revenue: 780_000_000,
    color: "#10b981",
    owner: "lan",
    client: 2,
    memberKeys: ["binh", "huong", "nam", "mai"],
  },
  {
    name: "Ra mắt sản phẩm Lumi Beauty",
    description: "Kế hoạch ra mắt sản phẩm và truyền thông đa kênh.",
    status: "PENDING",
    type: "EVENT",
    execStartInDays: 24,
    execDurationDays: 1,
    revenue: 620_000_000,
    color: "#ec4899",
    owner: "ha",
    client: 3,
    memberKeys: ["an", "binh", "huong"],
  },
  {
    name: "Video giới thiệu TechWave",
    description: "Phim doanh nghiệp giới thiệu năng lực và văn hóa.",
    status: "DONE",
    type: "OTHER",
    revenue: 320_000_000,
    color: "#06b6d4",
    owner: "minh",
    client: 4,
    memberKeys: ["binh", "huong", "nam"],
  },
  {
    name: "Sự kiện Nova Partner Day",
    description: "Tổ chức sự kiện đối tác thường niên.",
    status: "DONE",
    type: "MICE",
    execStartInDays: -16,
    execDurationDays: 2,
    revenue: 950_000_000,
    color: "#f59e0b",
    owner: "ha",
    client: 0,
    memberKeys: ["nam", "mai", "huong"],
  },
  {
    name: "Booth GreenFoods Vietnam Expo",
    description: "Thiết kế và thi công gian hàng triển lãm.",
    status: "CANCEL",
    type: "ACTIVATION",
    execStartInDays: -6,
    execDurationDays: 3,
    revenue: 280_000_000,
    color: "#64748b",
    owner: "lan",
    client: 2,
    memberKeys: ["an", "nam", "mai"],
  },
  {
    name: "Pitch ứng dụng Nova Pay",
    description: "Đề xuất UX/UI và kế hoạch ra mắt ứng dụng fintech.",
    status: "FAIL",
    type: "OTHER",
    revenue: 500_000_000,
    color: "#ef4444",
    owner: "minh",
    client: 0,
    memberKeys: ["an", "dung", "binh"],
  },
  {
    name: "Social Always-on Mộc Living",
    description: "Vận hành nội dung mạng xã hội trong sáu tháng.",
    status: "BIDDING",
    type: "PUR",
    revenue: 360_000_000,
    color: "#8b5cf6",
    owner: "ha",
    client: 1,
    memberKeys: ["binh", "huong", "mai"],
  },
  {
    name: "Annual Report TechWave 2026",
    description: "Biên tập, thiết kế và xuất bản báo cáo thường niên.",
    status: "ON_PROCESS",
    type: "PUR",
    execStartInDays: 40,
    execDurationDays: 1,
    revenue: 410_000_000,
    color: "#0ea5e9",
    owner: "lan",
    client: 4,
    memberKeys: ["an", "binh", "dung", "mai"],
  },
];

function daysFromNow(days: number) {
  const date = new Date();
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function taskStatuses(projectStatus: string) {
  if (projectStatus === "DONE" || projectStatus === "FAIL") {
    return ["DONE", "DONE", "DONE"];
  }
  if (projectStatus === "CANCEL") return ["DONE", "DONE", "TODO"];
  return ["DONE", "IN_PROGRESS", "TODO"];
}

/**
 * Rào chắn an toàn: seed demo XOÁ SẠCH database rồi tạo lại dữ liệu mẫu.
 * Chỉ cho phép chạy khi DATABASE_URL trỏ tới máy cá nhân (localhost).
 * Muốn tạo Admin trên production thì dùng: SEED_MODE=admin npm run seed
 * (chế độ đó chỉ upsert 1 tài khoản, không xoá gì).
 */
function assertLocalDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Thiếu DATABASE_URL.");
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("DATABASE_URL không hợp lệ.");
  }

  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (!isLocal) {
    throw new Error(
      [
        "DỪNG: seed demo sẽ XOÁ TOÀN BỘ dữ liệu, nhưng DATABASE_URL đang trỏ tới",
        `database từ xa (${host}) chứ không phải máy cá nhân.`,
        "",
        "Nếu bạn muốn tạo/cập nhật tài khoản Admin trên database thật, hãy dùng:",
        "  SEED_MODE=admin npm run seed",
        "",
        "Nếu thật sự muốn seed demo, hãy trỏ DATABASE_URL về localhost.",
      ].join("\n")
    );
  }
}

async function cleanDatabase() {
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.recognition.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.taskFollower.deleteMany(),
    prisma.task.deleteMany(),
    prisma.projectMember.deleteMany(),
    prisma.project.deleteMany(),
    prisma.memberGroupMember.deleteMany(),
    prisma.memberGroup.deleteMany(),
    prisma.account.deleteMany(),
    prisma.salesTeam.deleteMany(),
    prisma.client.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function seedAdminOnly() {
  const name = process.env.ADMIN_NAME ?? "Quản trị Creative";
  const email = (process.env.ADMIN_EMAIL ?? "admin@mycreative.vn").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự khi SEED_MODE=admin.`
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, role: "ADMIN", passwordHash },
    create: { name, email, role: "ADMIN", passwordHash },
  });
  console.log(`Tài khoản Admin đã sẵn sàng: ${admin.email}`);
}

async function main() {
  if (process.env.SEED_MODE === "admin") {
    await seedAdminOnly();
    return;
  }

  assertLocalDatabase();
  await cleanDatabase();

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const users = new Map<UserKey, { id: string; name: string; email: string }>();

  for (const definition of USERS) {
    const user = await prisma.user.create({
      data: {
        name: definition.name,
        email: definition.email,
        role: definition.role,
        passwordHash,
      },
      select: { id: true, name: true, email: true },
    });
    users.set(definition.key, user);
  }

  const userId = (key: UserKey) => {
    const user = users.get(key);
    if (!user) throw new Error(`Missing seeded user: ${key}`);
    return user.id;
  };

  await Promise.all([
    prisma.user.update({ where: { id: userId("lan") }, data: { managerId: userId("admin") } }),
    prisma.user.update({ where: { id: userId("minh") }, data: { managerId: userId("admin") } }),
    prisma.user.update({ where: { id: userId("ha") }, data: { managerId: userId("admin") } }),
    prisma.user.update({ where: { id: userId("an") }, data: { managerId: userId("lan") } }),
    prisma.user.update({ where: { id: userId("binh") }, data: { managerId: userId("lan") } }),
    prisma.user.update({ where: { id: userId("dung") }, data: { managerId: userId("minh") } }),
    prisma.user.update({ where: { id: userId("huong") }, data: { managerId: userId("ha") } }),
    prisma.user.update({ where: { id: userId("nam") }, data: { managerId: userId("ha") } }),
    prisma.user.update({ where: { id: userId("mai") }, data: { managerId: userId("minh") } }),
  ]);

  await prisma.recognition.createMany({
    data: [
      {
        senderId: userId("lan"),
        recipientId: userId("dung"),
        message: "Cảm ơn Dũng đã chủ động ở lại hỗ trợ team xử lý phần kỹ thuật dù đó không phải việc của bạn.",
        category: "KINDNESS",
        visibility: "COMPANY",
        createdAt: daysFromNow(0),
      },
      {
        senderId: userId("minh"),
        recipientId: userId("an"),
        message: "Cảm ơn An đã kiên nhẫn thử thêm nhiều phương án để bản thiết kế cuối cùng thật sự thuyết phục.",
        category: "INSPIRATION",
        visibility: "COMPANY",
        createdAt: daysFromNow(-1),
      },
      {
        senderId: userId("ha"),
        recipientId: userId("mai"),
        message: "Cảm ơn Mai đã luôn nhớ những chi tiết nhỏ và giúp mọi người yên tâm trong ngày chạy sự kiện.",
        category: "SUPPORT",
        visibility: "COMPANY",
        createdAt: daysFromNow(-1),
      },
      {
        senderId: userId("an"),
        recipientId: userId("binh"),
        message: "Cảm ơn Bình vì những góp ý rất chân thành và luôn tạo cảm giác thoải mái khi cùng làm việc.",
        category: "CARE",
        visibility: "COMPANY",
        createdAt: daysFromNow(-2),
      },
      {
        senderId: userId("binh"),
        recipientId: userId("huong"),
        message: "Cảm ơn Hương đã cứu mình một phen với bộ ảnh gấp và vẫn giữ năng lượng tích cực cho cả nhóm.",
        category: "SUPPORT",
        visibility: "COMPANY",
        createdAt: daysFromNow(-2),
      },
      {
        senderId: userId("dung"),
        recipientId: userId("mai"),
        message: "Cảm ơn Mai đã hỏi thăm và giúp mình sắp xếp lại lịch khi biết mình có việc gia đình.",
        category: "CARE",
        visibility: "PRIVATE",
        createdAt: daysFromNow(-3),
      },
      {
        senderId: userId("huong"),
        recipientId: userId("nam"),
        message: "Cảm ơn Nam đã chia sẻ kinh nghiệm hiện trường và luôn sẵn sàng hỗ trợ người mới.",
        category: "INSPIRATION",
        visibility: "COMPANY",
        createdAt: daysFromNow(-3),
      },
      {
        senderId: userId("mai"),
        recipientId: userId("admin"),
        message: "Cảm ơn anh đã lắng nghe và tạo không gian để mọi người có thể nói thật điều mình nghĩ.",
        category: "KINDNESS",
        visibility: "COMPANY",
        createdAt: daysFromNow(-4),
      },
    ],
  });

  const clients = await Promise.all(
    ["Nova Group", "Mộc Living", "GreenFoods", "Lumi Beauty", "TechWave"].map(
      (name) => prisma.client.create({ data: { name } })
    )
  );

  const [teamOne, teamTwo] = await Promise.all([
    prisma.salesTeam.create({ data: { name: "Team Kinh doanh 1" } }),
    prisma.salesTeam.create({ data: { name: "Team Kinh doanh 2" } }),
  ]);

  const accounts = new Map<"lan" | "minh" | "ha", { id: string }>();
  for (const definition of [
    { key: "lan" as const, teamId: teamOne.id },
    { key: "minh" as const, teamId: teamOne.id },
    { key: "ha" as const, teamId: teamTwo.id },
  ]) {
    const user = users.get(definition.key)!;
    const account = await prisma.account.create({
      data: { name: user.name, userId: user.id, teamId: definition.teamId },
      select: { id: true },
    });
    accounts.set(definition.key, account);
  }

  await Promise.all([
    prisma.memberGroup.create({
      data: {
        name: "Nhóm Sáng tạo",
        members: {
          create: ["an", "binh", "huong"].map((key) => ({
            userId: userId(key as UserKey),
          })),
        },
      },
    }),
    prisma.memberGroup.create({
      data: {
        name: "Nhóm Sản xuất",
        members: {
          create: ["dung", "nam", "mai"].map((key) => ({
            userId: userId(key as UserKey),
          })),
        },
      },
    }),
    prisma.memberGroup.create({
      data: {
        name: "Nhóm Account",
        members: {
          create: ["lan", "minh", "ha"].map((key) => ({
            userId: userId(key as UserKey),
          })),
        },
      },
    }),
  ]);

  const taskNames = [
    "Nhận brief và xác nhận phạm vi",
    "Thực hiện nội dung chính",
    "Nghiệm thu và bàn giao",
  ];

  for (const [projectIndex, definition] of PROJECTS.entries()) {
    const account = accounts.get(definition.owner)!;
    const memberKeys = [
      ...new Set<UserKey>(["admin", definition.owner, ...definition.memberKeys]),
    ];
    const statuses = taskStatuses(definition.status);

    await prisma.project.create({
      data: {
        name: definition.name,
        description: definition.description,
        status: definition.status,
        type: definition.type,
        executionStartAt:
          definition.execStartInDays !== undefined
            ? daysFromNow(definition.execStartInDays)
            : null,
        executionEndAt:
          definition.execStartInDays !== undefined &&
          (definition.execDurationDays ?? 1) > 1
            ? daysFromNow(
                definition.execStartInDays +
                  (definition.execDurationDays ?? 1) -
                  1
              )
            : null,
        revenue: definition.revenue,
        color: definition.color,
        onProcessAt:
          definition.status === "ON_PROCESS" || definition.status === "DONE"
            ? daysFromNow(-(projectIndex + 1) * 18)
            : null,
        completedAt:
          definition.status === "DONE" ? daysFromNow(-(projectIndex + 1) * 14) : null,
        ownerId: userId(definition.owner),
        clientId: clients[definition.client].id,
        accountId: account.id,
        members: {
          create: memberKeys.map((key) => ({
            userId: userId(key),
            role: key === definition.owner ? "owner" : "member",
          })),
        },
        tasks: {
          create: taskNames.map((title, taskIndex) => {
            const status = statuses[taskIndex];
            const assigneeKey = definition.memberKeys[taskIndex % definition.memberKeys.length];
            return {
              title,
              description: `${title} cho dự án ${definition.name}.`,
              result: status === "DONE" ? "Đã hoàn tất và cập nhật tài liệu bàn giao." : null,
              status,
              priority: ["HIGH", "MEDIUM", "LOW"][taskIndex],
              dueDate: daysFromNow(projectIndex + taskIndex - 3),
              completedAt: status === "DONE" ? daysFromNow(projectIndex + taskIndex - 5) : null,
              order: taskIndex + 1,
              assigneeId: userId(assigneeKey),
              creatorId: userId(definition.owner),
            };
          }),
        },
      },
    });
  }

  const demoComments = [
    {
      projectName: "Annual Report TechWave 2026",
      taskTitle: "Thực hiện nội dung chính",
      author: "binh" as UserKey,
      body: "Mình đã cập nhật bản nội dung vòng 1, nhờ team xem và góp ý trước 16h nhé.",
    },
    {
      projectName: "Chiến dịch Tết GreenFoods",
      taskTitle: "Nghiệm thu và bàn giao",
      author: "mai" as UserKey,
      body: "Client đã phản hồi, cần bổ sung thêm file hình ngang cho kênh Google Display.",
    },
    {
      projectName: "Website thương mại Mộc Living",
      taskTitle: "Thực hiện nội dung chính",
      author: "dung" as UserKey,
      body: "Trang sản phẩm đã lên môi trường kiểm thử, mọi người kiểm tra giúp phần mobile.",
    },
  ];

  for (const definition of demoComments) {
    const task = await prisma.task.findFirstOrThrow({
      where: {
        title: definition.taskTitle,
        project: { name: definition.projectName },
      },
      select: {
        id: true,
        title: true,
        projectId: true,
        assigneeId: true,
        creatorId: true,
      },
    });
    await prisma.comment.create({
      data: {
        body: definition.body,
        taskId: task.id,
        authorId: userId(definition.author),
      },
    });
    await prisma.taskFollower.create({
      data: { taskId: task.id, userId: userId("admin") },
    });
    const recipients = [
      ...new Set([task.assigneeId, task.creatorId, userId("admin")]),
    ].filter((id): id is string => !!id && id !== userId(definition.author));
    await prisma.notification.createMany({
      data: recipients.map((recipientId) => ({
        userId: recipientId,
        type: "COMMENT",
        message: `${users.get(definition.author)!.name} đã bình luận vào task “${task.title}”: ${definition.body}`,
        taskId: task.id,
        projectId: task.projectId,
      })),
    });
  }

  console.log("\nDữ liệu myCreative đã được làm sạch và tạo mới.");
  console.log(`Mật khẩu mặc định: ${DEFAULT_PASSWORD}`);
  console.table(
    USERS.map((user) => ({
      name: user.name,
      email: user.email,
      role: user.role,
    }))
  );
  console.log(`Đã tạo ${USERS.length} tài khoản và ${PROJECTS.length} dự án.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
