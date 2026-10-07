"use client";

import { useActionState } from "react";
import { quotationTemplateAdminAction, type QuotationTemplateActionState } from "@/app/actions/quotationTemplates";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Alert, Badge, EmptyState, Panel } from "@/components/ui/Presentation";

type Proposal = { id: string; proposedName: string; note: string; status: string; proposedByName: string; createdAt: string; rejectionReason: string | null };
type Template = { id: string; name: string; description: string; status: string; createdByName: string; createdAt: string; archivedAt: string | null };

function AdminForm({ children, command, proposalId, templateId, reason = false }: { children: React.ReactNode; command: string; proposalId?: string; templateId?: string; reason?: boolean }) {
  const [state, action, pending] = useActionState<QuotationTemplateActionState, FormData>(quotationTemplateAdminAction, {});
  return <form action={action} className="space-y-2">
    <input type="hidden" name="command" value={command} />
    {proposalId && <input type="hidden" name="proposalId" value={proposalId} />}
    {templateId && <input type="hidden" name="templateId" value={templateId} />}
    {reason && <Input label="Lý do từ chối" name="reason" required maxLength={2000} />}
    {state.error && <Alert tone="danger" title={state.error} />}{state.success && <Alert tone="success" title={state.success} />}
    <Button type="submit" size="sm" variant={command === "REJECT" || command === "ARCHIVE" ? "danger" : "secondary"} loading={pending}>{children}</Button>
  </form>;
}

export default function QuotationTemplateAdmin({ proposals, templates }: { proposals: Proposal[]; templates: Template[] }) {
  return <div className="space-y-6">
    <Panel><h2 className="text-lg font-semibold">Đề xuất đang chờ</h2><p className="tf-ui-help mt-1">Duyệt sẽ tạo một template snapshot độc lập; nội dung không sửa đè về sau.</p>
      {proposals.filter(item => item.status === "PENDING").length ? <div className="tf-quotation-template-admin-list">{proposals.filter(item => item.status === "PENDING").map(item => <article key={item.id}><div><h3>{item.proposedName}</h3><p className="tf-ui-help">{item.proposedByName} · {new Intl.DateTimeFormat("vi-VN").format(new Date(item.createdAt))}</p>{item.note && <p>{item.note}</p>}</div><div className="tf-quotation-template-admin-actions"><AdminForm command="APPROVE" proposalId={item.id}>Công bố</AdminForm><AdminForm command="REJECT" proposalId={item.id} reason>Từ chối</AdminForm></div></article>)}</div> : <EmptyState title="Không có đề xuất đang chờ" />}
    </Panel>
    <Panel><h2 className="text-lg font-semibold">Template báo giá</h2><p className="tf-ui-help mt-1">Template đã lưu trữ không xuất hiện khi Account tạo báo giá mới.</p>
      {templates.length ? <div className="tf-quotation-template-admin-list">{templates.map(item => <article key={item.id}><div><div className="flex flex-wrap items-center gap-2"><h3>{item.name}</h3><Badge tone={item.status === "ACTIVE" ? "success" : "neutral"}>{item.status === "ACTIVE" ? "Đang hoạt động" : "Đã lưu trữ"}</Badge></div><p className="tf-ui-help">{item.createdByName} · {new Intl.DateTimeFormat("vi-VN").format(new Date(item.createdAt))}</p>{item.description && <p>{item.description}</p>}</div><AdminForm command={item.status === "ACTIVE" ? "ARCHIVE" : "RESTORE"} templateId={item.id}>{item.status === "ACTIVE" ? "Lưu trữ" : "Khôi phục"}</AdminForm></article>)}</div> : <EmptyState title="Chưa có template báo giá" description="Duyệt một đề xuất để công bố template đầu tiên." />}
    </Panel>
  </div>;
}
