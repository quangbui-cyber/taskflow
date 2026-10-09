import type { FinanceData, IcRevision } from "./types";

export function workingIcRevision(data: FinanceData, requests: { id: string; state: string }[]): IcRevision | undefined {
  const candidates = data.revisions.filter(r => !r.supersededByRevisionId && requests.some(q => q.id === r.requestId && ["DRAFT", "SUBMITTED", "RETURNED"].includes(q.state)));
  if (candidates.length > 1) throw new Error("Có nhiều revision đang xử lý. Cần đối soát lịch sử trước khi tạo/sửa IC.");
  return candidates[0];
}

export function diffIcRevisions(revision: IcRevision, baseline?: IcRevision) {
  if (!baseline) return { baselineId: null, added: revision.lines.map(l => l.id), removed: [] as string[], changed: [] as { id: string; fields: string[] }[], sourceChanged: false, material: false };
  const fields = ["description", "unit", "quantity", "days", "unitPrice", "basis", "vatPercent", "quotationId", "quotationLineId", "vendorId", "originLines"] as const;
  const added = revision.lines.filter(l => !baseline.lines.some(old => old.id === l.id)).map(l => l.id);
  const removed = baseline.lines.filter(l => !revision.lines.some(next => next.id === l.id)).map(l => l.id);
  const changed = revision.lines.flatMap(line => {
    const old = baseline.lines.find(l => l.id === line.id);
    if (!old) return [];
    const changes = fields.filter(key => JSON.stringify((line as unknown as Record<string, unknown>)[key] ?? null) !== JSON.stringify((old as unknown as Record<string, unknown>)[key] ?? null));
    return changes.length ? [{ id: line.id, fields: [...changes] }] : [];
  });
  const sourceChanged = JSON.stringify([...revision.poIds].sort()) !== JSON.stringify([...baseline.poIds].sort()) || JSON.stringify([...(revision.briefIds ?? [])].sort()) !== JSON.stringify([...(baseline.briefIds ?? [])].sort()) || JSON.stringify([...(revision.evidenceIds ?? [])].sort()) !== JSON.stringify([...(baseline.evidenceIds ?? [])].sort());
  return { baselineId: baseline.id, added, removed, changed, sourceChanged, material: !!(added.length || removed.length || changed.length || sourceChanged) };
}

const FIELD_LABELS: Record<string, string> = {
  description: "Nội dung",
  unit: "Đơn vị",
  quantity: "Số lượng",
  days: "Số ngày",
  unitPrice: "Đơn giá",
  basis: "Cơ sở giá",
  vatPercent: "VAT",
  quotationId: "Báo giá nguồn",
  quotationLineId: "Dòng báo giá nguồn",
  vendorId: "Nhà cung cấp",
  originLines: "Liên kết dòng IC",
};

function displayValue(field: string, value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (field === "vatPercent") return `${String(value)}%`;
  if (field === "basis") return value === "GROSS" ? "Đã gồm VAT" : "Chưa VAT";
  if (Array.isArray(value)) return value.map(item => {
    if (item && typeof item === "object" && "revisionId" in item && "lineId" in item) {
      const link = item as { revisionId: string; lineId: string };
      return `${link.revisionId} / ${link.lineId}`;
    }
    return String(item);
  }).join(", ") || "—";
  return String(value);
}

export type IcDiffRow = {
  group: "added" | "removed" | "changed";
  lineId: string;
  lineLabel: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
};

export function readableIcRevisionDiff(revision: IcRevision, baseline?: IcRevision) {
  const raw = diffIcRevisions(revision, baseline);
  if (!baseline) return { ...raw, rows: [] as IcDiffRow[] };
  const rows: IcDiffRow[] = [];
  for (const id of raw.added) {
    const line = revision.lines.find(item => item.id === id)!;
    rows.push({ group: "added", lineId: id, lineLabel: line.description, fieldLabel: "Dòng mới", oldValue: "—", newValue: `${line.quantity} ${line.unit} · ${line.unitPrice} · VAT ${line.vatPercent}%` });
  }
  for (const id of raw.removed) {
    const line = baseline.lines.find(item => item.id === id)!;
    rows.push({ group: "removed", lineId: id, lineLabel: line.description, fieldLabel: "Dòng đã bỏ", oldValue: `${line.quantity} ${line.unit} · ${line.unitPrice} · VAT ${line.vatPercent}%`, newValue: "—" });
  }
  for (const change of raw.changed) {
    const before = baseline.lines.find(item => item.id === change.id)!;
    const after = revision.lines.find(item => item.id === change.id)!;
    for (const field of change.fields) {
      rows.push({
        group: "changed",
        lineId: change.id,
        lineLabel: after.description || before.description,
        fieldLabel: FIELD_LABELS[field] ?? field,
        oldValue: displayValue(field, (before as unknown as Record<string, unknown>)[field]),
        newValue: displayValue(field, (after as unknown as Record<string, unknown>)[field]),
      });
    }
  }
  if (raw.sourceChanged) rows.push({ group: "changed", lineId: "sources", lineLabel: "Nguồn chung của IC", fieldLabel: "PO / Brief / minh chứng", oldValue: [...baseline.poIds, ...(baseline.briefIds ?? []), ...(baseline.evidenceIds ?? [])].join(", ") || "—", newValue: [...revision.poIds, ...(revision.briefIds ?? []), ...(revision.evidenceIds ?? [])].join(", ") || "—" });
  return { ...raw, rows };
}
