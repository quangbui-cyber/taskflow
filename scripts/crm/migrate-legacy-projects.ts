/**
 * Chuyển Project cũ sang Cơ hội (thủ công, không thuộc build/deploy).
 * npx tsx scripts/crm/migrate-legacy-projects.ts              # chạy thử mặc định
 * npx tsx scripts/crm/migrate-legacy-projects.ts --dry-run    # cùng chế độ chạy thử
 * npx tsx scripts/crm/migrate-legacy-projects.ts --apply --batch <id chạy thử> --actor-email <email> [--approve-review-ids <file hoặc danh sách id cách nhau bằng dấu phẩy>]
 * npx tsx scripts/crm/migrate-legacy-projects.ts --rollback --batch <id batch apply> --actor-email <email>
 * --project-ids a,b giới hạn chạy thử; --year 2026; --out <thư mục> (mặc định OS temp).
 * File duyệt: id phân cách dấu phẩy/khoảng trắng/xuống dòng; dòng bắt đầu # là chú thích.
 * Chỉ localhost/127.0.0.1 với taskflow_crm_test[_...] được phép mặc định.
 * Target khác cần CRM_MIGRATION_ALLOWED_DATABASES=host/database (danh sách dấu phẩy);
 * khi ghi còn cần --confirm-database=<tên database>. Database taskflow luôn bị chặn.
 * Production chỉ chạy qua checklist crm-46, có bản sao lưu DB và người dùng duyệt trước.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertMigrationTarget, MigrationTargetError, MigrationUsageError, parseMigrationArgs, runMigrationCommand } from "../../lib/crm/migrationCli";
async function main() {
    const args = parseMigrationArgs(process.argv.slice(2)), url = process.env.DATABASE_URL ?? "";
    const target = assertMigrationTarget(url, process.env, args);
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
        const result = await runMigrationCommand(db, args, { now: () => new Date(), databaseHost: `${target.host}/${target.database}`, log: (line) => console.log(line),
            writeFile: async (filePath, content) => { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 }); },
            readTextFile: async (filePath) => { try {
                return await readFile(filePath, "utf8");
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT")
                    return null;
                throw error;
            } },
        });
        process.exitCode = result.exitCode;
    }
    finally {
        await db.$disconnect();
    }
}
void main().catch((error: unknown) => { console.error(error instanceof MigrationTargetError || error instanceof MigrationUsageError ? error.message : "Không hoàn tất lệnh chuyển dữ liệu."); process.exitCode = 1; });
