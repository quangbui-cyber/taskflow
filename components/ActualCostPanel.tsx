"use client";

import { useActionState, useMemo, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import {
  FileSpreadsheet,
  Layers3,
  Send,
  ShieldCheck,
} from "lucide-react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Alert, Badge } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import type { ActualCostReadLine } from "@/lib/costflow/actualCostReadModel";
import ActualCostSheetView from "@/components/costflow/actual-cost/ActualCostSheetView";
import ActualCostDetailDrawer from "@/components/costflow/actual-cost/ActualCostDetailDrawer";
import ActualCostPreflightModal from "@/components/costflow/actual-cost/ActualCostPreflightModal";
import ActualCostControlCenter from "@/components/costflow/actual-cost/ActualCostControlCenter";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  canCreate: boolean;
  onSelectTab?: (tab: string) => void;
};

export default function ActualCostPanel({ finance, user, onSelectTab }: Props) {
  const [activeView, setActiveView] = useState<"sheet" | "control-center">("sheet");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState<ActualCostReadLine | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [successorState, successorAction, successorPending] = useActionState(actualCostAction, {} as ActualCostActionState);

  const effective = finance.data.revisions.find(r => r.effective);
  const actualCosts = finance.actualCosts;
  const sheet = actualCosts?.sheet;
  const lines = useMemo(() => actualCosts?.lines ?? [], [actualCosts?.lines]);
  const comparisons = useMemo(() => actualCosts?.comparisons ?? [], [actualCosts?.comparisons]);

  const capabilities = actualCosts?.controlCenter.capabilities;
  const canEdit = !finance.data.closed && sheet?.state === "DRAFT" && !!(capabilities?.account || capabilities?.self);
  const canReview = canEdit && !!capabilities?.account;
  const isDd = actualCosts?.canDecide ?? false;

  // Stats calculation
  const stats = useMemo(() => {
    let completeEvidence = 0;
    let reviewed = 0;
    let needsAttention = 0;

    for (const line of lines) {
      if (line.missingEvidenceWarnings.length === 0) {
        completeEvidence++;
      }
      if (line.internalStatus === "ACCOUNT_REVIEWED") {
        reviewed++;
      }
      if (line.internalStatus !== "ACCOUNT_REVIEWED" || line.missingEvidenceWarnings.length > 0
        || line.sourceKind === "UNBUDGETED"
        || comparisons.some(item => item.status === "OVER_BUDGET" && item.actualLineIds.includes(line.id))) {
        needsAttention++;
      }
    }

    return {
      completeEvidence,
      reviewed,
      needsAttention,
      count: lines.length,
    };
  }, [lines, comparisons]);

  const handleOpenDetail = (line: ActualCostReadLine) => {
    setSelectedLine(line);
    setDrawerOpen(true);
  };

  const handleAddNew = () => {
    setSelectedLine(null);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER & WORKSPACE HERO */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--foreground)]">
              Bảng AC – Tổng hợp thực chi
            </h2>
            <Badge tone="info">
              {sheet?.revisionId ? `Phiên bản AC-R${sheet.version}` : "Chưa lập phiên bản AC"}
            </Badge>
            {sheet?.state && (
              <Badge tone={sheet.state === "APPROVED" ? "success" : sheet.state === "RETURNED" ? "warning" : sheet.state === "SUBMITTED" ? "info" : "neutral"}>
                {sheet.state === "APPROVED" ? "Đã Duyệt AC toàn bảng" :
                 sheet.state === "RETURNED" ? "Trả lại để chỉnh sửa" :
                 sheet.state === "SUBMITTED" ? "Chờ Duyệt AC" : "Đang soạn thảo"}
              </Badge>
            )}
            <Badge tone="neutral">Expense cũ chỉ đọc</Badge>
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Một Bảng AC tổng hợp duy nhất cho dự án · Cùng nhập, Account kiểm tra, Phó Giám đốc duyệt toàn bộ.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {canReview && (
            <>
              <Button size="sm" onClick={() => setPreflightOpen(true)}>
                <Send size={14} className="mr-1" />
                Kiểm tra trước khi gửi
              </Button>
            </>
          )}
        </div>
      </div>

      {sheet?.state === "RETURNED" && sheet.revisionId && capabilities?.account && !finance.data.closed && (
        <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-4 space-y-3">
          <p className="text-sm font-semibold text-[var(--foreground)]">Bảng AC-R{sheet.version} đã được trả lại</p>
          {sheet.lastReturnReason && <p className="text-sm text-[var(--foreground)]">Ý kiến Phó Giám đốc: {sheet.lastReturnReason}</p>}
          <p className="text-xs text-[var(--text-secondary)]">Tạo phiên bản mới từ toàn bộ khoản chi hiện tại, chỉnh sửa theo ý kiến DD rồi gửi lại cả Bảng AC.</p>
          <form action={successorAction}>
            <input type="hidden" name="projectId" value={finance.project.id} />
            <input type="hidden" name="actualCostCommand" value="CREATE_SUCCESSOR" />
            <input type="hidden" name="sheetRevisionId" value={sheet.revisionId} />
            <input type="hidden" name="sheetMutationVersion" value={sheet.mutationVersion} />
            <Button type="submit" size="sm" loading={successorPending}>Tạo Bảng AC-R{sheet.version + 1} để gửi lại</Button>
          </form>
          {successorState.error && <Alert tone="danger" title={successorState.error} />}
          {successorState.success && <Alert tone="success" title={successorState.success} />}
        </div>
      )}

      {sheet?.state === "DRAFT" && sheet.version > 1 && sheet.lastReturnReason && (
        <Alert tone="warning" title={`Ý kiến Phó Giám đốc ở lần duyệt trước: ${sheet.lastReturnReason}`} />
      )}

      {/* Official whole-sheet decision lives in Trình duyệt; Actual Cost only reflects it. */}
      {isDd && sheet?.state === "SUBMITTED" && sheet.revisionId && (
        <div className="rounded-2xl border border-[var(--primary)] bg-[var(--primary-soft)] p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-[var(--primary)]" />
              <div>
                <h3 className="font-bold text-sm text-[var(--foreground)]">
                  Thẩm định và phê duyệt toàn bộ Bảng AC
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">
                  Bạn đang xem Bảng AC phiên bản AC-R{sheet.version} với {lines.length} khoản chi.
                </p>
              </div>
            </div>
            {onSelectTab && (
              <Button size="sm" variant="secondary" onClick={() => onSelectTab("approvals")}>
                Mở Duyệt AC trong tab Trình duyệt
              </Button>
            )}
          </div>
        </div>
      )}

      {/* KPI SUMMARY STRIP */}
      <div className="tf-summary-strip">
        <div className="tf-summary-item">
          <span className="tf-summary-label">Thực chi chưa VAT</span>
          <span className="tf-summary-value">{displayMoney(actualCosts?.summary.actual.net ?? "0")}</span>
          <span className="tf-summary-hint">{stats.count} khoản chi thực tế</span>
        </div>
        <div className="tf-summary-item">
          <span className="tf-summary-label">Chênh lệch thực chi so với IC</span>
          <span className="tf-summary-value">{displayMoney(actualCosts?.summary.variance.net ?? "0")}</span>
          <span className="tf-summary-hint">So theo tiền chưa VAT · {effective ? `Bản IC ${effective.number}` : "Chưa có Bản IC"}</span>
        </div>
        <div className="tf-summary-item">
          <span className="tf-summary-label">Tổng thực chi gồm VAT</span>
          <span className="tf-summary-value">{displayMoney(actualCosts?.summary.actual.gross ?? "0")}</span>
          <span className="tf-summary-hint">VAT: {displayMoney(actualCosts?.summary.actual.vat ?? "0")}</span>
        </div>
        <div className="tf-summary-item">
          <span className="tf-summary-label">Cần xử lý</span>
          <span className="tf-summary-value">{stats.needsAttention} khoản</span>
          <span className="tf-summary-hint">{stats.reviewed} / {stats.count} đã kiểm tra · {stats.count - stats.completeEvidence} thiếu chứng từ</span>
        </div>
      </div>

      {/* VIEW SELECTOR TABS */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
        <button
          type="button"
          onClick={() => setActiveView("sheet")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeView === "sheet"
              ? "bg-[var(--primary)] text-white shadow-xs"
              : "bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-[var(--foreground)]"
          }`}
        >
          <FileSpreadsheet size={14} />
          Bảng AC tổng hợp ({lines.length})
        </button>

        {actualCosts?.controlCenter && (
          <button
            type="button"
            onClick={() => setActiveView("control-center")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeView === "control-center"
                ? "bg-[var(--primary)] text-white shadow-xs"
                : "bg-[var(--surface-soft)] text-[var(--text-secondary)] hover:text-[var(--foreground)]"
            }`}
          >
            <Layers3 size={14} />
            Đối chiếu & Kiểm toán chi tiết
          </button>
        )}
      </div>

      {/* PRIMARY WORKSPACE CONTENT */}
      {activeView === "sheet" && (
        <ActualCostSheetView
          finance={finance}
          onSelectLine={handleOpenDetail}
          onAddNew={handleAddNew}
          canEdit={canEdit}
          canReview={canReview}
          currentUserId={user.id}
        />
      )}

      {activeView === "control-center" && actualCosts?.controlCenter && (
        <ActualCostControlCenter center={actualCosts.controlCenter} />
      )}

      {/* REGULATORY & GOVERNANCE POLICY BOX */}
      <div className="tf-ac-policy">
        <div className="tf-ac-policy-heading">
          <div className="tf-ac-policy-icon" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h3>Nguyên tắc vận hành Bảng AC</h3>
            <p>Quy định nghiệm thu chi phí, thẩm quyền phê duyệt và mối liên hệ với dòng tiền thực tế.</p>
          </div>
        </div>

        <div className="tf-ac-policy-grid">
          <div>
            <dt>Duyệt toàn bộ Bảng AC</dt>
            <dd>
              Mỗi Project có duy nhất một Bảng AC. Toàn bộ các dòng chi phí trong phiên bản được gửi, xem xét và phê duyệt cùng lúc bởi Phó Giám đốc (DD).
            </dd>
          </div>
          <div>
            <dt>Tách biệt Phê duyệt và Giải ngân</dt>
            <dd>
              <strong>Lưu ý:</strong> phê duyệt AC và giải ngân vẫn là hai bước riêng. Dòng AC đã duyệt phát hành quyền lập ĐNTT hoặc Hoàn tạm ứng, không tự động sinh giao dịch tiền mặt.
            </dd>
          </div>
          <div>
            <dt>Cơ chế Cùng nhập – Account kiểm tra</dt>
            <dd>
              Thành viên dự án cùng nhập các khoản chi phụ trách; Account có toàn quyền sửa trực tiếp trước khi kích hoạt quy trình gửi duyệt.
            </dd>
          </div>
          <div>
            <dt>Tổng tiền VND không cộng dồn số lượng</dt>
            <dd>
              Dòng tổng cộng chân bảng chỉ cộng Tổng NET, VAT, GROSS (VND). Tuyệt đối không cộng dồn số lượng của các đơn vị tính khác nhau.
            </dd>
          </div>
        </div>
      </div>

      {/* DETAIL DRAWER */}
      <ActualCostDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        line={selectedLine}
        finance={finance}
        currentUserId={user.id}
        canEdit={canEdit && (!selectedLine || !!capabilities?.account || selectedLine.createdById === user.id)}
        canReview={canReview}
      />

      {/* PREFLIGHT MODAL */}
      <ActualCostPreflightModal
        open={preflightOpen}
        onClose={() => setPreflightOpen(false)}
        finance={finance}
      />
    </div>
  );
}
