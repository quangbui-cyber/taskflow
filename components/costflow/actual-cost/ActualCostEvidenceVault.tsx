"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Finance } from "@/components/CostFlowPanel";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { Alert, Badge } from "@/components/ui/Presentation";
import { formatProjectFileSize } from "@/lib/projectFiles";

const EVIDENCE_KINDS = [
  ["VENDOR_CONTRACT_PO", "Hợp đồng / PO nhà cung cấp"],
  ["ACCEPTANCE_HANDOVER", "Biên bản nghiệm thu / bàn giao"],
  ["VAT_INVOICE", "Hóa đơn VAT"],
  ["PAYMENT_PROOF", "Chứng từ thanh toán"],
  ["FIELD_PHOTO_REPORT", "Ảnh hiện trường / báo cáo"],
] as const;

const KIND_LABELS: Record<string, string> = Object.fromEntries(EVIDENCE_KINDS);

type Line = NonNullable<Finance["actualCosts"]>["lines"][number];

export default function ActualCostEvidenceVault({ projectId, line }: { projectId: string; line: Line }) {
  const router = useRouter();
  const [kind, setKind] = useState(EVIDENCE_KINDS[0][0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function upload(files: FileList | null) {
    if (!files?.length || !line.version) return;
    setBusy(true);
    setMessage("");
    const form = new FormData();
    form.set("lineId", line.id);
    form.set("version", String(line.version));
    form.set("kind", kind);
    for (const file of Array.from(files)) form.append("proof", file);
    const response = await fetch(`/api/projects/${projectId}/costflow/evidence/upload`, { method: "POST", body: form });
    const result = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) setMessage(result.error ?? "Chưa tải được chứng từ.");
    else {
      setMessage("Đã tạo phiên bản manifest mới; bản đã xem trước đó vẫn bất biến.");
      router.refresh();
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-[var(--foreground)]">Evidence Vault · phiên bản {line.version}</p>
          <p className="text-xs text-[var(--text-secondary)]">Nhiều file, tối đa 4 MiB/file. File mới tạo phiên bản manifest mới.</p>
        </div>
        <Badge tone={line.missingEvidenceWarnings.length ? "warning" : "success"}>{line.missingEvidenceWarnings.length ? `${line.missingEvidenceWarnings.length} cảnh báo thiếu` : "Đủ chứng từ cốt lõi"}</Badge>
      </div>
      {line.missingEvidenceWarnings.length > 0 && <Alert tone="warning" title="Thiếu chứng từ vẫn đang hiển thị">
        {line.missingEvidenceWarnings.join(" · ")}{line.acknowledgedWarningCodes.length ? ` · DD đã xác nhận: ${line.acknowledgedWarningCodes.join(", ")}` : ""}
      </Alert>}
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Select label="Loại chứng từ" value={kind} onChange={event => setKind(event.target.value as typeof kind)} disabled={busy}>
          {EVIDENCE_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <label className="block text-xs font-medium text-[var(--text-secondary)]">
          Tệp chứng từ
          <input className="mt-1 block w-full text-xs file:mr-2 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--surface)] file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-[var(--foreground)] hover:file:bg-[var(--surface-muted)] cursor-pointer" type="file" multiple disabled={busy} onChange={event => { void upload(event.target.files); event.target.value = ""; }} />
        </label>
      </div>
      {message && <Alert tone={message.startsWith("Đã") ? "success" : "danger"} title={message} />}
      <div className="space-y-2">
        {line.evidence.map(item => {
          const canPreview = item.mimeType === "application/pdf" || item.mimeType.startsWith("image/");
          return <div key={`${item.id}:${item.kind}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
            <div className="min-w-0">
              <p className="font-medium text-[var(--foreground)]">{KIND_LABELS[item.kind] ?? item.kind} · {item.name}</p>
              <p className="text-[var(--text-secondary)]">{formatProjectFileSize(item.size)} · sha256 {item.sha256.slice(0, 12)}… · {item.createdByName} · {new Date(item.createdAt).toLocaleString("vi-VN")}</p>
            </div>
            <div className="flex gap-2">
              {canPreview && <a className="tf-button-secondary tf-button-size-sm" target="_blank" rel="noreferrer" href={`/api/projects/${projectId}/costflow/evidence/${item.id}/preview`}>Xem trước</a>}
              <a className="tf-button-secondary tf-button-size-sm" href={`/api/projects/${projectId}/costflow/evidence/${item.id}`}>Tải xuống</a>
            </div>
          </div>;
        })}
      </div>
      {busy && <Button type="button" size="sm" loading disabled>Đang lưu chứng từ</Button>}
    </div>
  );
}
