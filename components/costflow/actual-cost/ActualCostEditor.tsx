"use client";

import { useActionState, useMemo, useState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Alert, Badge, Panel } from "@/components/ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import ActualCostDecisionBar from "./ActualCostDecisionBar";
import ActualCostTable from "./ActualCostTable";
import ActualCostEvidenceVault from "./ActualCostEvidenceVault";

const FUNDING_OPTIONS = [
  ["EMPLOYEE_ADVANCE", "Tạm ứng nhân sự"],
  ["EMPLOYEE_OUT_OF_POCKET", "Nhân sự tự chi"],
  ["VENDOR_ADVANCE", "Tạm ứng NCC"],
  ["VENDOR_PAYMENT", "Thanh toán NCC"],
] as const;

function ResubmitForm({ finance, line }: { finance: Finance; line: NonNullable<Finance["actualCosts"]>["lines"][number] }) {
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-[var(--warning)] p-3 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="projectId" value={finance.project.id} />
      <input type="hidden" name="actualCostCommand" value="RESUBMIT" />
      <input type="hidden" name="lineId" value={line.id} />
      <input type="hidden" name="version" value={line.version ?? 0} />
      <Input name="description" label="Nội dung đã sửa" defaultValue={line.description} required className="sm:col-span-2" />
      <Select name="fundingSource" label="Nguồn thanh toán" defaultValue={line.fundingSource ?? "EMPLOYEE_OUT_OF_POCKET"} required>
        {FUNDING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select>
      <Input name="quantity" label="Số lượng" defaultValue={line.quantity ?? "1"} inputMode="decimal" required />
      <Input name="days" label="Số ngày" defaultValue={line.days ?? "1"} inputMode="decimal" required />
      <Input name="unitPrice" label="Đơn giá VND" defaultValue={line.unitPrice ?? "0"} inputMode="decimal" required />
      <div className="sm:col-span-2 lg:col-span-4">
        {state.error && <Alert tone="danger" title={state.error} />}
        {state.success && <Alert tone="success" title={state.success} />}
        <div className="mt-2 flex justify-end"><Button type="submit" size="sm" loading={pending}>Gửi lại phiên bản {Number(line.version ?? 0) + 1}</Button></div>
      </div>
    </form>
  );
}

export default function ActualCostEditor({ finance, currentUserId }: { finance: Finance; currentUserId: string }) {
  const effective = finance.data.revisions.find(revision => revision.effective);
  const [icLineId, setIcLineId] = useState(effective?.lines[0]?.id ?? "");
  const [stableLineId] = useState(() => `ac-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  const actualCosts = finance.actualCosts?.lines ?? [];
  const legacyCount = actualCosts.filter(line => line.source === "legacy").length;
  const recipients = useMemo(() => [
    ...finance.project.members.map(member => ({ value: `USER:${member.userId}`, label: finance.users.find(user => user.id === member.userId)?.name ?? "Thành viên" })),
    ...finance.data.beneficiaries.map(vendor => ({ value: `VENDOR:${vendor.id}`, label: vendor.name })),
  ], [finance.data.beneficiaries, finance.project.members, finance.users]);

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[var(--foreground)]">Nghiệm thu Actual Cost theo DD</h3>
          <p className="text-xs text-[var(--text-secondary)]">Giá trị được tính lại phía server từ quantity × days × unitPrice; phê duyệt không tạo dòng tiền.</p>
        </div>
        <Badge tone={finance.actualCosts?.canDecide ? "info" : "neutral"}>{finance.actualCosts?.canDecide ? "AC_DD" : "Thành viên Project"}</Badge>
      </div>

      {legacyCount > 0 && <Alert tone="warning" title={`${legacyCount} khoản legacy/needsReview`}>
        Dữ liệu Expense JSON cũ chỉ để đọc và không được tự động xem là AC đã DD duyệt.
      </Alert>}

      <Alert tone="info" title="[Phát sinh ngoài IC] · Thu thêm từ khách">
        Cần ít nhất một chứng từ đã lưu trong kho AC trước khi gửi DD. Form phát sinh ngoài IC sẽ được mở ở Plan 08-03; hệ thống không tự tạo hoặc đoán mã chứng từ.
      </Alert>

      {effective ? (
        <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="projectId" value={finance.project.id} />
          <input type="hidden" name="actualCostCommand" value="CREATE_AND_SUBMIT" />
          <input type="hidden" name="sourceKind" value="IC_LINKED" />
          <input type="hidden" name="stableLineId" value={stableLineId} />
          <input type="hidden" name="revisionId" value={effective.id} />
          <Select name="icLineId" label="Dòng IC hiệu lực" value={icLineId} onChange={event => setIcLineId(event.target.value)} required className="sm:col-span-2">
            {effective.lines.map(line => <option key={line.id} value={line.id}>{line.description}</option>)}
          </Select>
          <Select name="recipientKey" label="Người nhận / NCC" required>
            <option value="">Chọn người nhận</option>
            {recipients.map(recipient => <option key={recipient.value} value={recipient.value}>{recipient.label}</option>)}
          </Select>
          <Select name="fundingSource" label="Nguồn thanh toán" defaultValue="EMPLOYEE_OUT_OF_POCKET" required>
            {FUNDING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{value} · {label}</option>)}
          </Select>
          <Input name="description" label="Nội dung thực tế" defaultValue={effective.lines.find(line => line.id === icLineId)?.description ?? ""} required className="sm:col-span-2" />
          <Input name="quantity" label="quantity · Số lượng" defaultValue="1" inputMode="decimal" required />
          <Input name="days" label="days · Số ngày" defaultValue="1" inputMode="decimal" required />
          <Input name="unitPrice" label="unitPrice · Đơn giá VND" defaultValue="0" inputMode="decimal" required />
          <div className="sm:col-span-2 lg:col-span-4">
            {state.error && <Alert tone="danger" title={state.error} />}
            {state.success && <Alert tone="success" title={state.success} />}
            <div className="mt-3 flex justify-end"><Button type="submit" size="sm" loading={pending}>Tạo và gửi DD</Button></div>
          </div>
        </form>
      ) : <Alert tone="warning" title="Chưa có IC hiệu lực">Không thể tạo AC liên kết IC cho đến khi có đúng một baseline hiệu lực.</Alert>}

      {finance.actualCosts && <ActualCostTable actualCosts={finance.actualCosts} />}

      {actualCosts.length > 0 && <div className="space-y-3 border-t border-[var(--border)] pt-4">
        {actualCosts.map(line => <div key={`${line.source}:${line.id}`} className="space-y-3 rounded-xl border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium text-[var(--foreground)]">{line.description}</p>
              <p className="text-xs text-[var(--text-secondary)]">{line.source === "legacy" ? "legacy/needsReview" : `Phiên bản ${line.version} · ${line.fundingSource}`}</p>
            </div>
            <div className="text-right"><Badge tone={line.reviewState === "approved" ? "success" : line.reviewState === "returned" ? "warning" : "neutral"}>{line.reviewState}</Badge><p className="mt-1 font-mono text-sm">{displayMoney(line.amount)}</p></div>
          </div>
          {line.source === "normalized" && <ActualCostEvidenceVault projectId={finance.project.id} line={line} />}
          {line.source === "normalized" && line.reviewState === "submitted" && finance.actualCosts?.canDecide && line.version && line.reviewToken && <ActualCostDecisionBar projectId={finance.project.id} lineId={line.id} version={line.version} reviewToken={line.reviewToken} warnings={line.missingEvidenceWarnings} />}
          {line.source === "normalized" && line.reviewState === "returned" && line.createdById === currentUserId && <ResubmitForm finance={finance} line={line} />}
        </div>)}
      </div>}
    </Panel>
  );
}
