import { compare, decimal } from "./money";
import type {
  NormalizedPaymentLine,
  PaymentDossierProjection,
  PaymentDraftInput,
  PaymentWarning,
} from "./paymentTypes";

function requiredText(value: string, label: string, maxLength: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Thiếu ${label}.`);
  if (normalized.length > maxLength) throw new Error(`${label} quá dài.`);
  return normalized;
}

export function exactPositiveVnd(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error("Số tiền VND phải là số nguyên dương.");
  const amount = BigInt(normalized);
  if (amount <= BigInt(0)) throw new Error("Số tiền phải lớn hơn 0.");
  return amount.toString();
}

function addMoney(target: Map<string, bigint>, key: string, value: string) {
  target.set(key, (target.get(key) ?? BigInt(0)) + BigInt(value));
}

export function normalizePaymentDraft(input: PaymentDraftInput): PaymentDossierProjection {
  const projectId = requiredText(input.projectId, "Project", 200);
  if (!["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT"].includes(input.kind)) {
    throw new Error("Loại hồ sơ thanh toán không hợp lệ.");
  }
  const isEffective = input.budgetEffectStatus === "EFFECTIVE"
    || (input.budgetEffectStatus === undefined && input.legacyEffective === true);
  if (!isEffective) throw new Error("Phải chọn IC đang có hiệu lực.");
  const milestone = requiredText(input.milestone, "mốc hồ sơ", 500);
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 200) {
    throw new Error("Hồ sơ cần từ 1 đến 200 khoản.");
  }

  const stableKeys = new Set<string>();
  const recipientTotals = new Map<string, bigint>();
  const sourceTotals = new Map<string, bigint>();
  const sourceBudgets = new Map<string, string>();
  const lines: NormalizedPaymentLine[] = input.lines.map((line, position) => {
    const stableKey = requiredText(line.stableKey, "mã khoản", 200);
    if (stableKeys.has(stableKey)) throw new Error("Mã khoản bị trùng (duplicate stable key).");
    stableKeys.add(stableKey);
    if (line.source.projectId !== projectId || line.recipient.projectId !== projectId) {
      throw new Error("Dòng nguồn và người nhận phải thuộc cùng Project.");
    }
    const revisionId = requiredText(line.source.revisionId, "IC revision", 200);
    const lineId = requiredText(line.source.lineId, "dòng IC", 200);
    const recipientKey = requiredText(line.recipient.key, "người nhận", 200);
    const amount = exactPositiveVnd(line.amount);
    const budgetGross = exactPositiveVnd(line.source.budgetGross);
    const sourceKey = `${revisionId}:${lineId}`;
    const existingBudget = sourceBudgets.get(sourceKey);
    if (existingBudget && existingBudget !== budgetGross) throw new Error("Ngân sách tham chiếu của dòng IC không nhất quán.");
    sourceBudgets.set(sourceKey, budgetGross);
    addMoney(sourceTotals, sourceKey, amount);
    addMoney(recipientTotals, recipientKey, amount);
    return {
      stableKey,
      position,
      description: requiredText(line.description, "nội dung khoản", 1000),
      amount,
      source: { projectId, revisionId, lineId, budgetGross },
      recipient: {
        projectId,
        key: recipientKey,
        type: line.recipient.type,
        name: requiredText(line.recipient.name, "tên người nhận", 500),
        bankName: line.recipient.bankName?.trim() || undefined,
        accountLast4: line.recipient.accountLast4?.trim() || undefined,
        sourceVersion: line.recipient.sourceVersion,
      },
      evidenceIds: [...new Set(line.evidenceIds ?? [])],
    };
  });

  const warnings: PaymentWarning[] = [];
  for (const [sourceKey, requested] of sourceTotals) {
    const referenced = sourceBudgets.get(sourceKey)!;
    if (compare(decimal(requested.toString()), decimal(referenced)) > 0) {
      warnings.push({
        code: "OVER_REFERENCE",
        sourceKey,
        referencedAmount: referenced,
        requestedAmount: requested.toString(),
        message: "Số đề nghị vượt tham chiếu dòng IC; cần giải trình nhưng không buộc sửa IC.",
      });
    }
  }
  const explanation = input.explanation?.trim() ?? "";
  if (warnings.length > 0 && !explanation) throw new Error("Khoản vượt tham chiếu IC cần giải trình.");

  return {
    projectId,
    kind: input.kind,
    milestone,
    explanation,
    lines,
    totalAmount: lines.reduce((total, line) => total + BigInt(line.amount), BigInt(0)).toString(),
    recipientTotals: Object.fromEntries([...recipientTotals].map(([key, amount]) => [key, amount.toString()])),
    warnings,
    canSubmit: true,
  };
}

