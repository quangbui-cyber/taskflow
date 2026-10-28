"use client";

import { useState } from "react";
import { getDocumentIntakeDraft } from "@/app/actions/ai/review";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Presentation";

export type AiReceiptView = {
  id: string; runId: string; targetKind: string; targetId: string;
  targetVersionBefore: string; targetVersionAfter: string; actorId: string;
  createdAt: Date | string; fieldDecisions: unknown;
};

export default function AiApplicationReceiptView({ receipt, projectId }: { receipt: AiReceiptView; projectId: string }) {
  const [draft, setDraft] = useState<Awaited<ReturnType<typeof getDocumentIntakeDraft>> | null>(null);
  const [error, setError] = useState("");
  const details = receipt.fieldDecisions && typeof receipt.fieldDecisions === "object" && !Array.isArray(receipt.fieldDecisions)
    ? receipt.fieldDecisions as { fields?: unknown } : {};
  const fields = Array.isArray(details.fields) ? details.fields as Record<string, unknown>[] : [];
  return <Panel className="min-w-0 space-y-3" aria-label="Phiếu áp dụng AI">
    <h2 className="tf-ui-heading">Phiếu áp dụng · Chỉ đọc</h2>
    <p className="break-all text-sm">Run {receipt.runId} · {receipt.targetKind} {receipt.targetId}</p>
    <p className="text-sm">Bản nháp trước: v{receipt.targetVersionBefore} · sau: v{receipt.targetVersionAfter}</p>
    <p className="text-sm">Người thực hiện: {receipt.actorId} · {new Date(receipt.createdAt).toLocaleString("vi-VN")}</p>
    <div className="space-y-2">{fields.map((field, index) => <div key={index} className="min-w-0 break-words rounded border p-2 text-sm">
      <strong>{String(field.fieldKey ?? field.candidateFieldId ?? index)}</strong> · {field.decision === "APPLY_REVIEWED" ? "Áp dụng giá trị đã rà soát" : "Giữ giá trị hiện có"}<br />
      Trước: {String(field.currentValue ?? "—")} · Sau: {String(field.finalValue ?? "—")}
    </div>)}</div>
    {receipt.targetKind === "IC" ? <a href={`/projects/${projectId}/costflow`} className="underline">Mở bản nháp IC</a> :
      <Button variant="secondary" size="sm" onClick={async () => {
        try { setDraft(await getDocumentIntakeDraft({ projectId, draftId: receipt.targetId })); setError(""); }
        catch { setDraft(null); setError("Không thể mở bản nháp này với quyền hiện tại."); }
      }}>Mở bản nháp</Button>}
    {error && <p role="alert" className="tf-ui-error">{error}</p>}
    {draft && <div className="min-w-0 rounded border p-3 text-sm"><h3 className="font-semibold">Bản nháp {draft.kind} hiện tại · v{draft.version}</h3>
      <dl>{Object.entries(draft.fields as Record<string, string | null>).map(([key, value]) => <div key={key} className="break-words py-1">
        <dt className="font-medium">{key}</dt><dd>{value ?? "—"}</dd></div>)}</dl>
    </div>}
  </Panel>;
}
