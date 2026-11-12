import path from "node:path";
import os from "node:os";
import { isValidKpiYear, vietnamYearMonth } from "../kpi";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { LegacyPlan } from "./legacyMigration";
import type { ReconciliationReport, ReconciliationSnapshot } from "./reconciliation";
import type { PipelineModeSetting } from "./pipelineMode";
export type MigrationArgs = {
    mode: "DRY_RUN" | "APPLY" | "ROLLBACK";
    batchId: string | null;
    projectIds: string[] | null;
    year: number;
    outDir: string;
    actorEmail: string | null;
    confirmDatabase: string | null;
    approveReviewIds: string | null;
    switchSource: boolean;
};
export class MigrationUsageError extends Error {
}
export class MigrationTargetError extends Error {
}
const usage = (message: string): never => { throw new MigrationUsageError(message); };
export function parseMigrationArgs(argv: string[]): MigrationArgs {
    const args: MigrationArgs = { mode: "DRY_RUN", batchId: null, projectIds: null, year: vietnamYearMonth(new Date()).year, outDir: path.join(os.tmpdir(), "taskflow-crm-migration"), actorEmail: null, confirmDatabase: null, approveReviewIds: null, switchSource: false };
    const seen = new Set<string>(), modes: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const [flag, ...inline] = argv[i].split("=");
        if (seen.has(flag))
            usage("Không lặp lại tham số.");
        seen.add(flag);
        if (flag === "--switch-source") {
            if (inline.length)
                usage("Cờ chế độ không nhận giá trị.");
            args.switchSource = true;
            continue;
        }
        if (["--dry-run", "--apply", "--rollback"].includes(flag)) {
            if (inline.length)
                usage("Cờ chế độ không nhận giá trị.");
            modes.push(flag);
            continue;
        }
        if (!["--batch", "--project-ids", "--year", "--out", "--actor-email", "--confirm-database", "--approve-review-ids"].includes(flag))
            usage("Tham số không hợp lệ.");
        const value = inline.length ? inline.join("=") : argv[++i];
        if (!value?.trim() || value.startsWith("--"))
            usage("Thiếu giá trị tham số.");
        switch (flag) {
            case "--batch":
                args.batchId = value;
                break;
            case "--project-ids":
                args.projectIds = parseReviewIdList(value);
                if (!args.projectIds.length)
                    usage("Thiếu id dự án.");
                break;
            case "--year":
                args.year = Number(value);
                if (!isValidKpiYear(args.year))
                    usage("Năm phải từ 2020 đến 2100.");
                break;
            case "--out":
                args.outDir = value;
                break;
            case "--actor-email":
                args.actorEmail = value;
                break;
            case "--confirm-database":
                args.confirmDatabase = value;
                break;
            case "--approve-review-ids":
                args.approveReviewIds = value;
                break;
        }
    }
    if (modes.length > 1)
        usage("Chỉ chọn một trong --dry-run, --apply, --rollback.");
    args.mode = modes[0] === "--apply" ? "APPLY" : modes[0] === "--rollback" ? "ROLLBACK" : "DRY_RUN";
    if (args.mode !== "DRY_RUN" && !args.batchId)
        usage("--apply và --rollback cần --batch.");
    if (args.mode === "DRY_RUN" && args.batchId)
        usage("Chạy thử không nhận --batch.");
    if (args.mode !== "DRY_RUN" && args.projectIds)
        usage("Giới hạn dự án ở bước chạy thử bằng --project-ids.");
    if (args.mode !== "APPLY" && args.approveReviewIds)
        usage("--approve-review-ids chỉ dùng với --apply.");
    if (args.mode !== "APPLY" && args.switchSource)
        usage("--switch-source chỉ dùng với --apply.");
    return args;
}
export function parseReviewIdList(text: string): string[] {
    return [...new Set(text.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("#")).join("\n").split(/[,\s]+/u).filter(Boolean))];
}
export function resolveApplySelection(records: {
    legacyProjectId: string;
    classification: string;
}[], plan: LegacyPlan, approvedIds: string[]) {
    const current = new Map(plan.rows.map((r) => [r.projectId, r.classification])), old = new Map(records.map((r) => [r.legacyProjectId, r.classification]));
    const changed = records.filter((r) => current.get(r.legacyProjectId) !== r.classification).map((r) => ({ projectId: r.legacyProjectId, before: r.classification, after: current.get(r.legacyProjectId) ?? null }));
    const approvals = [...new Set(approvedIds)], invalidApprovals = approvals.filter((id) => old.get(id) !== "NEEDS_REVIEW").map((projectId) => ({ projectId, classification: old.get(projectId) ?? null }));
    if (changed.length || invalidApprovals.length)
        return { ok: false as const, changed, invalidApprovals };
    return { ok: true as const, projectIds: records.filter((r) => r.classification === "MIGRATE").map((r) => r.legacyProjectId), approvedReviewIds: approvals };
}
export function assertMigrationTarget(databaseUrl: string, env: {
    [key: string]: string | undefined;
}, args: Pick<MigrationArgs, "mode" | "confirmDatabase">) {
    let url: URL;
    let database: string;
    try {
        url = new URL(databaseUrl);
        database = decodeURIComponent(url.pathname.slice(1));
    }
    catch {
        throw new MigrationTargetError("DATABASE_URL không hợp lệ.");
    }
    const host = url.hostname;
    if (url.hash || [...url.searchParams.keys()].some((key) => ["host", "hostname", "hostaddr", "port", "dbname", "database", "service", "servicefile", "options"].includes(key.toLowerCase())))
        throw new MigrationTargetError("URL chứa tham số thay đổi target database.");
    if (!["postgresql:", "postgres:"].includes(url.protocol) || !/^[a-zA-Z0-9_-]+$/.test(database) || database === "taskflow")
        throw new MigrationTargetError("Từ chối database; taskflow luôn bị chặn.");
    if (["127.0.0.1", "localhost"].includes(host) && /^taskflow_crm_test(?:_|$)/.test(database))
        return { host, database };
    const allow = (env.CRM_MIGRATION_ALLOWED_DATABASES ?? "").split(",").map((v) => v.trim());
    if (!allow.includes(`${host}/${database}`))
        throw new MigrationTargetError("Database chưa thuộc CRM_MIGRATION_ALLOWED_DATABASES.");
    if (args.mode !== "DRY_RUN" && args.confirmDatabase !== database)
        throw new MigrationTargetError("Cần --confirm-database bằng đúng tên database khi ghi.");
    return { host, database };
}
type Deps = {
    now: () => Date;
    writeFile: (filePath: string, content: string) => Promise<void>;
    readTextFile: (filePath: string) => Promise<string | null>;
    log: (line: string) => void;
    databaseHost: string;
};
type Result = {
    exitCode: 0 | 1;
    batchId: string | null;
    reportPaths: string[];
};
const jsonObject = (value: Prisma.JsonValue | null): Prisma.JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value : {};
/** No runtime database module is imported until the target has passed the guard. */
export async function runMigrationCommand(db: PrismaClient, args: MigrationArgs, deps: Deps): Promise<Result> {
    assertMigrationTarget(`postgresql://${deps.databaseHost}`, process.env, args);
    let recoveryBatchId: string | null = null;
    const fail = (message: string, batchId: string | null = null): Result => { deps.log(message); return { exitCode: 1, batchId, reportPaths: [] }; };
    const { planLegacyMigration, recordDryRun, createApplyBatch, applyLegacyBatch, rollbackLegacyBatch } = await import("./legacyMigration");
    const { deserializeSnapshotRow, serializeSnapshotRow } = await import("./legacyMapping");
    const { loadReconciliationInput, buildReconciliationReport, reconciliationToCsv, reconciliationToJson } = await import("./reconciliation");
    const { getCrmSettings, saveCrmSetting } = await import("./settings");
    const { parsePipelineMode } = await import("./pipelineMode");
    const writeReport = async (report: ReconciliationReport, id: string) => {
        const suffix = report.phase.toLowerCase().replaceAll("_", "-"), base = path.join(args.outDir, `${id}-${suffix}`), files = [`${base}.json`, `${base}.csv`];
        await deps.writeFile(files[0], reconciliationToJson(report));
        await deps.writeFile(files[1], reconciliationToCsv(report));
        return files;
    };
    try {
        // Serialize CLI commands across processes. The holding transaction does not wrap
        // crm30's independently committed per-record transactions or nested settings writes.
        return await db.$transaction(async (lock) => {
            const [locked] = await lock.$queryRaw<{
                locked: boolean;
            }[]> `SELECT pg_try_advisory_xact_lock(hashtext('crm-legacy-migration-cli')) AS locked`;
            if (!locked.locked)
                return fail("Một lệnh chuyển dữ liệu khác đang chạy.");
            const actor = args.actorEmail ? await db.user.findFirst({ where: { email: args.actorEmail, role: "ADMIN", isActive: true, deletedAt: null }, select: { id: true, name: true } }) : null;
            if (args.actorEmail && !actor || args.mode !== "DRY_RUN" && !actor)
                return fail("Cần --actor-email của Admin đang hoạt động.");
            const operator = { actorName: actor?.name ?? "CLI dry-run", databaseHost: deps.databaseHost };
            const saveMode = async (value: PipelineModeSetting) => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    const settings = await getCrmSettings(db), saved = await saveCrmSetting(db, { key: "pipeline.mode", value, expectedVersion: settings.versions["pipeline.mode"], actor: actor! });
                    if ("ok" in saved)
                        return;
                }
                throw new MigrationUsageError("Không lưu được pipeline.mode; kiểm tra cấu hình và thử lại.");
            };
            const store = async (batchId: string, values: unknown) => {
                const batch = await db.crmMigrationBatch.findUniqueOrThrow({ where: { id: batchId } });
                await db.crmMigrationBatch.update({ where: { id: batchId }, data: { summary: serializeSnapshotRow({ ...jsonObject(batch.summary), ...(values as object) }) as Prisma.InputJsonObject } });
            };
            if (args.mode === "DRY_RUN") {
                const plan = await planLegacyMigration(db, { projectIds: args.projectIds ?? undefined }), input = await loadReconciliationInput(db);
                const baseline: ReconciliationSnapshot = { input, plan, year: args.year }, batchId = await recordDryRun(db, plan, operator);
                recoveryBatchId = batchId;
                await store(batchId, { baseline, recordedAt: deps.now() });
                const report = await buildReconciliationReport(db, { phase: "DRY_RUN", batchId, year: args.year, baseline }), reportPaths = await writeReport(report, batchId);
                deps.log(`Chạy thử: ${batchId}`);
                deps.log(`--apply --batch ${batchId} --actor-email <email> [--approve-review-ids <file>]`);
                return { exitCode: 0, batchId, reportPaths };
            }
            const batch = await db.crmMigrationBatch.findUnique({ where: { id: args.batchId! } });
            if (!batch || batch.databaseHost !== deps.databaseHost)
                return fail("Batch không tồn tại hoặc thuộc database khác.");
            if (args.mode === "APPLY") {
                if (batch.mode !== "DRY_RUN" || batch.status !== "DRY_RUN_DONE")
                    return fail("--apply --batch cần id chạy thử DRY_RUN_DONE.");
                const records = await db.crmMigrationRecord.findMany({ where: { batchId: batch.id }, select: { legacyProjectId: true, classification: true } }), plan = await planLegacyMigration(db, { projectIds: records.map((r) => r.legacyProjectId) });
                const raw = args.approveReviewIds, approvals = raw ? parseReviewIdList(await deps.readTextFile(raw) ?? raw) : [], selection = resolveApplySelection(records, plan, approvals);
                if (!selection.ok)
                    return fail(`Cần chạy thử mới / id duyệt không hợp lệ: ${JSON.stringify({ changed: selection.changed, invalidApprovals: selection.invalidApprovals })}`);
                const baseline: ReconciliationSnapshot = { input: await loadReconciliationInput(db), plan, year: args.year }, previousPipelineMode = baseline.input.pipelineMode;
                const firstActive = await db.crmMigrationBatch.findFirst({ where: { mode: "APPLY", status: { in: ["APPLIED", "PARTIAL"] } }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], select: { summary: true } });
                const initialPipelineMode = parsePipelineMode(firstActive && jsonObject(firstActive.summary).initialPipelineMode) ?? parsePipelineMode(firstActive && jsonObject(firstActive.summary).previousPipelineMode) ?? previousPipelineMode;
                const { batchId } = await createApplyBatch(db, plan, { ...operator, projectIds: [...selection.projectIds, ...selection.approvedReviewIds], approvedReviewIds: selection.approvedReviewIds, sourceDryRunBatchId: batch.id });
                recoveryBatchId = batchId;
                deps.log(`Batch apply/khôi phục: ${batchId}`);
                // Persist recovery metadata BEFORE moving the first record, including on a thrown apply.
                await store(batchId, { baseline, previousPipelineMode, initialPipelineMode });
                let applied: Awaited<ReturnType<typeof applyLegacyBatch>>, report: ReconciliationReport;
                try {
                    applied = await applyLegacyBatch(db, batchId);
                    report = await buildReconciliationReport(db, { phase: "POST_APPLY", batchId, year: args.year, baseline });
                }
                catch {
                    deps.log(`Apply lỗi, batch khôi phục: ${batchId}`);
                    const recovered = await rollbackLegacyBatch(db, batchId, operator);
                    if ("blocked" in recovered)
                        deps.log(`Khôi phục bị chặn: ${JSON.stringify(recovered.blocked)}`);
                    return fail("Apply không hoàn tất; kiểm tra batch khôi phục.", batchId);
                }
                if (!report.revenueInvariant.equal || !report.kpiRevenueInvariant.equal) {
                    const rollback = await rollbackLegacyBatch(db, batchId, operator);
                    deps.log(`Doanh thu/KPI lệch; tự khôi phục: ${"ok" in rollback ? "đã khôi phục" : JSON.stringify(rollback.blocked)}`);
                    return { exitCode: 1, batchId, reportPaths: await writeReport(report, batchId) };
                }
                // CRM is in limited mode (crm54): keep the official report source unless the operator opts in explicitly.
                if (!args.switchSource)
                    deps.log("Giữ nguồn báo cáo chính thức hiện tại (chế độ giới hạn). Thêm --switch-source khi mở CRM cho toàn công ty.");
                else try {
                    await saveMode({ ...previousPipelineMode, mode: "OPPORTUNITY_OFFICIAL" });
                }
                catch (error) {
                    const rollback = await rollbackLegacyBatch(db, batchId, operator);
                    deps.log(`Không đổi được nguồn; khôi phục: ${"ok" in rollback ? "đã khôi phục" : JSON.stringify(rollback.blocked)}`);
                    throw error;
                }
                report = await buildReconciliationReport(db, { phase: "POST_APPLY", batchId, year: args.year, baseline });
                const reportPaths = await writeReport(report, batchId);
                deps.log(`Đã apply: ${batchId}`);
                deps.log(`--rollback --batch ${batchId} --actor-email <email>`);
                if (applied.skipped.length)
                    deps.log(`Bỏ qua: ${JSON.stringify(applied.skipped)}`);
                return { exitCode: applied.status === "APPLIED" ? 0 : 1, batchId, reportPaths };
            }
            if (batch.mode !== "APPLY")
                return fail("--rollback --batch cần id batch APPLY.");
            recoveryBatchId = batch.id;
            const summary = deserializeSnapshotRow<{
                baseline?: ReconciliationSnapshot;
                previousPipelineMode?: PipelineModeSetting;
                initialPipelineMode?: PipelineModeSetting;
            }>(batch.summary), previous = parsePipelineMode(summary.initialPipelineMode) ?? parsePipelineMode(summary.previousPipelineMode);
            if (!summary.baseline || !previous)
                return fail("Batch thiếu baseline/previousPipelineMode; cần rà khôi phục thủ công.", batch.id);
            const restored = await rollbackLegacyBatch(db, batch.id, operator);
            if ("blocked" in restored)
                return fail(`Khôi phục bị chặn: ${JSON.stringify(restored.blocked)}`, batch.id);
            const others = await db.crmMigrationBatch.count({ where: { id: { not: batch.id }, mode: "APPLY", status: { in: ["APPLIED", "PARTIAL"] } } });
            if (!others)
                await saveMode(previous);
            const report = await buildReconciliationReport(db, { phase: "POST_ROLLBACK", batchId: batch.id, year: summary.baseline.year, baseline: summary.baseline });
            return { exitCode: report.revenueInvariant.equal && report.kpiRevenueInvariant.equal ? 0 : 1, batchId: restored.rollbackBatchId, reportPaths: await writeReport(report, batch.id) };
        }, { timeout: 300000, maxWait: 5000 });
    }
    catch (error) {
        if (recoveryBatchId)
            deps.log(`Batch cần kiểm tra/khôi phục: ${recoveryBatchId}`);
        return fail(error instanceof MigrationUsageError ? error.message : "Lệnh không hoàn tất; kiểm tra batch và quyền truy cập, không tiếp tục chuyển nguồn.", recoveryBatchId);
    }
}
