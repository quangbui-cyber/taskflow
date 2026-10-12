import Link from "next/link";
import { FileDown, FileText, Printer } from "lucide-react";
import { Badge, Panel } from "@/components/ui/Presentation";

const FAMILIES = [
  ["QUOTATION", "quotation", "Báo giá"],
  ["CUSTOMER_ACCEPTANCE", "customer-acceptance", "Nghiệm thu khách"],
  ["DNTU", "dntu", "Đề nghị tạm ứng"],
  ["DNTT", "dntt", "Đề nghị thanh toán"],
  ["DNHTU", "dnhtu", "Đề nghị hoàn tạm ứng"],
  ["PROJECT_SETTLEMENT", "project-settlement", "Bảng quyết toán dự án"],
] as const;

type ExportSource = {
  id: string;
  family: string;
  sourceKind: string;
  sourceId: string;
  sourceVersion: number;
  projectionHash: string;
  signingState: string | null;
};

function exactQuery(source: ExportSource) {
  return new URLSearchParams({
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: String(source.sourceVersion),
  }).toString();
}

export default function SettlementExportActions({ projectId, sources, state }: {
  projectId: string;
  sources: ExportSource[];
  state: string;
}) {
  const available = state === "APPROVED";
  return <Panel className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold">Trung tâm xuất bản bất biến</h3><p className="text-xs text-[var(--text-secondary)]">Mỗi nút dùng đúng source kind, ID, version, attempt, signing snapshot và canonical hash đã seal; không tự chọn bản mới nhất.</p></div>
      <Badge tone={available ? "success" : "warning"}>{available ? "Được phép xuất" : "Chờ CEO duyệt"}</Badge>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{FAMILIES.map(([family, path, label]) => {
      const familySources = sources.filter(source => source.family === family);
      return <div key={path} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <strong className="text-sm">{label}</strong>
        {!available ? <p className="mt-3 text-xs text-[var(--text-secondary)]">Bản nháp/đang duyệt không được xuất như bản bất biến.</p>
          : familySources.length === 0 ? <p className="mt-3 text-xs text-[var(--text-secondary)]">Chưa có exact source seal; export bị khóa.</p>
            : <div className="mt-3 space-y-3">{familySources.map(source => {
              const query = exactQuery(source);
              const previewQuery = new URLSearchParams({ sourceKind: source.sourceKind, sourceVersion: String(source.sourceVersion) }).toString();
              return <div key={source.id} className="space-y-2 border-t border-[var(--border)] pt-2 first:border-0 first:pt-0">
                <p className="break-all font-mono text-[10px] text-[var(--text-secondary)]">v{source.sourceVersion} · {source.projectionHash.slice(0, 12)}… · {source.signingState ?? "UNSIGNED"}</p>
                <div className="grid grid-cols-3 gap-2">
                  <Link className="tf-button-secondary tf-button-size-sm min-h-11 justify-center" href={`/api/projects/${projectId}/costflow/export/${path}?${query}`}><FileDown size={15} aria-hidden="true" />Excel</Link>
                  <Link className="tf-button-secondary tf-button-size-sm min-h-11 justify-center" href={`/api/projects/${projectId}/costflow/export/${path}/pdf?${query}`}><FileText size={15} aria-hidden="true" />PDF</Link>
                  <Link className="tf-button-secondary tf-button-size-sm min-h-11 justify-center" href={`/projects/${projectId}/costflow/${path}/${encodeURIComponent(source.sourceId)}/print?${previewQuery}`} target="_blank" rel="noreferrer"><Printer size={15} aria-hidden="true" />Xem</Link>
                </div>
              </div>;
            })}</div>}
      </div>;
    })}</div>
  </Panel>;
}
