"use client";

import { useRef, useState } from "react";
import { applyAiReviewToDraft, prepareAiApplyConflicts } from "@/app/actions/ai/review";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, Panel } from "@/components/ui/Presentation";
import type { AiReceiptView } from "./AiApplicationReceiptView";

export type ConflictSnapshot = Awaited<ReturnType<typeof import("@/app/actions/ai/review").prepareAiApplyConflicts>>;

export default function AiApplyConflictReview({ projectId, runId, kind, draftId, snapshot, onReceipt, onBack }: {
  projectId: string; runId: string; kind: "PO" | "VAT" | "IC"; draftId: string;
  snapshot: ConflictSnapshot; onReceipt: (receipt: AiReceiptView) => void; onBack: () => void;
}) {
  const [decisions, setDecisions] = useState<Record<string, "KEEP_CURRENT" | "APPLY_REVIEWED">>({});
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const applyKey = useRef(crypto.randomUUID());
  const applied = snapshot.fields.filter((field) => decisions[field.candidateFieldId] === "APPLY_REVIEWED").length;
  async function apply() {
    if (pending || applied === 0) return;
    setPending(true); setError("");
    try {
      const fresh = await prepareAiApplyConflicts({ projectId, runId, kind, draftId });
      if (fresh.targetVersion !== snapshot.targetVersion || fresh.fields.length !== snapshot.fields.length ||
        fresh.fields.some((field, index) => field.candidateFieldId !== snapshot.fields[index].candidateFieldId ||
          field.currentValue !== snapshot.fields[index].currentValue || field.reviewedValue !== snapshot.fields[index].reviewedValue)) {
        throw new Error("Bản nháp đã đổi. Quay lại rà soát và tải lại xung đột trước khi áp dụng.");
      }
      const receipt = await applyAiReviewToDraft({ projectId, runId, kind, draftId,
        expectedVersion: snapshot.targetVersion, idempotencyKey: applyKey.current,
        decisions: snapshot.fields.map((field) => ({ candidateFieldId: field.candidateFieldId,
          decision: decisions[field.candidateFieldId] ?? "KEEP_CURRENT" })) });
      setConfirm(false); onReceipt(receipt);
    } catch (cause) {
      setConfirm(false);
      setError(cause instanceof Error ? cause.message : "Bản nháp đã đổi. Tải lại xung đột trước khi áp dụng.");
    } finally { setPending(false); }
  }
  return <section className="space-y-4" aria-label="So sánh trước khi áp dụng">
    <Panel className="min-w-0 space-y-3"><h2 className="tf-ui-heading">So sánh với bản nháp v{snapshot.targetVersion}</h2>
      <p className="tf-ui-help">{applied} áp dụng · {snapshot.fields.length - applied} giữ nguyên · 0 bị khóa. Chưa có thay đổi nào được ghi vào bản nháp.</p>
      {error && <Alert tone="danger" title="Không thể áp dụng">{error}</Alert>}
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">{snapshot.fields.map((field) => <fieldset key={field.candidateFieldId} className="min-w-0 rounded border p-3">
        <legend className="font-semibold">{field.rowKey && field.rowKey !== "document" ? `${field.rowKey} · ` : ""}{field.fieldKey}</legend>
        <p className="break-words text-sm">Giá trị hiện có trong bản nháp: {field.currentValue ?? "—"}</p>
        <p className="break-words text-sm">Giá trị đã rà soát: {field.reviewedValue ?? "—"}</p>
        <label className="mt-2 flex gap-2"><input type="radio" name={`decision-${field.candidateFieldId}`}
          checked={(decisions[field.candidateFieldId] ?? "KEEP_CURRENT") === "KEEP_CURRENT"}
          onChange={() => setDecisions((current) => ({ ...current, [field.candidateFieldId]: "KEEP_CURRENT" }))} />Giữ giá trị hiện có</label>
        <label className="mt-1 flex gap-2"><input type="radio" name={`decision-${field.candidateFieldId}`}
          disabled={field.reviewedValue === null}
          checked={decisions[field.candidateFieldId] === "APPLY_REVIEWED"}
          onChange={() => setDecisions((current) => ({ ...current, [field.candidateFieldId]: "APPLY_REVIEWED" }))} />Áp dụng giá trị đã rà soát</label>
      </fieldset>)}</div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onBack}>Quay lại rà soát</Button>
        <Button variant="primary" disabled={applied === 0} onClick={() => setConfirm(true)}>Áp dụng vào bản nháp</Button></div>
    </Panel>
    <Dialog open={confirm} onClose={() => setConfirm(false)} title="Xác nhận áp dụng vào bản nháp"
      description={`Bạn sắp áp dụng ${applied} thay đổi từ Run ${runId.slice(0, 10)} vào bản nháp ${draftId} v${snapshot.targetVersion}. Thao tác này không gửi duyệt và không có hoàn tác tự động. Bạn có thể tiếp tục chỉnh bằng cơ chế nháp/revision hiện hành.`}
      footer={<><Button variant="secondary" onClick={() => setConfirm(false)}>Quay lại rà soát</Button>
        <Button variant="primary" disabled={pending} loading={pending} loadingLabel="Đang áp dụng vào bản nháp…" onClick={apply}>Áp dụng {applied} thay đổi</Button></>}>
      <p>Chỉ các trường đã chọn “Áp dụng giá trị đã rà soát” mới được ghi.</p>
    </Dialog>
  </section>;
}
