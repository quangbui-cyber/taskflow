import { PrismaClient } from "@prisma/client";
import { seedQuotationTemplates } from "../prisma/quotationTemplateSeeds";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Thiếu DATABASE_URL.");
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error("DỪNG: targeted quotation-template seed chỉ được phép chạy trên database local.");
}

async function main() {
  const prisma = new PrismaClient();
  try {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error("Không tìm thấy Admin đang hoạt động để ghi nhận người tạo template.");
  const result = await seedQuotationTemplates(prisma, admin.id);
  console.log(`${result.created ? "Đã tạo" : "Đã có"} template: ${result.template.name} (${result.template.id})`);
  console.log(`Người tạo seed: ${admin.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
