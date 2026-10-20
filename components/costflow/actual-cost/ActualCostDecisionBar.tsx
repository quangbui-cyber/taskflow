"use client";

import { useActionState } from "react";
import { actualCostAction, type ActualCostActionState } from "@/app/actions/costflow";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";
import { Input } from "@/components/ui/Field";

export default function ActualCostDecisionBar({ projectId, revisionId, mutationVersion, manifestHash, version, warnings = [] }: { projectId: string; revisionId: string; mutationVersion: number; manifestHash: string; version: number; warnings?: string[] }) {
  const [state, action, pending] = useActionState(actualCostAction, {} as ActualCostActionState);
  return (
    <form action={action} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="actualCostCommand" value="DECIDE_SHEET" />
      <input type="hidden" name="sheetRevisionId" value={revisionId} />
      <input type="hidden" name="sheetMutationVersion" value={mutationVersion} />
      <input type="hidden" name="manifestHash" value={manifestHash} />
      <input type="hidden" name="version" value={version} />
      <p className="text-xs text-[var(--text-secondary)]">
        Chỉ Phó Giám đốc được duyệt hoặc trả lại toàn bộ phiên bản Bảng AC này.
      </p>
      <Input name="reason" label="Lý do trả lại / ghi chú duyệt" placeholder="Bắt buộc khi trả lại" />
      {warnings.length > 0 && <label className="flex items-start gap-2 rounded-lg border border-[var(--warning)] bg-[var(--warning-soft)] p-2 text-xs text-[var(--foreground)]">
        <input type="checkbox" name="acknowledgeMissingEvidence" value="yes" className="mt-0.5" />
        <span>Tôi đã đọc các lưu ý và xác nhận duyệt Bảng AC dù còn thiếu chứng từ: {warnings.join(" · ")}</span>
      </label>}
      {state.error && <Alert tone="danger" title={state.error} />}
      {state.success && <Alert tone="success" title={state.success} />}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="submit" name="decision" value="RETURNED" variant="secondary" size="sm" loading={pending} onClick={event => { if (!window.confirm("Bạn có chắc chắn muốn trả lại toàn bộ Bảng AC này? Lý do trả lại là bắt buộc.")) { event.preventDefault(); } }}>
          Trả lại toàn bộ Bảng AC
        </Button>
        <Button type="submit" name="decision" value="APPROVED" size="sm" loading={pending}>
          Duyệt toàn bộ Bảng AC
        </Button>
      </div>
    </form>
  );
}
