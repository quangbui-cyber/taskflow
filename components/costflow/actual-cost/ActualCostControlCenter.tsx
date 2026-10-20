"use client";

import { useState } from "react";
import { Badge, Panel } from "@/components/ui/Presentation";
import type { ActualCostControlCenter as Center, ActualCostLens } from "@/lib/costflow/actualCostControlCenter";
import IcAcReconciliationWorksheet from "./IcAcReconciliationWorksheet";
import { AuditView, StaffView, VendorView } from "./ActualCostRoleViews";

const LABELS: Record<ActualCostLens, string> = {
  COST_TYPES: "Theo loại chi phí / dòng IC",
  SELF: "Của tôi",
  VENDORS: "Theo NCC",
  AUDIT: "Bất thường & kiểm toán",
};

export default function ActualCostControlCenter({ center }: { center: Center }) {
  const [lens, setLens] = useState<ActualCostLens>(center.defaultLens);
  const activeLens = center.capabilities.lenses.includes(lens) ? lens : center.defaultLens;
  return <Panel className="tf-ac-control-center space-y-5">
    <div className="tf-section-heading"><div><div className="flex flex-wrap items-center gap-2"><h2>Đối chiếu và kiểm soát Bảng AC</h2><Badge tone="info">Tài chính dự án</Badge></div><p>Đối chiếu IC, thực chi, chứng từ, hồ sơ thanh toán và tiền thực tế theo đúng trách nhiệm.</p></div></div>
    <div className="tf-ac-lens-tabs" role="tablist" aria-label="Góc nhìn Bảng AC">{center.capabilities.lenses.map(value => <button key={value} type="button" role="tab" aria-selected={activeLens === value} onClick={() => setLens(value)}>{LABELS[value]}</button>)}</div>
    <p className="tf-ac-axis-note"><strong>Các trục độc lập:</strong> DD phê duyệt AC · đủ chứng từ · hồ sơ được duyệt · tiền đã chi · quyết toán · đóng tài chính.</p>
    {activeLens === "COST_TYPES" && <IcAcReconciliationWorksheet center={center} />}
    {activeLens === "SELF" && <StaffView center={center} />}
    {activeLens === "VENDORS" && <VendorView center={center} />}
    {activeLens === "AUDIT" && <AuditView center={center} />}
  </Panel>;
}
