"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Eye, FileCheck2, Paperclip, Search, Store, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";

import { costFlowAction } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import IcEvidencePanel from "@/components/IcEvidencePanel";
import { Button } from "@/components/ui/Button";
import { Alert, Badge, Table } from "@/components/ui/Presentation";
import { buildIcApprovalReview, type IcApprovalReviewRow } from "@/lib/costflow/icApprovalReview";
import { displayMoney } from "@/lib/costflow/money";
import type { IcLine } from "@/lib/costflow/types";

type ReviewFilter = "ALL" | "ATTENTION" | "EVIDENCE" | "VENDOR";

const FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: "ALL", label: "Tất cả" },
  { id: "ATTENTION", label: "Cần chú ý" },
  { id: "EVIDENCE", label: "Thiếu minh chứng" },
  { id: "VENDOR", label: "Thiếu NCC" },
];

function rowNeedsAttention(row: IcApprovalReviewRow) {
  return row.issues.some(issue => issue !== "UNLINKED_QUOTATION");
}

function ReviewBadges({ row }: { row: IcApprovalReviewRow }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {row.issues.includes("IC_ABOVE_QUOTATION") && <Badge tone="warning">IC &gt; phần bán</Badge>}
      {row.issues.includes("MISSING_EVIDENCE") && <Badge tone="danger">Thiếu minh chứng</Badge>}
      {row.issues.includes("EVIDENCE_REASON_ONLY") && <Badge tone="warning">Chỉ có lý do</Badge>}
      {row.issues.includes("MISSING_VENDOR") && <Badge tone="warning">Thiếu NCC</Badge>}
      {row.issues.includes("UNKNOWN_VENDOR") && <Badge tone="danger">NCC không còn trong danh bạ</Badge>}
      {!rowNeedsAttention(row) && <Badge tone="success">Không có cảnh báo</Badge>}
    </div>
  );
}

export default function IcApprovalReviewDashboard({
  finance,
  request,
  canSupplement,
}: {
  finance: Finance;
  request: Finance["requests"][number];
  canSupplement: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  const [query, setQuery] = useState("");
  const [line, setLine] = useState<IcLine | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState(finance.evidence);
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [viewOnly, setViewOnly] = useState(true);

  const revision = finance.data.revisions.find(item => item.requestId === request.id);
  const quotationId = revision?.quotationId ?? request.payload.lines?.find(item => item.quotationId)?.quotationId;
  const quotation = finance.data.quotations?.find(item => item.id === quotationId);
  const events = useMemo(
    () => finance.supplements?.filter(supplement => supplement.requestId === request.id) ?? [],
    [finance.supplements, request.id],
  );
  const review = useMemo(() => buildIcApprovalReview({
    lines: request.payload.lines ?? [],
    quotation,
    beneficiaries: finance.data.beneficiaries,
    supplements: events,
    evidence: files,
  }), [events, files, finance.data.beneficiaries, quotation, request.payload.lines]);

  const visibleRows = useMemo(() => review.rows.filter(row => {
    if (filter === "ATTENTION" && !rowNeedsAttention(row)) return false;
    if (filter === "EVIDENCE" && row.evidenceState !== "MISSING") return false;
    if (filter === "VENDOR" && row.vendorId && row.vendorName) return false;
    const normalized = query.trim().toLocaleLowerCase("vi-VN");
    if (!normalized) return true;
    return `${row.description} ${row.vendorName ?? ""} ${row.evidenceNames.join(" ")}`
      .toLocaleLowerCase("vi-VN")
      .includes(normalized);
  }), [filter, query, review.rows]);

  const openEvidence = (row: IcApprovalReviewRow, supplement: boolean) => {
    const sourceLine = request.payload.lines?.find(item => item.id === row.id);
    if (!sourceLine) return;
    setViewOnly(!supplement);
    setLine(sourceLine);
    setIds(supplement ? [] : row.evidenceIds);
    setReason(supplement ? "" : row.evidenceReason);
    setOperation(supplement ? crypto.randomUUID() : "");
    setMessage("");
  };

  const attentionCount = review.rows.filter(rowNeedsAttention).length;
  const missingFileGross = review.rows
    .filter(row => row.evidenceState === "MISSING")
    .reduce((total, row) => total + BigInt(row.icCost?.gross ?? "0"), BigInt(0))
    .toString();

  return (
    <section className="tf-ic-review-dashboard" aria-labelledby={`ic-review-${request.id}`}>
      <div className="tf-ic-review-heading">
        <div>
          <h3 id={`ic-review-${request.id}`}>Tổng quan thẩm định IC</h3>
          <p>
            Snapshot IC-R{revision?.number ?? "—"}
            {review.quotation ? ` · đối chiếu BG-${review.quotation.number}` : " · IC độc lập hoặc chưa liên kết báo giá"}
          </p>
        </div>
        <Badge tone={attentionCount ? "warning" : "success"}>
          {attentionCount ? `${attentionCount} dòng cần chú ý` : "Không có cảnh báo theo dữ liệu hiện có"}
        </Badge>
      </div>

      <div className="tf-ic-review-summary" aria-label="Tóm tắt tài chính và mức độ đầy đủ">
        <div className="tf-ic-review-metric">
          <span>Báo giá Net</span>
          <strong>{review.totals.quotation ? displayMoney(review.totals.quotation.net) : "—"}</strong>
          <small>{review.totals.quotation ? `Gross ${displayMoney(review.totals.quotation.gross)}` : "Không có số liệu đối chiếu"}</small>
        </div>
        <div className="tf-ic-review-metric">
          <span>Tổng IC Net</span>
          <strong>{displayMoney(review.totals.ic.net)}</strong>
          <small>Gross {displayMoney(review.totals.ic.gross)}</small>
        </div>
        <div className="tf-ic-review-metric is-accent">
          <span>Biên dự kiến</span>
          <strong>{review.totals.margin?.marginDisplay ?? "—"}</strong>
          <small>{review.totals.margin ? `${review.totals.margin.percentDisplay} · Báo giá Net − IC Net` : "Chưa đủ dữ liệu báo giá–IC"}</small>
        </div>
        <div className="tf-ic-review-metric">
          <span>Minh chứng file</span>
          <strong>{review.coverage.evidenceFileLines}/{review.coverage.totalLines} dòng</strong>
          <small>{review.coverage.evidencePercent} giá trị IC · {review.coverage.evidenceReasonLines} dòng chỉ có lý do</small>
        </div>
        <div className="tf-ic-review-metric">
          <span>Nhà cung cấp</span>
          <strong>{review.coverage.vendorLines}/{review.coverage.totalLines} dòng</strong>
          <small>{review.coverage.vendorPercent} giá trị IC · {review.coverage.missingVendorLines} dòng cần kiểm tra</small>
        </div>
      </div>

      {review.warnings.length > 0 && (
        <div className="tf-ic-review-warnings" aria-label="Các điểm cần kiểm tra">
          {review.warnings.map(warning => (
            <Alert key={warning.code} tone={warning.tone} title={warning.title}>
              {warning.detail}
            </Alert>
          ))}
        </div>
      )}

      <div className="tf-ic-review-note">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>Cảnh báo hỗ trợ thẩm định và không tự thay đổi hiệu lực ngân sách, kết quả duyệt hoặc quyền chi tiền.</span>
      </div>

      <div className="tf-ic-review-toolbar">
        <div className="tf-ic-review-filters" aria-label="Lọc dòng IC">
          {FILTERS.map(option => {
            const count = option.id === "ALL" ? review.rows.length
              : option.id === "ATTENTION" ? attentionCount
              : option.id === "EVIDENCE" ? review.coverage.missingEvidenceLines
              : review.coverage.missingVendorLines;
            return (
              <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
                {option.label} <span>{count}</span>
              </button>
            );
          })}
        </div>
        <label className="tf-ic-review-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Tìm hạng mục, NCC hoặc file</span>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm hạng mục, NCC, file…" />
        </label>
      </div>

      {filter === "EVIDENCE" && review.coverage.missingEvidenceLines > 0 && (
        <p className="tf-ic-review-filter-context">
          <AlertTriangle size={14} aria-hidden="true" />
          {review.coverage.missingEvidenceLines} dòng chưa có file hoặc lý do · Gross {displayMoney(missingFileGross)}
        </p>
      )}

      <div className="tf-ic-review-table">
        <Table caption="Đối chiếu dòng IC, nhà cung cấp, báo giá và minh chứng" hideCaption>
          <thead>
            <tr>
              <th scope="col">Hạng mục</th>
              <th scope="col">Nhà cung cấp</th>
              <th scope="col" className="text-right">Báo giá Net</th>
              <th scope="col" className="text-right">IC Net</th>
              <th scope="col">Minh chứng</th>
              <th scope="col">Kiểm tra</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={row.id} id={`ic-line-${row.id}`} tabIndex={-1}>
                <th scope="row"><strong>{row.description}</strong></th>
                <td>
                  {row.vendorName ? <span className="tf-ic-review-vendor"><Store size={13} />{row.vendorName}</span> : <span className="tf-ic-review-empty">Chưa xác định</span>}
                </td>
                <td className="text-right tabular-nums">{row.quotationCost ? displayMoney(row.quotationCost.net) : "—"}</td>
                <td className="text-right tabular-nums font-semibold">{row.icCost ? displayMoney(row.icCost.net) : "—"}</td>
                <td>
                  <div className="tf-ic-review-evidence-cell">
                    <span>
                      {row.evidenceState === "FILE" ? <><FileCheck2 size={13} />{row.evidenceIds.length} file{row.hasSupplement ? " · có bổ sung" : ""}</>
                        : row.evidenceState === "REASON" ? <><Paperclip size={13} />Chỉ có lý do</>
                        : <><AlertTriangle size={13} />Chưa có</>}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEvidence(row, false)}><Eye size={13} /> Xem</Button>
                      {canSupplement && request.state !== "DRAFT" && <Button variant="secondary" size="sm" onClick={() => openEvidence(row, true)}>Bổ sung</Button>}
                    </div>
                  </div>
                </td>
                <td><ReviewBadges row={row} /></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <div className="tf-ic-review-cards" aria-label="Đối chiếu dòng IC dạng thẻ">
        {visibleRows.map(row => (
          <article key={row.id} id={`ic-line-mobile-${row.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div><h4>{row.description}</h4><p>{row.vendorName ?? "Chưa xác định NCC"}</p></div>
              <strong>{row.icCost ? displayMoney(row.icCost.net) : "—"}</strong>
            </div>
            <dl>
              <div><dt>Báo giá Net</dt><dd>{row.quotationCost ? displayMoney(row.quotationCost.net) : "—"}</dd></div>
              <div><dt>Minh chứng</dt><dd>{row.evidenceState === "FILE" ? `${row.evidenceIds.length} file` : row.evidenceState === "REASON" ? "Chỉ có lý do" : "Chưa có"}</dd></div>
            </dl>
            <ReviewBadges row={row} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => openEvidence(row, false)}>Xem minh chứng</Button>
              {canSupplement && request.state !== "DRAFT" && <Button variant="secondary" size="sm" onClick={() => openEvidence(row, true)}>Bổ sung</Button>}
            </div>
          </article>
        ))}
      </div>

      {visibleRows.length === 0 && <p className="tf-ic-review-empty-state">Không có dòng IC phù hợp với bộ lọc hiện tại.</p>}

      <IcEvidencePanel
        finance={finance}
        readOnly={viewOnly}
        open={Boolean(line)}
        onClose={() => setLine(null)}
        targets={line ? [line.description] : []}
        ids={ids}
        reason={reason}
        files={files}
        onFiles={file => setFiles(current => [...current, file])}
        onChange={(next, value) => { setIds(next); setReason(value); }}
        footer={line && !viewOnly ? (
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            const form = new FormData();
            for (const [key, value] of Object.entries({
              projectId: finance.project.id,
              version: String(finance.version),
              command: "SUPPLEMENT_IC_EVIDENCE",
              requestId: request.id,
              requestVersion: String(request.version),
              lineId: line.id,
              operationId: operation,
              evidenceIds: JSON.stringify(ids),
              reason,
            })) form.set(key, value);
            const result = await costFlowAction({}, form);
            setBusy(false);
            setMessage(result.error ?? result.success ?? "");
            if (result.success) { setLine(null); router.refresh(); }
          }}>Lưu bổ sung riêng</Button>
        ) : undefined}
      />
      {message && <Alert title={message} />}
    </section>
  );
}
