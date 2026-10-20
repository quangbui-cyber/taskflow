"use client";

import { useMemo } from "react";
import { Check, ChevronRight, FileText, Calculator, FileCheck, Receipt, Landmark } from "lucide-react";
import type { Finance, CostFlowTabId } from "@/components/CostFlowPanel";
import { displayMoney, totals } from "@/lib/costflow/money";
import { completeIcLines } from "@/lib/costflow/budgetDraft";
import { projectQuotation } from "@/lib/costflow/quotationProjection";

type Props = {
  finance: Finance;
  activeTab: CostFlowTabId;
  onSelectTab: (tab: CostFlowTabId) => void;
};

type StageConfig = {
  id: CostFlowTabId;
  stepNumber: number;
  label: string;
  icon: typeof FileText;
  isCompleted: boolean;
  isCurrentProjectStage: boolean;
  summaryText: string;
  statusTone: "completed" | "current" | "upcoming";
};

export default function FinancialLifecycleBar({ finance, activeTab, onSelectTab }: Props) {
  const data = finance.data;
  const requests = finance.requests;
  const quotations = useMemo(() => finance.data.quotations ?? [], [finance.data.quotations]);
  const actualCostLines = useMemo(() => finance.actualCosts?.lines ?? [], [finance.actualCosts?.lines]);
  const latestQuotation = quotations.at(-1);
  const effectiveRevision = data.revisions?.find(r => r.effective);
  const isClosed = !!data.closed;

  const latestQuotationGross = useMemo(() => {
    if (!latestQuotation) return null;
    try {
      return projectQuotation(latestQuotation).amount.gross;
    } catch {
      return null;
    }
  }, [latestQuotation]);

  const effectiveIcNet = useMemo(() => {
    if (!effectiveRevision) return null;
    try {
      return totals(completeIcLines(effectiveRevision.lines).map(line => line.cost)).net;
    } catch {
      return null;
    }
  }, [effectiveRevision]);

  const pendingRequests = useMemo(() => {
    return requests.filter(r => r.state === "SUBMITTED").length;
  }, [requests]);

  const missingEvidence = useMemo(() => {
    return actualCostLines.filter(line => line.missingEvidenceWarnings.length > 0).length;
  }, [actualCostLines]);

  // Determine current organizational stage index (1-based: 1 to 5)
  const currentProjectStageIndex = useMemo(() => {
    if (isClosed) return 5;
    if (finance.customerAccounting?.currentLiquidation?.documentNumber) return 5;
    if (actualCostLines.length > 0) return 4;
    if (effectiveRevision) return 3;
    if (quotations.length > 0) return 2;
    return 1;
  }, [isClosed, finance.customerAccounting, actualCostLines.length, effectiveRevision, quotations.length]);

  const stages: StageConfig[] = useMemo(() => [
    {
      id: "scope",
      stepNumber: 1,
      label: "Báo giá & Scope",
      icon: FileText,
      isCompleted: quotations.length > 0,
      isCurrentProjectStage: currentProjectStageIndex === 1,
      summaryText: latestQuotation
        ? `BG-${latestQuotation.number}${latestQuotationGross ? ` · ${displayMoney(latestQuotationGross)}` : ""}`
        : "Chưa có báo giá",
      statusTone: quotations.length > 0 ? "completed" : currentProjectStageIndex === 1 ? "current" : "upcoming",
    },
    {
      id: "ic",
      stepNumber: 2,
      label: "Dự toán IC",
      icon: Calculator,
      isCompleted: !!effectiveRevision,
      isCurrentProjectStage: currentProjectStageIndex === 2,
      summaryText: effectiveRevision
        ? `Rev ${effectiveRevision.number} · ${effectiveIcNet ? displayMoney(effectiveIcNet) : "Đã duyệt"}`
        : quotations.length > 0
          ? "Cần lập dự toán"
          : "Chờ báo giá",
      statusTone: effectiveRevision ? "completed" : currentProjectStageIndex === 2 ? "current" : "upcoming",
    },
    {
      id: "approvals",
      stepNumber: 3,
      label: "Tạm ứng & Hồ sơ",
      icon: FileCheck,
      isCompleted: requests.some(r => r.state === "APPROVED") || finance.cash.length > 0,
      isCurrentProjectStage: currentProjectStageIndex === 3,
      summaryText: pendingRequests > 0
        ? `${pendingRequests} hồ sơ chờ duyệt`
        : requests.length > 0
          ? `${requests.length} hồ sơ hoàn tất`
          : "Chưa có hồ sơ",
      statusTone: (requests.some(r => r.state === "APPROVED") || finance.cash.length > 0)
        ? "completed"
        : currentProjectStageIndex === 3 ? "current" : "upcoming",
    },
    {
      id: "expense",
      stepNumber: 4,
      label: "Chi phí thực tế (AC)",
      icon: Receipt,
      isCompleted: actualCostLines.length > 0 && missingEvidence === 0,
      isCurrentProjectStage: currentProjectStageIndex === 4,
      summaryText: missingEvidence > 0
        ? `Thiếu ${missingEvidence} chứng từ`
        : actualCostLines.length > 0
          ? `${actualCostLines.length} khoản chi net`
          : "Chưa phát sinh",
      statusTone: (actualCostLines.length > 0 && missingEvidence === 0)
        ? "completed"
        : currentProjectStageIndex === 4 ? "current" : "upcoming",
    },
    {
      id: "close",
      stepNumber: 5,
      label: "Quyết toán & Đóng",
      icon: Landmark,
      isCompleted: isClosed,
      isCurrentProjectStage: currentProjectStageIndex === 5,
      summaryText: isClosed
        ? "Đã đóng tài chính"
        : finance.customerAccounting?.currentLiquidation?.documentNumber
          ? "Đang quyết toán"
          : "Chưa quyết toán",
      statusTone: isClosed ? "completed" : currentProjectStageIndex === 5 ? "current" : "upcoming",
    },
  ], [
    quotations, latestQuotation, latestQuotationGross, effectiveRevision, effectiveIcNet,
    requests, finance.cash.length, pendingRequests, actualCostLines, missingEvidence, isClosed,
    finance.customerAccounting, currentProjectStageIndex
  ]);

  return (
    <section className="tf-lifecycle-container" aria-label="Tiến trình tài chính dự án">
      <div className="tf-lifecycle-header">
        <span className="tf-lifecycle-heading-title">Tiến trình tài chính</span>
        <span className="tf-lifecycle-current-badge">
          Giai đoạn hiện tại: <strong>{stages.find(s => s.isCurrentProjectStage)?.label}</strong>
        </span>
      </div>

      <nav className="tf-lifecycle-bar" aria-label="Các giai đoạn tài chính">
        <ol className="tf-lifecycle-steps">
          {stages.map((stage, idx) => {
            const isSelected = activeTab === stage.id;
            const Icon = stage.icon;

            return (
              <li key={stage.id} className="tf-lifecycle-step-item">
                <button
                  type="button"
                  onClick={() => onSelectTab(stage.id)}
                  className={`tf-lifecycle-step-btn ${
                    isSelected ? "is-selected" : ""
                  } is-${stage.statusTone} ${stage.isCurrentProjectStage ? "is-project-stage" : ""}`}
                  aria-current={isSelected ? "step" : undefined}
                >
                  <div className="tf-lifecycle-step-indicator">
                    {stage.isCompleted ? (
                      <span className="tf-lifecycle-check-icon" aria-hidden="true">
                        <Check size={13} strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="tf-lifecycle-num">{stage.stepNumber}</span>
                    )}
                  </div>

                  <div className="tf-lifecycle-step-content">
                    <div className="tf-lifecycle-step-title-row">
                      <Icon size={14} className="tf-lifecycle-icon" aria-hidden="true" />
                      <span className="tf-lifecycle-step-title">{stage.label}</span>
                    </div>
                    <span className="tf-lifecycle-step-summary">{stage.summaryText}</span>
                  </div>
                </button>

                {idx < stages.length - 1 && (
                  <div
                    className={`tf-lifecycle-connector ${
                      stages[idx].isCompleted ? "is-completed" : ""
                    }`}
                    aria-hidden="true"
                  >
                    <ChevronRight size={14} className="tf-lifecycle-arrow" />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </section>
  );
}
