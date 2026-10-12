import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { projectQuotation } from "./quotationProjection";
import type { FinanceData, Quotation } from "./types";

export const EXPORT_SOURCE_FAMILIES = ["QUOTATION", "CUSTOMER_ACCEPTANCE", "DNTU", "DNTT", "DNHTU", "PROJECT_SETTLEMENT"] as const;
export type ExportSourceFamily = typeof EXPORT_SOURCE_FAMILIES[number];

type Rational = { numerator: bigint; denominator: bigint };
type ExportLine = { id: string; rawNet: string; rawVat: string; rawGross: string; vatPercent?: string };
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

export type ExportSourceSealInput = {
  projectId: string;
  dossierVersionId?: string | null;
  family: ExportSourceFamily;
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  approvalAttemptId: string;
  approvedSnapshotId: string | null;
  signingState: string;
  payload: unknown;
  lines: ExportLine[];
  authoritativeTotals?: { net: string; vat: string; gross: string };
};

const PUBLIC_PAYLOAD_KEYS = new Set(["title", "customer", "project", "document", "rows"]);
const PUBLIC_ROW_KEYS = new Set(["id", "kind", "numberLabel", "name", "description", "unit", "quantity", "days", "unitPrice", "contractQuantity", "contractDays", "actualQuantity", "actualDays", "quantityDelta", "daysDelta", "saleUnitPrice", "basis", "net", "vat", "gross", "netAmount", "vatAmount", "grossAmount", "vatPercent", "notes", "amount", "summary"]);

function requiredText(value: string | null | undefined, label: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Thiếu ${label} cho projection xuất phiếu.`);
  return normalized;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < ZERO ? -left : left;
  let b = right < ZERO ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || ONE;
}

function rational(value: string, label: string): Rational {
  const normalized = requiredText(value, label);
  let numerator: bigint;
  let denominator: bigint;
  if (/^\d+\/\d+$/.test(normalized)) {
    const [top, bottom] = normalized.split("/");
    numerator = BigInt(top);
    denominator = BigInt(bottom);
  } else if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const [whole, fraction = ""] = normalized.split(".");
    denominator = TEN ** BigInt(fraction.length);
    numerator = BigInt(`${whole}${fraction}`);
  } else {
    throw new Error(`${label} phải là số không âm chính xác.`);
  }
  if (denominator <= ZERO) throw new Error(`${label} có mẫu số không hợp lệ.`);
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: Rational, right: Rational): Rational {
  const numerator = left.numerator * right.denominator + right.numerator * left.denominator;
  const denominator = left.denominator * right.denominator;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function sum(values: Rational[]) {
  return values.reduce(add, { numerator: ZERO, denominator: ONE });
}

function roundVnd(value: Rational) {
  return (value.numerator * TWO + value.denominator) / (value.denominator * TWO);
}

function integerVnd(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} phải là số nguyên VND không âm.`);
  return BigInt(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
  return value;
}

function publicPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload projection phải là object bất biến.");
  const source = payload as Record<string, unknown>;
  return Object.fromEntries(Object.entries(source).flatMap(([key, value]) => {
    if (!PUBLIC_PAYLOAD_KEYS.has(key)) return [];
    if (key !== "rows") return [[key, stable(value)]];
    if (!Array.isArray(value)) return [[key, []]];
    return [[key, value.map(row => row && typeof row === "object" && !Array.isArray(row)
      ? Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([rowKey]) => PUBLIC_ROW_KEYS.has(rowKey)).map(([rowKey, child]) => [rowKey, stable(child)]))
      : {})]];
  }));
}

function internalPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload projection phải là object bất biến.");
  return stable(payload) as Record<string, unknown>;
}

function vatAssignment(lines: ExportLine[], adjustment: bigint) {
  if (!lines.length) throw new Error("Projection xuất phiếu phải có ít nhất một dòng nguồn.");
  const ranked = lines.map(line => ({ line, vat: rational(line.rawVat, `VAT dòng ${line.id}`) })).sort((left, right) => {
    const leftRemainder = left.vat.numerator % left.vat.denominator;
    const rightRemainder = right.vat.numerator % right.vat.denominator;
    const remainderCompare = rightRemainder * left.vat.denominator - leftRemainder * right.vat.denominator;
    if (remainderCompare !== ZERO) return remainderCompare > ZERO ? 1 : -1;
    const amountCompare = right.vat.numerator * left.vat.denominator - left.vat.numerator * right.vat.denominator;
    if (amountCompare !== ZERO) return amountCompare > ZERO ? 1 : -1;
    return left.line.id.localeCompare(right.line.id);
  });
  return { lineId: requiredText(ranked[0].line.id, "VAT line ID"), adjustment: Number(adjustment) };
}

export function buildExportSourceSeal(input: ExportSourceSealInput) {
  const projectId = requiredText(input.projectId, "Project ID");
  if (!EXPORT_SOURCE_FAMILIES.includes(input.family)) throw new Error("Loại projection xuất phiếu không hợp lệ.");
  const sourceKind = requiredText(input.sourceKind, "source kind");
  const sourceId = requiredText(input.sourceId, "source ID");
  if (!Number.isInteger(input.sourceVersion) || input.sourceVersion <= 0) throw new Error("Source version phải là số nguyên dương.");
  const approvalAttemptId = requiredText(input.approvalAttemptId, "approval/finalization attempt ID");
  const signingState = requiredText(input.signingState, "signing state");
  if (signingState !== "UNSIGNED" && !input.approvedSnapshotId) throw new Error("Thiếu approved signing snapshot identity.");

  const raw = {
    net: sum(input.lines.map(line => rational(line.rawNet, `NET dòng ${line.id}`))),
    vat: sum(input.lines.map(line => rational(line.rawVat, `VAT dòng ${line.id}`))),
    gross: sum(input.lines.map(line => rational(line.rawGross, `GROSS dòng ${line.id}`))),
  };
  const totals = input.authoritativeTotals ? {
    net: integerVnd(input.authoritativeTotals.net, "Authoritative NET"),
    vat: integerVnd(input.authoritativeTotals.vat, "Authoritative VAT"),
    gross: integerVnd(input.authoritativeTotals.gross, "Authoritative GROSS"),
  } : { net: roundVnd(raw.net), vat: roundVnd(raw.vat), gross: roundVnd(raw.gross) };
  const roundingAdjustment = totals.gross - totals.net - totals.vat;
  if (roundingAdjustment < -ONE || roundingAdjustment > ONE) throw new Error("Chênh lệch làm tròn chỉ được -1, 0 hoặc +1 VND.");
  const assignment = vatAssignment(input.lines, roundingAdjustment);
  const sourcePayload = input.family === "QUOTATION" || input.family === "CUSTOMER_ACCEPTANCE"
    ? publicPayload(input.payload)
    : internalPayload(input.payload);
  const canonicalPayload = stable({
    identity: { projectId, family: input.family, sourceKind, sourceId, sourceVersion: input.sourceVersion },
    approval: { approvalAttemptId, approvedSnapshotId: input.approvedSnapshotId ?? null, signingState },
    payload: sourcePayload,
    lines: input.lines.map(line => ({
      id: line.id,
      rawNet: line.rawNet,
      rawVat: line.rawVat,
      rawGross: line.rawGross,
      net: roundVnd(rational(line.rawNet, `NET dòng ${line.id}`)).toString(),
      vat: roundVnd(rational(line.rawVat, `VAT dòng ${line.id}`)).toString(),
      gross: roundVnd(rational(line.rawGross, `GROSS dòng ${line.id}`)).toString(),
      vatPercent: line.vatPercent ?? null,
    })),
    totals: { net: totals.net.toString(), vat: totals.vat.toString(), gross: totals.gross.toString() },
    roundingAdjustment: Number(roundingAdjustment),
    vatLineAssignment: assignment,
  }) as Record<string, unknown>;
  return {
    canonicalPayload,
    totals: { net: totals.net.toString(), vat: totals.vat.toString(), gross: totals.gross.toString() },
    roundingAdjustment: Number(roundingAdjustment),
    vatLineAssignment: assignment,
    projectionHash: createHash("sha256").update(JSON.stringify(canonicalPayload), "utf8").digest("hex"),
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export async function sealExportSourceProjection(tx: Prisma.TransactionClient, input: ExportSourceSealInput) {
  const seal = buildExportSourceSeal(input);
  const exact = {
    projectId: input.projectId,
    family: input.family,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
  };
  const row = await tx.settlementExportSourceProjection.upsert({
    where: { projectId_family_sourceKind_sourceId_sourceVersion: exact },
    create: {
      project: { connect: { id: input.projectId } },
      ...(input.dossierVersionId ? { dossierVersion: { connect: { id: input.dossierVersionId } } } : {}),
      family: input.family,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      authoritativeNet: seal.totals.net,
      authoritativeVat: seal.totals.vat,
      authoritativeGross: seal.totals.gross,
      roundingAdjustment: seal.roundingAdjustment,
      vatLineAssignment: seal.vatLineAssignment,
      projectionHash: seal.projectionHash,
      approvalAttemptId: input.approvalAttemptId,
      approvedSnapshotId: input.approvedSnapshotId,
      signingState: input.signingState,
      canonicalPayload: seal.canonicalPayload as Prisma.InputJsonValue,
    },
    update: {},
  });
  const identical = row.dossierVersionId === (input.dossierVersionId ?? null)
    && row.authoritativeNet === seal.totals.net
    && row.authoritativeVat === seal.totals.vat
    && row.authoritativeGross === seal.totals.gross
    && row.roundingAdjustment === seal.roundingAdjustment
    && row.projectionHash === seal.projectionHash
    && row.approvalAttemptId === input.approvalAttemptId
    && row.approvedSnapshotId === input.approvedSnapshotId
    && row.signingState === input.signingState
    && sameJson(row.vatLineAssignment, seal.vatLineAssignment)
    && sameJson(row.canonicalPayload, seal.canonicalPayload);
  if (!identical) throw new Error(`Projection nguồn ${input.family}/${input.sourceId}/v${input.sourceVersion} xung đột với seal đã tồn tại.`);
  return row;
}

export type LegacyExportSourceTuple = Pick<ExportSourceSealInput, "projectId" | "family" | "sourceKind" | "sourceId" | "sourceVersion">;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function legacyCandidate(tx: Prisma.TransactionClient, tuple: LegacyExportSourceTuple): Promise<ExportSourceSealInput | { reason: string }> {
  if (tuple.family === "QUOTATION" && tuple.sourceKind === "QUOTATION") {
    const rows = await tx.costFlowHistory.findMany({
      where: { projectId: tuple.projectId, action: "FINALIZE_PAIRED_QUOTATION" },
      select: { id: true, snapshot: true },
      orderBy: { version: "asc" },
    });
    const matches = rows.flatMap(row => {
      const snapshot = object(row.snapshot) as FinanceData | null;
      const quotation = snapshot?.quotations?.find(item => item.id === tuple.sourceId && item.number === tuple.sourceVersion);
      return quotation ? [{ row, quotation }] : [];
    });
    if (matches.length !== 1) return { reason: matches.length ? "Nguồn báo giá lịch sử bị mơ hồ cho exact tuple." : "Không tìm thấy immutable finalized quotation source." };
    const quotation = matches[0].quotation as Quotation;
    const payload = projectQuotation(quotation);
    return {
      ...tuple,
      approvalAttemptId: matches[0].row.id,
      approvedSnapshotId: null,
      signingState: "UNSIGNED",
      payload,
      lines: quotation.lines.map(line => ({ id: line.id, rawNet: line.cost.rawNet, rawVat: line.cost.rawVat, rawGross: line.cost.rawGross, vatPercent: line.vatPercent })),
      authoritativeTotals: { net: payload.amount.net, vat: payload.amount.vat, gross: payload.amount.gross },
    };
  }

  if (tuple.family === "CUSTOMER_ACCEPTANCE" && tuple.sourceKind === "CUSTOMER_ACCEPTANCE") {
    const snapshot = await tx.customerAcceptanceSnapshot.findFirst({ where: { id: tuple.sourceId, projectId: tuple.projectId, version: tuple.sourceVersion } });
    const payload = object(snapshot?.projection);
    const rows = Array.isArray(payload?.rows) ? payload.rows.map(object).filter((row): row is Record<string, unknown> => !!row) : [];
    const totals = object(payload?.totals);
    if (!snapshot || !payload || !rows.length || !totals) return { reason: "Nguồn nghiệm thu lịch sử thiếu exact snapshot, dòng hoặc authoritative totals." };
    return {
      ...tuple,
      approvalAttemptId: `CUSTOMER_ACCEPTANCE:${snapshot.id}`,
      approvedSnapshotId: null,
      signingState: "UNSIGNED",
      payload,
      lines: rows.map(row => ({
        id: String(row.id ?? ""),
        rawNet: String(row.netAmount ?? ""),
        rawVat: String(row.vatAmount ?? ""),
        rawGross: String(row.grossAmount ?? ""),
        vatPercent: String(row.vatPercent ?? ""),
      })),
      authoritativeTotals: { net: String(totals.net ?? ""), vat: String(totals.vat ?? ""), gross: String(totals.gross ?? "") },
    };
  }

  const paymentKind = tuple.family === "DNTU" ? "ADVANCE" : tuple.family === "DNTT" ? "VENDOR_PAYMENT" : tuple.family === "DNHTU" ? "REIMBURSEMENT" : null;
  if (paymentKind && tuple.sourceKind === paymentKind) {
    const request = await tx.workflowRequest.findFirst({
      where: { id: tuple.sourceId, projectId: tuple.projectId, kind: paymentKind, state: "APPROVED", version: tuple.sourceVersion },
      include: { paymentLines: { orderBy: { position: "asc" } }, paymentRecipients: { orderBy: { recipientKey: "asc" } }, approvedSnapshots: true },
    });
    if (!request) return { reason: "Không tìm thấy exact approved payment source version." };
    if (!request.currentAttemptId) return { reason: "Approved payment source thiếu approval attempt identity." };
    const snapshots = request.approvedSnapshots.filter(snapshot => snapshot.evidenceState === "DIGITAL_CONFIRMED");
    if (snapshots.length !== 1) return { reason: snapshots.length ? "Approved payment source có signing snapshot mơ hồ giữa nhiều attempt." : "Approved payment source thiếu signing snapshot identity." };
    if (!request.paymentLines.length) return { reason: "Approved payment source thiếu immutable payment lines." };
    const snapshot = snapshots[0];
    return {
      ...tuple,
      approvalAttemptId: request.currentAttemptId,
      approvedSnapshotId: snapshot.id,
      signingState: snapshot.evidenceState,
      payload: {
        request: { id: request.id, kind: request.kind, title: request.title, approvedVersion: request.version },
        paymentLines: request.paymentLines,
        paymentRecipients: request.paymentRecipients,
        approvedProjectionHash: snapshot.projectionSha256,
      },
      lines: request.paymentLines.map(line => ({ id: line.stableKey, rawNet: line.amount, rawVat: "0", rawGross: line.amount, vatPercent: "0" })),
    };
  }

  return { reason: "Source family chưa có đủ immutable identity để seal legacy an toàn." };
}

export async function sealLegacyExportSourceProjection(tx: Prisma.TransactionClient, tuple: LegacyExportSourceTuple) {
  const existing = await tx.settlementExportSourceProjection.findUnique({
    where: { projectId_family_sourceKind_sourceId_sourceVersion: tuple },
  });
  if (existing) return { status: "ALREADY_IDENTICAL" as const, projection: existing };

  const candidate = await legacyCandidate(tx, tuple);
  if (!("reason" in candidate)) {
    try {
      const projection = await sealExportSourceProjection(tx, candidate);
      return { status: "SEALED" as const, projection };
    } catch (error) {
      return { status: "BLOCKED" as const, reason: error instanceof Error ? error.message : "Không thể xác minh legacy source identity." };
    }
  }

  const history = await tx.costFlowHistory.findMany({
    where: { projectId: tuple.projectId, version: tuple.sourceVersion },
    select: { id: true, action: true, snapshot: true },
  });
  if (history.length !== 1) return { status: "BLOCKED" as const, reason: history.length ? "Nguồn lịch sử không duy nhất cho exact source version." : "Không tìm thấy immutable source history cho exact tuple." };
  const snapshot = history[0].snapshot;
  const record = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
    ? (snapshot as Record<string, unknown>).exportSourceSeal
    : null;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { status: "BLOCKED" as const, reason: "Nguồn lịch sử thiếu exportSourceSeal identity gồm attempt, signing snapshot, lines và evidence." };
  }
  const historyCandidate = record as Partial<ExportSourceSealInput>;
  if (historyCandidate.projectId !== tuple.projectId || historyCandidate.family !== tuple.family || historyCandidate.sourceKind !== tuple.sourceKind || historyCandidate.sourceId !== tuple.sourceId || historyCandidate.sourceVersion !== tuple.sourceVersion) {
    return { status: "BLOCKED" as const, reason: "Immutable source history không khớp exact source tuple." };
  }
  try {
    const projection = await sealExportSourceProjection(tx, historyCandidate as ExportSourceSealInput);
    return { status: "SEALED" as const, projection };
  } catch (error) {
    return { status: "BLOCKED" as const, reason: error instanceof Error ? error.message : candidate.reason };
  }
}
