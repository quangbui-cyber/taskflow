"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert, Badge, Table } from "@/components/ui/Presentation";
import { recipientDisplayName } from "@/lib/costflow/labels";
import { displayMoney } from "@/lib/costflow/money";

type ActualCosts = NonNullable<Finance["actualCosts"]>;
type Line = ActualCosts["lines"][number];
type View = "IC" | "VENDOR" | "EMPLOYEE";
type ApprovalFilter = "ALL" | "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";

function signedMoney(value: string) { return value === "0" ? displayMoney(value) : `${value.startsWith("-") ? "" : "+"}${displayMoney(value)}`; }
function statusLabel(status: ActualCosts["comparisons"][number]["status"]) { return status === "OVER_BUDGET" ? "Vượt ngân sách" : status === "SAVING" ? "Tiết kiệm" : "Đúng ngân sách"; }
function approvalLabel(line: Line) { return line.reviewState === "approved" ? "APPROVED · Đã duyệt" : line.reviewState === "returned" ? "RETURNED · Trả lại" : line.reviewState === "submitted" ? "SUBMITTED · Chờ DD" : "DRAFT / needsReview"; }
function approvalTone(line: Line): "success" | "warning" | "info" | "neutral" { return line.reviewState === "approved" ? "success" : line.reviewState === "returned" ? "warning" : line.reviewState === "submitted" ? "info" : "neutral"; }

export default function ActualCostTable({ finance }: { finance: Finance }) {
  const actualCosts = finance.actualCosts;
  const [view, setView] = useState<View>("IC");
  const [approval, setApproval] = useState<ApprovalFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const users = useMemo(() => new Map(finance.users.map(user => [user.id, user.name])), [finance.users]);
  const recipient = useCallback(
    (key: string) => recipientDisplayName(key, users, finance.data.beneficiaries),
    [finance.data.beneficiaries, users],
  );
  const lines = useMemo(() => {
    if (!actualCosts) return [];
    const query = search.trim().toLocaleLowerCase("vi");
    return actualCosts.lines.filter(line => {
      if (view === "VENDOR" && !line.recipientKey.startsWith("VENDOR:")) return false;
      if (view === "EMPLOYEE" && !line.recipientKey.startsWith("USER:")) return false;
      if (approval !== "ALL") {
        const stateName = line.reviewState === "needsReview" ? "DRAFT" : line.reviewState.toUpperCase();
        if (stateName !== approval) return false;
      }
      return !query || `${line.description} ${recipient(line.recipientKey)} ${line.stableLineId}`.toLocaleLowerCase("vi").includes(query);
    }).sort((left, right) => {
      const leftKey = view === "IC" ? `${left.icLineId ?? "~"}:${left.description}` : `${recipient(left.recipientKey)}:${left.description}`;
      const rightKey = view === "IC" ? `${right.icLineId ?? "~"}:${right.description}` : `${recipient(right.recipientKey)}:${right.description}`;
      return leftKey.localeCompare(rightKey, "vi");
    });
  }, [actualCosts, approval, recipient, search, view]);
  if (!actualCosts || !actualCosts.lines.length) return <Alert title="Chưa có Actual Cost">Tạo AC từ dòng IC hiệu lực hoặc ghi nhận phát sinh ngoài IC.</Alert>;
  const comparison = (line: Line) => actualCosts.comparisons.find(item => item.actualLineIds.includes(line.id));
  const selectable = (line: Line) => actualCosts.canDecide && line.source === "normalized" && line.reviewState === "submitted" && !!line.version && !!line.reviewToken;
  const toggle = (lineId: string) => setSelected(previous => { const next = new Set(previous); if (next.has(lineId)) next.delete(lineId); else next.add(lineId); return next; });
  const selectableLines = lines.filter(selectable);
  const allSelected = selectableLines.length > 0 && selectableLines.every(l => selected.has(l.id));
  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        for (const l of selectableLines) next.delete(l.id);
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        for (const l of selectableLines) next.add(l.id);
        return next;
      });
    }
  };

  return <section className="space-y-4" aria-labelledby="actual-cost-register-heading">
    <div className="tf-section-heading"><div><h3 id="actual-cost-register-heading">Sổ Actual Cost</h3><p>Chế độ xem chỉ thay cách nhóm; quyền DD, chứng từ, settlement và tiền vẫn là các trục riêng.</p></div></div>
    <div className="tf-ac-toolbar">
      <fieldset className="tf-ac-view-selector"><legend>Nhóm Actual Cost</legend>{([["IC", "Theo dòng IC"], ["VENDOR", "Theo NCC"], ["EMPLOYEE", "Theo nhân sự"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)}>{label}</button>)}</fieldset>
      <Select label="Trạng thái duyệt" value={approval} onChange={event => setApproval(event.target.value as ApprovalFilter)}><option value="ALL">Tất cả</option><option value="DRAFT">DRAFT / needsReview</option><option value="SUBMITTED">SUBMITTED</option><option value="APPROVED">APPROVED</option><option value="RETURNED">RETURNED</option></Select>
      <Input type="search" label="Tìm Actual Cost" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nội dung, NCC, nhân sự…" />
    </div>
    {lines.length === 0 ? <Alert title="Không có dòng phù hợp">Đổi chế độ xem, trạng thái hoặc từ khóa để xem các dòng khác.</Alert> : <>
      <div className="tf-ac-desktop"><Table caption={`Actual Cost · ${lines.length} dòng`} className="tf-ac-table"><thead><tr><th scope="col">{actualCosts.canDecide && selectableLines.length > 0 ? <input type="checkbox" aria-label="Chọn tất cả các dòng" checked={allSelected} onChange={toggleAll} /> : "Chọn"}</th><th scope="col">Hạng mục / nguồn</th><th scope="col">Người nhận</th><th scope="col" className="tf-ui-number">IC GROSS</th><th scope="col" className="tf-ui-number">AC GROSS</th><th scope="col" className="tf-ui-number">Chênh lệch</th><th scope="col">Duyệt</th><th scope="col">Chứng từ</th><th scope="col">Chi tiết</th></tr></thead><tbody>{lines.map(line => { const compared = comparison(line); return <tr key={`${line.source}:${line.id}`}><td>{selectable(line) ? <input type="checkbox" aria-label={`Chọn ${line.description}`} checked={selected.has(line.id)} onChange={() => toggle(line.id)} /> : "—"}</td><th scope="row" className="tf-ac-identity"><strong>{line.description}</strong><span>{line.sourceKind === "UNBUDGETED" ? "Phát sinh ngoài IC" : line.source === "legacy" ? "Legacy / needsReview" : `Dòng IC ${line.icLineId ?? "—"}`}</span><span>SL {line.quantity ?? "—"} {line.unit ?? ""} · Ngày {line.days ?? "—"} · Đơn giá {line.unitPrice ? displayMoney(line.unitPrice) : "—"} · Thành tiền {displayMoney(line.amount)}</span></th><td>{recipient(line.recipientKey)}</td><td className="tf-ui-number">{compared?.ic ? displayMoney(compared.ic.cost.gross) : "—"}</td><td className="tf-ui-number">{displayMoney(line.amount)}</td><td className="tf-ui-number">{compared ? <><strong>{signedMoney(compared.variance.gross)}</strong><span className="block text-xs">{statusLabel(compared.status)}</span></> : "—"}</td><td><Badge tone={approvalTone(line)}>{approvalLabel(line)}</Badge></td><td><Badge tone={line.missingEvidenceWarnings.length ? "warning" : "success"}>{line.missingEvidenceWarnings.length ? `${line.missingEvidenceWarnings.length} cảnh báo` : "Đủ cốt lõi"}</Badge></td><td><a className="tf-link" href={`#actual-cost-detail-${line.id}`}>Mở chi tiết</a></td></tr>; })}</tbody><tfoot><tr><th scope="row" colSpan={4}>Tổng VND (không cộng số lượng khác đơn vị)</th><td className="tf-ui-number"><span>Tổng NET {displayMoney(actualCosts.summary.actual.net)}</span><span className="block">Tổng VAT {displayMoney(actualCosts.summary.actual.vat)}</span><span className="block">Tổng GROSS {displayMoney(actualCosts.summary.actual.gross)}</span></td><td className="tf-ui-number">{signedMoney(actualCosts.summary.variance.gross)}</td><td colSpan={3}>Không suy ra duyệt, chứng từ hoặc tiền từ tổng.</td></tr></tfoot></Table></div>
      <div className="tf-ac-mobile" aria-label="Actual Cost dạng thẻ mobile">{lines.map(line => { const compared = comparison(line); return <article key={`${line.source}:${line.id}`} className="tf-ac-card"><div className="flex items-start justify-between gap-3"><div><h4>{line.description}</h4><p>{recipient(line.recipientKey)} · {line.sourceKind === "UNBUDGETED" ? "Phát sinh ngoài IC" : line.unit || "Không có ĐVT"}</p></div>{selectable(line) && <input type="checkbox" aria-label={`Chọn ${line.description}`} checked={selected.has(line.id)} onChange={() => toggle(line.id)} />}</div><dl><div><dt>IC GROSS</dt><dd>{compared?.ic ? displayMoney(compared.ic.cost.gross) : "—"}</dd></div><div><dt>AC GROSS</dt><dd>{displayMoney(line.amount)}</dd></div><div><dt>Chênh lệch</dt><dd>{compared ? `${signedMoney(compared.variance.gross)} · ${statusLabel(compared.status)}` : "—"}</dd></div><div><dt>Khối lượng AC</dt><dd>{line.quantity ?? "—"} × {line.days ?? "—"} ngày · {line.unitPrice ? displayMoney(line.unitPrice) : "—"}</dd></div></dl><div className="flex flex-wrap gap-2"><Badge tone={approvalTone(line)}>{approvalLabel(line)}</Badge><Badge tone={line.missingEvidenceWarnings.length ? "warning" : "success"}>{line.missingEvidenceWarnings.length ? "Thiếu chứng từ" : "Đủ chứng từ cốt lõi"}</Badge></div><a className="tf-button-secondary tf-button-size-sm mt-3" href={`#actual-cost-detail-${line.id}`}>Mở chi tiết & thao tác</a></article>; })}</div>
    </>}
    {actualCosts.canDecide && <form action={action} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-4"><input type="hidden" name="projectId" value={finance.project.id} /><input type="hidden" name="actualCostCommand" value="BULK_DECIDE" />{actualCosts.lines.filter(line => selected.has(line.id) && selectable(line)).map(line => <input key={line.id} type="hidden" name="bulkSelection" value={JSON.stringify({ lineId: line.id, version: line.version, reviewToken: line.reviewToken })} />)}<p className="font-semibold">DD quyết định hàng loạt · {selected.size} dòng được chọn</p><Input name="reason" label="Lý do trả lại / ghi chú duyệt hàng loạt" placeholder="Bắt buộc khi trả lại" /><label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" name="acknowledgeMissingEvidence" value="yes" /><span>Tôi xác nhận duyệt các dòng đã chọn dù có cảnh báo thiếu chứng từ.</span></label>{state.error && <Alert tone="danger" title={state.error} />}{state.success && <Alert tone="success" title={state.success} />}<div className="flex flex-wrap justify-end gap-2"><Button type="submit" name="decision" value="RETURNED" variant="secondary" disabled={!selected.size} loading={pending} onClick={event => { if (!window.confirm(`Bạn có chắc chắn muốn trả lại ${selected.size} dòng Actual Cost đã chọn? Lý do trả lại là bắt buộc.`)) { event.preventDefault(); } }}>Trả lại các dòng đã chọn</Button><Button type="submit" name="decision" value="APPROVED" disabled={!selected.size} loading={pending}>DD duyệt các dòng đã chọn</Button></div></form>}
  </section>;
}
