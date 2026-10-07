import Link from "next/link";
import type { Quotation } from "@/lib/costflow/types";
import { newerQuotation, quotationVersionDate, requestStateLabel, type CostFlowWorkspaceMode } from "@/lib/costflow/workspaceFlow";

export default function QuotationIcLineage({
  projectId,
  mode,
  source,
  quotations,
  revisionNumber,
  requestState,
  draftSaved,
  saveIc,
  locked = false,
}: {
  projectId: string;
  mode: CostFlowWorkspaceMode;
  source?: Quotation;
  quotations?: Quotation[];
  revisionNumber?: number;
  requestState?: string;
  draftSaved: boolean;
  saveIc: boolean;
  locked?: boolean;
}) {
  const newer = newerQuotation(source, quotations);
  const sourceDate = quotationVersionDate(source);
  const quotationLabel = source
    ? `BG-${source.number} · ${source.title}`
    : draftSaved
      ? "Nháp Báo giá đã lưu"
      : "Nháp Báo giá mới";
  const icLabel = mode === "quote"
    ? "Chưa mở IC trong workspace"
    : revisionNumber
      ? `IC-R${revisionNumber} · ${requestStateLabel(requestState)}`
      : mode === "paired" && saveIc
        ? "IC sẽ được tạo khi lưu"
        : mode === "paired"
          ? "Chưa lưu kèm IC"
          : "Nháp IC mới";

  return <section className="tf-quotation-lineage" aria-label="Liên kết Báo giá và Internal Cost">
    <div>
      <span>Báo giá</span>
      <strong>{quotationLabel}</strong>
      <small>{source ? `Phiên bản nguồn bất biến${sourceDate ? ` · ${sourceDate}` : ""}` : "Chưa tạo phiên bản phát hành"}</small>
    </div>
    <span className="tf-quotation-lineage-arrow" aria-hidden="true">→</span>
    <div>
      <span>Internal Cost</span>
      <strong>{icLabel}{locked ? " · Chỉ đọc" : ""}</strong>
      <small>{locked ? "Phần giá vốn đã khóa; lập revision hoặc rút hồ sơ để chỉnh" : source ? `Nguồn BG-${source.number}` : mode === "quote" ? "Có thể lập sau khi chốt Báo giá" : "Cùng cấu trúc hạng mục đang làm"}</small>
    </div>
    {newer && <div className="tf-quotation-lineage-update">
      <span>Có nguồn mới hơn</span>
      <strong>BG-{newer.number} · {newer.title}</strong>
      <Link href={`/projects/${projectId}/costflow?tab=ic`}>Mở Internal Cost để đối chiếu</Link>
    </div>}
  </section>;
}
