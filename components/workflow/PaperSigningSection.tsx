"use client";

import { useActionState } from "react";
import Link from "next/link";
import { workflowAction, type WorkflowActionState } from "@/app/actions/workflow";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Alert, Badge, Panel } from "@/components/ui/Presentation";

type Batch = {
  id: string; version: number; status: string; keeperDeclared: string; locationDeclared: string;
  keeperNormalized: string | null; locationNormalized: string | null; returnedReason: string | null; createdAt: string;
  files: { id: string; name: string; size: number; sha256: string }[];
  transitions: { id: string; action: string; reason: string; createdAt: string }[];
};

function PaperForm({ command, requestId, version, children, label }: { command: string; requestId: string; version: number; children: React.ReactNode; label: string }) {
  const [state, action, pending] = useActionState(workflowAction, {} as WorkflowActionState);
  return <form action={action} className="space-y-3"><input type="hidden" name="command" value={command} /><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="version" value={version} />{children}{state.error && <Alert tone="danger" title={state.error} />}{state.success && <Alert tone="success" title={state.success} />}<Button type="submit" loading={pending}>{label}</Button></form>;
}

export default function PaperSigningSection({ requestId, version, creator, manager, batches }: { requestId: string; version: number; creator: boolean; manager: boolean; batches: Batch[] }) {
  const active = batches.find(batch => ["PENDING", "RETURNED", "CONFIRMED"].includes(batch.status));
  return <Panel><div className="tf-section-heading"><div><h2>Bản ký & Lưu trữ gốc</h2><p>Batch scan bất biến; phê duyệt hồ sơ không thay đổi khi scan được tải, trả hoặc xác nhận.</p></div><Badge tone={active?.status === "CONFIRMED" ? "success" : active ? "warning" : "neutral"}>{active?.status ?? "CHO_KY"}</Badge></div>
    {creator && (!active || active.status === "RETURNED") && <PaperForm command="UPLOAD_SIGNED" requestId={requestId} version={version} label={active ? "Tải lại batch scan" : "Tải batch scan"}>
      <Input type="file" name="signedDocuments" label="Bản scan PDF/JPG/PNG" accept="application/pdf,image/jpeg,image/png" multiple required hint="Tối đa 10 file, 4 MiB/file và 20 MiB/batch." />
      <Input name="keeper" label="Người giữ bản gốc (người lập khai báo)" required />
      <Input name="location" label="Nơi lưu bản gốc (người lập khai báo)" required />
    </PaperForm>}
    {manager && active?.status === "PENDING" && <div className="mt-4 grid gap-4 md:grid-cols-2">
      <PaperForm command="RETURN_SIGNED" requestId={requestId} version={version} label="Trả batch scan"><Textarea name="reason" label="Lý do trả" required /></PaperForm>
      <PaperForm command="CONFIRM_SIGNED" requestId={requestId} version={version} label="Xác nhận batch"><input type="hidden" name="signatureConfirmed" value="yes" /><Input name="keeperNormalized" label="Người giữ bản gốc chuẩn hóa" defaultValue={active.keeperDeclared} required /><Input name="locationNormalized" label="Nơi lưu chuẩn hóa" defaultValue={active.locationDeclared} required /></PaperForm>
    </div>}
    <div className="mt-5 space-y-3">{batches.map(batch => <details key={batch.id} className="rounded border border-zinc-200 p-3"><summary className="cursor-pointer font-medium">Batch {batch.version} · {batch.status} · {new Date(batch.createdAt).toLocaleString("vi-VN")}</summary><div className="mt-3 text-sm"><p>Người giữ: {batch.keeperNormalized ?? batch.keeperDeclared}</p><p>Nơi lưu: {batch.locationNormalized ?? batch.locationDeclared}</p>{batch.returnedReason && <p>Lý do trả: {batch.returnedReason}</p>}<ul className="mt-2">{batch.files.map(file => <li key={file.id}><Link className="tf-link" href={`/api/workflow/physical-scans/${file.id}`}>{file.name}</Link> · {Math.ceil(file.size / 1024)} KiB · <code>{file.sha256.slice(0, 12)}…</code></li>)}</ul><ol className="mt-2 text-xs text-zinc-500">{batch.transitions.map(item => <li key={item.id}>{item.action} · {new Date(item.createdAt).toLocaleString("vi-VN")}{item.reason ? ` · ${item.reason}` : ""}</li>)}</ol></div></details>)}</div>
  </Panel>;
}
