"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { Finance, CostFlowTabId } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";

type Props = {
  finance: Finance;
  user: { id: string; role: string };
  onSelectTab: (tab: CostFlowTabId) => void;
  onOpenCreateQuotation?: () => void;
  worksheetHref?: string;
};

type ActionBannerData = {
  tone: "brand" | "warning" | "danger" | "info" | "success";
  badgeText: string;
  title: string;
  description: string;
  icon: typeof Sparkles;
  primaryAction: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
};

export default function CostFlowActionBanner({
  finance,
  user,
  onSelectTab,
  onOpenCreateQuotation,
  worksheetHref,
}: Props) {
  const { data, requests, fullAccess } = finance;
  const quotations = data.quotations ?? [];
  const latestQuotation = quotations.at(-1);
  const effectiveRevision = data.revisions?.find(r => r.effective);
  const isClosed = !!data.closed;
  const canCreate = fullAccess && ["ADMIN", "ACCOUNT"].includes(user.role);
  const actualCostLines = finance.actualCosts?.lines ?? [];

  // 1. Check for approvals pending for the current user
  const myPendingRequests = useMemo(() => {
    return requests.filter(r => {
      if (r.state !== "SUBMITTED") return false;
      const curr = r.steps[r.currentStep];
      return curr?.assigneeId === user.id;
    });
  }, [requests, user.id]);

  // 2. Check for requests returned to current user
  const myReturnedRequests = useMemo(() => {
    return requests.filter(r => r.creatorId === user.id && r.state === "RETURNED");
  }, [requests, user.id]);

  // 3. Check for AC missing evidence
  const missingEvidenceCount = useMemo(() => {
    return actualCostLines.filter(line => line.missingEvidenceWarnings.length > 0).length;
  }, [actualCostLines]);

  // 4. Determine banner data based on priority rules
  const bannerData: ActionBannerData | null = useMemo(() => {
    // Priority 1: User needs to take approval action
    if (myPendingRequests.length > 0) {
      return {
        tone: "warning",
        badgeText: "Cần bạn duyệt",
        title: `Bạn có ${myPendingRequests.length} hồ sơ đang chờ phê duyệt`,
        description: "Có đề nghị tạm ứng hoặc thanh toán đang đợi quyết định từ bạn để thực hiện giải ngân đúng hạn.",
        icon: Clock,
        primaryAction: {
          label: "Duyệt hồ sơ ngay",
          onClick: () => onSelectTab("approvals"),
        },
      };
    }

    // Priority 2: User's requests returned
    if (myReturnedRequests.length > 0) {
      return {
        tone: "danger",
        badgeText: "Hồ sơ bị trả về",
        title: `Có ${myReturnedRequests.length} hồ sơ bị trả về cần bạn cập nhật`,
        description: "Hồ sơ đã được Quản lý hoặc Kế toán ghi chú lý do trả về. Vui lòng xem nhận xét và gửi lại.",
        icon: RotateCcw,
        primaryAction: {
          label: "Xem hồ sơ bị trả về",
          onClick: () => onSelectTab("approvals"),
        },
      };
    }

    // Priority 3: Project has no Quotation yet
    if (quotations.length === 0) {
      return {
        tone: "brand",
        badgeText: "Khởi đầu dự án",
        title: "Bước 1: Khởi tạo Báo giá đầu tiên cho dự án",
        description: "Bắt đầu bằng cách tạo cấu trúc hạng mục và đơn giá bán cho khách hàng. Đây sẽ là căn cứ để xây dựng giá vốn (IC).",
        icon: Sparkles,
        primaryAction: canCreate && onOpenCreateQuotation
          ? {
              label: "Tạo báo giá mới",
              onClick: onOpenCreateQuotation,
            }
          : {
              label: "Mở Scope & Báo giá",
              onClick: () => onSelectTab("scope"),
            },
      };
    }

    // Priority 4: Has Quotation, but no effective IC
    if (!effectiveRevision) {
      const icRequest = requests.find(r => r.kind === "IC" && r.state === "SUBMITTED");
      if (icRequest) {
        return {
          tone: "info",
          badgeText: "Đang xét duyệt",
          title: "Dự toán IC đã gửi và đang chờ Quản lý phê duyệt",
          description: "Ngân sách sẽ chính thức có hiệu lực sau khi Quản lý duyệt. Khi đó bạn có thể bắt đầu lập đề nghị tạm ứng.",
          icon: Clock,
          primaryAction: {
            label: "Xem tiến độ duyệt IC",
            onClick: () => onSelectTab("approvals"),
          },
        };
      }

      return {
        tone: "brand",
        badgeText: "Bước tiếp theo",
        title: `Bước 2: Lập dự toán chi phí nội bộ (IC) từ BG-${latestQuotation?.number ?? ""}`,
        description: "Báo giá đã có. Hãy hoàn thiện giá vốn mua, gắn Nhà cung cấp và đính kèm minh chứng để trình duyệt dự toán.",
        icon: Calculator,
        primaryAction: worksheetHref
          ? {
              label: "Lập dự toán IC ngay",
              href: worksheetHref,
            }
          : {
              label: "Mở Internal Cost",
              onClick: () => onSelectTab("ic"),
            },
        secondaryAction: {
          label: "Xem báo giá hiện hành",
          onClick: () => onSelectTab("scope"),
        },
      };
    }

    // Priority 5: Missing AC evidence
    if (missingEvidenceCount > 0 && canCreate) {
      return {
        tone: "warning",
        badgeText: "Chứng từ cần bổ sung",
        title: `Có ${missingEvidenceCount} khoản chi thực tế (AC) chưa đủ hóa đơn/UNC`,
        description: "Bổ sung đầy đủ chứng từ gốc cho các khoản chi đã phát sinh để sẵn sàng cho bước quyết toán cuối cùng.",
        icon: AlertCircle,
        primaryAction: {
          label: "Bổ sung chứng từ ngay",
          onClick: () => onSelectTab("expense"),
        },
      };
    }

    // Priority 6: Ready for Settlement / Liquidation
    if (!isClosed && actualCostLines.length > 0 && missingEvidenceCount === 0 && actualCostLines.every(line => line.reviewState === "approved")) {
      return {
        tone: "brand",
        badgeText: "Sẵn sàng quyết toán",
        title: "Bước 5: Dự án đã đủ điều kiện lập Quyết toán tài chính",
        description: "Toàn bộ chi phí thực tế đã có đầy đủ chứng từ và được DD duyệt. Tiến hành đối chiếu công nợ và hoàn ứng.",
        icon: FileCheck2,
        primaryAction: {
          label: "Mở màn hình Quyết toán",
          onClick: () => onSelectTab("close"),
        },
      };
    }

    // Priority 7: Project Closed
    if (isClosed) {
      return {
        tone: "success",
        badgeText: "Đã hoàn tất",
        title: "Dự án đã đóng tài chính và lưu trữ thành công",
        description: "Toàn bộ nghĩa vụ tạm ứng, công nợ nội bộ và tiền khách hàng đã đối soát về 0. Bảng quyết toán đã khóa bất biến.",
        icon: CheckCircle2,
        primaryAction: {
          label: "Xem hồ sơ quyết toán đã khóa",
          onClick: () => onSelectTab("close"),
        },
      };
    }

    // Default: General project in progress
    return {
      tone: "brand",
      badgeText: "Đang thi công",
      title: "Dự án đang trong giai đoạn triển khai & theo dõi chi phí",
      description: "Ngân sách IC đang hiệu lực. Bạn có thể lập đề nghị tạm ứng, theo dõi chi phí thực tế phát sinh (AC) và thu chi.",
      icon: FileText,
      primaryAction: {
        label: "Lập hồ sơ tạm ứng/chi",
        onClick: () => {
          onSelectTab("approvals");
          if (typeof window !== "undefined") {
            const url = new URL(window.location.href);
            url.searchParams.set("tab", "approvals");
            url.searchParams.set("openCreateRequest", "1");
            window.history.pushState(null, "", `${url.pathname}${url.search}`);
            window.dispatchEvent(new Event("popstate"));
          }
        },
      },
      secondaryAction: {
        label: "Xem chi phí AC",
        onClick: () => onSelectTab("expense"),
      },
    };
  }, [
    myPendingRequests.length,
    myReturnedRequests.length,
    quotations.length,
    canCreate,
    onOpenCreateQuotation,
    onSelectTab,
    effectiveRevision,
    requests,
    latestQuotation?.number,
    worksheetHref,
    missingEvidenceCount,
    isClosed,
    actualCostLines,
  ]);

  if (!bannerData) return null;

  const Icon = bannerData.icon;

  return (
    <div className={`tf-action-banner is-${bannerData.tone}`} role="region" aria-label="Hành động tiếp theo">
      <div className="tf-action-banner-icon-col">
        <div className="tf-action-banner-icon-box" aria-hidden="true">
          <Icon size={20} strokeWidth={2.2} />
        </div>
      </div>

      <div className="tf-action-banner-body">
        <div className="tf-action-banner-meta">
          <span className="tf-action-banner-badge">{bannerData.badgeText}</span>
          <span className="tf-action-banner-label">Hành động gợi ý cho bạn</span>
        </div>
        <h3 className="tf-action-banner-title">{bannerData.title}</h3>
        <p className="tf-action-banner-desc">{bannerData.description}</p>
      </div>

      <div className="tf-action-banner-actions">
        {bannerData.primaryAction.href ? (
          <Link href={bannerData.primaryAction.href} className="tf-button-primary tf-button-size-md">
            <span>{bannerData.primaryAction.label}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ) : (
          <Button
            size="md"
            variant={bannerData.tone === "danger" ? "danger" : "primary"}
            onClick={bannerData.primaryAction.onClick}
          >
            <span>{bannerData.primaryAction.label}</span>
            <ArrowRight size={15} aria-hidden="true" />
          </Button>
        )}

        {bannerData.secondaryAction && (
          <Button
            size="md"
            variant="secondary"
            onClick={bannerData.secondaryAction.onClick}
          >
            {bannerData.secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
