import { Building2, ReceiptText } from "lucide-react";
import { Badge, Panel } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";

type Progress = {
  percent: number;
  complete: boolean;
};

export type InternalSettlementProgress = Progress & {
  settledSources: number;
  totalSources: number;
  actualGross: string;
  advanceGross: string;
  outstandingGross: string;
};

export type CustomerSettlementProgress = Progress & {
  liquidationSigned: boolean;
  liquidationGross: string;
  collectedGross: string;
  outstandingGross: string;
};

function ProgressBar({ value, label }: { value: number; label: string }) {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return <div className="space-y-1">
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <strong className="tabular-nums">{normalized}%</strong>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-soft)]" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}>
      <div className="h-full rounded-full bg-[var(--success)] transition-[width]" style={{ width: `${normalized}%` }} />
    </div>
  </div>;
}

export default function SettlementProgressCards({ internal, customer }: {
  internal: InternalSettlementProgress;
  customer: CustomerSettlementProgress;
}) {
  return <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Tiến độ đóng tài chính hai chiều">
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2"><ReceiptText size={18} aria-hidden="true" /><h3 className="font-bold">Tiến độ Đối soát Nội bộ</h3></div>
        <Badge tone={internal.complete ? "success" : "warning"}>{internal.complete ? "Đủ điều kiện" : "Chưa hoàn tất"}</Badge>
      </div>
      <ProgressBar value={internal.percent} label="AC đã quyết toán và công nợ đã cân đối" />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-[var(--text-secondary)]">AC đã quyết toán</dt><dd className="font-semibold">{internal.settledSources}/{internal.totalSources} nguồn</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Công nợ nội bộ</dt><dd className="font-mono font-semibold tabular-nums">{displayMoney(internal.outstandingGross)}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">AC thực tế Gross</dt><dd className="font-mono tabular-nums">{displayMoney(internal.actualGross)}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Tạm ứng Gross</dt><dd className="font-mono tabular-nums">{displayMoney(internal.advanceGross)}</dd></div>
      </dl>
    </Panel>
    <Panel className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2"><Building2 size={18} aria-hidden="true" /><h3 className="font-bold">Tiến độ Doanh thu Khách hàng</h3></div>
        <Badge tone={customer.complete ? "success" : "warning"}>{customer.complete ? "Đã thu đủ" : "Còn phải thu"}</Badge>
      </div>
      <ProgressBar value={customer.percent} label="Tỷ lệ AR đã thu trên giá trị thanh lý" />
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-[var(--text-secondary)]">Thanh lý đã ký</dt><dd className="font-semibold">{customer.liquidationSigned ? "Đã có bản ký" : "Chưa có bản ký"}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">AR còn phải thu</dt><dd className="font-mono font-semibold tabular-nums">{displayMoney(customer.outstandingGross)}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Giá trị thanh lý Gross</dt><dd className="font-mono tabular-nums">{displayMoney(customer.liquidationGross)}</dd></div>
        <div><dt className="text-xs text-[var(--text-secondary)]">Đã thu vào quỹ</dt><dd className="font-mono tabular-nums">{displayMoney(customer.collectedGross)}</dd></div>
      </dl>
    </Panel>
  </section>;
}
