/**
 * Kiểm tra cấu hình CRM trước pilot. Chỉ đọc dữ liệu đã lưu, không tự điền giá trị còn thiếu.
 * Chạy: npx tsx scripts/crm/prepilot-check.ts [--json]
 * Mã thoát: 0 đủ cấu hình, 1 còn thiếu, 2 có lỗi.
 */
import { evaluatePrepilot, loadPrepilotInput, PREPILOT_STATUS_LABELS } from "../../lib/crm/prepilot";

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
    console.error("Cách dùng: npx tsx scripts/crm/prepilot-check.ts [--json]");
    return 2;
  }

  const url = process.env.DATABASE_URL ?? "";
  let host: string;
  try {
    const target = new URL(url);
    if (!["postgresql:", "postgres:"].includes(target.protocol) || !target.hostname) throw new Error();
    host = target.hostname;
  } catch {
    console.error("Thiếu hoặc sai cấu hình kết nối cơ sở dữ liệu.");
    return 2;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const now = new Date();
    const result = evaluatePrepilot(await loadPrepilotInput(prisma, now));
    if (args[0] === "--json") {
      console.log(JSON.stringify({ database: host, checkedAt: now.toISOString(), ready: result.ready, items: result.items }));
    } else {
      console.log(`Database: ${host}`);
      for (const item of result.items) {
        console.log(`${item.label}: ${PREPILOT_STATUS_LABELS[item.status]} · ${item.detail}`);
      }
      console.log(result.ready ? "Sẵn sàng pilot" : `Chưa sẵn sàng: ${result.missing.length} mục chưa cấu hình`);
    }
    return result.ready ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().then((code) => { process.exitCode = code; }).catch(() => {
  // Prisma and URL errors can contain connection details, so print a safe message.
  console.error("Không thể đọc cấu hình CRM từ cơ sở dữ liệu.");
  process.exitCode = 2;
});
