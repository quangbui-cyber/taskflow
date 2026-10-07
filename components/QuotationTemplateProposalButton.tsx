"use client";

import { useActionState, useState } from "react";
import { proposeQuotationTemplateAction } from "@/app/actions/quotationTemplates";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Presentation";
import { Dialog } from "@/components/ui/Dialog";

export default function QuotationTemplateProposalButton({ projectId, quotationId, quotationTitle }: { projectId: string; quotationId: string; quotationTitle: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(proposeQuotationTemplateAction, {});
  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Đề xuất làm template</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Đề xuất template báo giá" description="Admin sẽ duyệt đúng snapshot của bản báo giá đã chốt này.">
      <form action={action} className="space-y-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="quotationId" value={quotationId} />
        <Input label="Tên template đề xuất" name="proposedName" defaultValue={quotationTitle} required maxLength={200} />
        <Textarea label="Ghi chú cho Admin" name="note" rows={3} maxLength={2000} />
        {state.error && <Alert tone="danger" title={state.error} />}
        {state.success && <Alert tone="success" title={state.success} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Đóng</Button><Button type="submit" loading={pending} loadingLabel="Đang gửi…">Gửi đề xuất</Button></div>
      </form>
    </Dialog>
  </>;
}
