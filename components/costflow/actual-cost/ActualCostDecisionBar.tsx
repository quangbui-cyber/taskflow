"use client";

import { useActionState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";
import { Input } from "@/components/ui/Field";

export default function ActualCostDecisionBar({ projectId, lineId, version, reviewToken, warnings }: { projectId: string; lineId: string; version: number; reviewToken: string; warnings: string[] }) {
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="actualCostCommand" value="DECIDE" />
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="reviewToken" value={reviewToken} />
      <p className="text-xs text-[var(--text-secondary)]">
        Chỉ một người giữ vai trò <strong>AC_DD</strong> đang hoạt động được quyết định phiên bản này.
      </p>
      <Input name="reason" label="Lý do trả lại / ghi chú duyệt" placeholder="Bắt buộc khi RETURNED" />
      {warnings.length > 0 && <label className="flex items-start gap-2 text-xs text-[var(--warning)]">
        <input type="checkbox" name="acknowledgeMissingEvidence" value="yes" />
        <span>Tôi xác nhận duyệt dù còn thiếu chứng từ: {warnings.join(" · ")}</span>
      </label>}
      {state.error && <Alert tone="danger" title={state.error} />}
      {state.success && <Alert tone="success" title={state.success} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" name="decision" value="RETURNED" variant="secondary" size="sm" loading={pending}>
          RETURNED · Trả lại
        </Button>
        <Button type="submit" name="decision" value="APPROVED" size="sm" loading={pending}>
          APPROVED · DD duyệt
        </Button>
      </div>
    </form>
  );
}
