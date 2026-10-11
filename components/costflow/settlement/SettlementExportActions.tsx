import Link from "next/link";
import { FileDown, Printer } from "lucide-react";
import { Badge, Panel } from "@/components/ui/Presentation";

const FAMILIES = [
  ["quotation", "Báo giá"],
  ["customer-acceptance", "Nghiệm thu khách"],
  ["dntu", "Đề nghị tạm ứng"],
  ["dntt", "Đề nghị thanh toán"],
  ["dnhtu", "Đề nghị hoàn tạm ứng"],
  ["project-settlement", "Bảng quyết toán dự án"],
] as const;

export default function SettlementExportActions({ projectId, versionId, version, state }: {
  projectId: string;
  versionId: string;
  version: number;
  state: string;
}) {
  const available = state === "APPROVED";
  return <Panel className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-bold">Trung tâm xuất bản bất biến</h3><p className="text-xs text-[var(--text-secondary)]">6 tệp Excel và 6 bản PDF/In A4 cùng truy về dossier v{version}; tải file không thay trạng thái ký.</p></div>
      <Badge tone={available ? "success" : "warning"}>{available ? "Được phép xuất" : "Chờ CEO duyệt"}</Badge>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{FAMILIES.map(([path, label]) => <div key={path} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <strong className="text-sm">{label}</strong>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {available ? <>
          <Link className="tf-button-secondary tf-button-size-sm min-h-11 justify-center" href={`/api/projects/${projectId}/costflow/export/${path}?versionId=${encodeURIComponent(versionId)}`}><FileDown size={15} aria-hidden="true" />Excel</Link>
          <Link className="tf-button-secondary tf-button-size-sm min-h-11 justify-center" href={`/projects/${projectId}/costflow/${path}/${versionId}/print`} target="_blank" rel="noreferrer"><Printer size={15} aria-hidden="true" />PDF / In</Link>
        </> : <p className="col-span-2 text-xs text-[var(--text-secondary)]">Bản nháp/đang duyệt không được xuất như bản bất biến.</p>}
      </div>
    </div>)}</div>
  </Panel>;
}
