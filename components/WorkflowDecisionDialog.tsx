"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { workflowQueueAction, type WorkflowActionState } from "@/app/actions/workflow";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Presentation";

type QueueRequest = {
  id: string;
  module: string;
  kind: string;
  projectId: string | null;
  version: number;
  financeVersion: number | null;
  currentAttemptId: string | null;
  submittedVersion: number | null;
  currentStep: number;
  currentRole: string | null;
  title: string;
};

export default function WorkflowDecisionDialog({ request }: { request: QueueRequest }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("APPROVE");
  const [corrections, setCorrections] = useState([""]);
  const trigger = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const ceoIcDecision = request.module === "COSTFLOW" && request.kind === "IC" && request.currentRole === "CEO";
  const [state, action, pending] = useActionState(async (previous: WorkflowActionState, form: FormData) => {
    const result = await workflowQueueAction(previous, form);
    if (result.success) {
      setOpen(false);
      router.refresh();
      queueMicrotask(() => trigger.current?.focus());
    }
    return result;
  }, {} as WorkflowActionState);
  const close = () => {
    setOpen(false);
    queueMicrotask(() => trigger.current?.focus());
  };
  return <>
    <Button ref={trigger} size="sm" variant="secondary" onClick={() => setOpen(true)}>Xử lý</Button>
    <Dialog open={open} onClose={close} title={`Xử lý ${request.title}`} description="Quyết định được khóa theo đúng lần trình, phiên bản và bước hiện tại.">
      <form action={action} className="space-y-4">
        <input type="hidden" name="module" value={request.module} />
        <input type="hidden" name="requestId" value={request.id} />
        <input type="hidden" name="projectId" value={request.projectId ?? ""} />
        <input type="hidden" name="version" value={request.module === "COSTFLOW" ? request.financeVersion ?? "" : request.version} />
        <input type="hidden" name="attemptId" value={request.currentAttemptId ?? ""} />
        <input type="hidden" name="submittedVersion" value={request.submittedVersion ?? ""} />
        <input type="hidden" name="stepIndex" value={request.currentStep} />
        <Select name="decision" label="Quyết định" value={decision} onChange={event => setDecision(event.target.value)}><option value="APPROVE">{request.currentRole === "ACCOUNTANT" ? "Kiểm tra đạt và chuyển bước" : "Duyệt"}</option><option value="RETURN">Trả bổ sung</option><option value="REJECT">Từ chối</option></Select>
        <Textarea name="reason" label={ceoIcDecision ? "Ghi chú của CEO (không bắt buộc)" : "Nhận xét / lý do"} hint={ceoIcDecision ? "Có thể để trống khi trả hoặc từ chối IC." : "Bắt buộc khi trả hoặc từ chối."} />
        {decision === "RETURN" && !ceoIcDecision && <fieldset className="space-y-3"><legend className="font-medium">Nội dung cần sửa</legend>{corrections.map((item,index) => <div key={index} className="flex items-end gap-2"><Textarea name="correctionItems" label={`Nội dung ${index + 1}`} value={item} onChange={event => setCorrections(values => values.map((value,i) => i === index ? event.target.value : value))} required /><Button variant="ghost" disabled={corrections.length === 1} onClick={() => setCorrections(values => values.filter((_,i) => i !== index))}>Bỏ</Button></div>)}<Button variant="secondary" onClick={() => setCorrections(values => [...values, ""])}>Thêm nội dung</Button></fieldset>}
        {ceoIcDecision && ["RETURN", "REJECT"].includes(decision) && <Alert tone="warning" title={decision === "RETURN" ? "Trả IC để sửa" : "Từ chối IC"}>{decision === "RETURN" ? "Bản đã xét được giữ nguyên; Account sửa trên revision liên kết mới và trình lại từ Quản lý. Ngân sách hiện hành không tự bị vô hiệu." : "Kết quả CEO được lưu riêng; ngân sách đã có hiệu lực không tự bị vô hiệu và không phải quyền thanh toán."}</Alert>}
        {request.currentRole === "ACCOUNTANT" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reviewConfirmed" value="yes" />Đã kiểm tra đủ thông tin, chứng từ, phiên bản và các liên kết nghiệp vụ.</label>}
        {state.error && <Alert tone="danger" title={state.error} />}
        <div className="flex justify-end border-t border-zinc-100 pt-4"><Button type="submit" loading={pending} loadingLabel="Đang lưu…">Lưu quyết định</Button></div>
      </form>
    </Dialog>
  </>;
}
