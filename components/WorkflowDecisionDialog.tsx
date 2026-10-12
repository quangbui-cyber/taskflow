"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PenTool, ShieldCheck } from "lucide-react";
import { workflowQueueAction, type WorkflowActionState } from "@/app/actions/workflow";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Select, Textarea } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Presentation";
import { SignaturePad } from "@/components/SignaturePad";

type QueueRequest = {
  id: string;
  module: string;
  kind: string;
  projectId: string | null;
  version: number;
  financeVersion: number | null;
  signingMode: string | null;
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
  const [sigPadOpen, setSigPadOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signaturePin, setSignaturePin] = useState<string>("");
  const trigger = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const ceoIcDecision = request.module === "COSTFLOW" && request.kind === "IC" && request.currentRole === "CEO";
  const requiresSignature = request.signingMode !== "PHYSICAL" && ["ADVANCE", "VENDOR_PAYMENT", "REIMBURSEMENT", "PROPOSAL", "PROPOSAL_ADVANCE", "PROPOSAL_ADVANCE_SETTLEMENT", "SERVICE_CONTRACT"].includes(request.kind);
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

  return (
    <>
      <Button ref={trigger} size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Xử lý
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Xử lý ${request.title}`}
        description="Quyết định được khóa theo đúng lần trình, phiên bản và bước hiện tại."
      >
        <form action={action} className="space-y-4">
          <input type="hidden" name="module" value={request.module} />
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="projectId" value={request.projectId ?? ""} />
          <input
            type="hidden"
            name="version"
            value={request.module === "COSTFLOW" ? request.financeVersion ?? "" : request.version}
          />
          <input type="hidden" name="attemptId" value={request.currentAttemptId ?? ""} />
          <input type="hidden" name="submittedVersion" value={request.submittedVersion ?? ""} />
          <input type="hidden" name="stepIndex" value={request.currentStep} />

          <Select
            name="decision"
            label="Quyết định"
            value={decision}
            onChange={event => setDecision(event.target.value)}
          >
            <option value="APPROVE">
              {request.currentRole === "ACCOUNTANT" ? "Kiểm tra đạt và chuyển bước" : "Duyệt"}
            </option>
            <option value="RETURN">Trả bổ sung</option>
            <option value="REJECT">Từ chối</option>
          </Select>

          <Textarea
            name="reason"
            label={ceoIcDecision ? "Ghi chú của CEO (không bắt buộc)" : "Nhận xét / lý do"}
            hint={ceoIcDecision ? "Có thể để trống khi trả hoặc từ chối IC." : "Bắt buộc khi trả hoặc từ chối."}
          />

          {requiresSignature && decision === "APPROVE" && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                  <PenTool size={14} className="text-brand-600" />
                  Ký duyệt số (E-Sign & Mã PIN 6 số)
                </span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: signatureData ? "var(--success-soft)" : "var(--warning-soft)",
                    color: signatureData ? "var(--success)" : "var(--warning)",
                  }}
                >
                  {signatureData ? "Đã ký số" : "Chưa ký"}
                </span>
              </div>

              {signatureData ? (
                <div
                  className="flex items-center justify-between gap-3 p-2.5 rounded-lg border"
                  style={{
                    backgroundColor: "var(--success-soft)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-14 h-9 bg-white rounded border border-[var(--border)] flex items-center justify-center p-0.5 shadow-xs">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={signatureData} alt="Chữ ký phê duyệt" className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="text-xs">
                      <p className="font-semibold text-[var(--foreground)]">Chữ ký số đã sẵn sàng</p>
                      <p className="text-xs text-[var(--success)] flex items-center gap-1">
                        <ShieldCheck size={12} />
                        PIN 6 số đã sẵn sàng để máy chủ xác thực
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSigPadOpen(true)}
                    className="text-xs"
                  >
                    Ký lại
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    Hình ảnh chữ ký nội bộ được gắn vào đúng phiên bản hồ sơ sau khi máy chủ xác thực mã PIN 6 số. Đây không phải chữ ký số CA.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setSigPadOpen(true)}
                    className="text-xs"
                  >
                    <PenTool size={13} className="mr-1" />
                    Ký số điện tử & Xác nhận PIN
                  </Button>
                </div>
              )}

              <input type="hidden" name="signatureData" value={signatureData || ""} />
              <input type="hidden" name="signaturePin" value={signaturePin || ""} />
            </div>
          )}

          {decision === "RETURN" && !ceoIcDecision && (
            <fieldset className="space-y-3">
              <legend className="font-medium">Nội dung cần sửa</legend>
              {corrections.map((item, index) => (
                <div key={index} className="flex items-end gap-2">
                  <Textarea
                    name="correctionItems"
                    label={`Nội dung ${index + 1}`}
                    value={item}
                    onChange={event =>
                      setCorrections(values => values.map((value, i) => (i === index ? event.target.value : value)))
                    }
                    required
                  />
                  <Button
                    variant="ghost"
                    disabled={corrections.length === 1}
                    onClick={() => setCorrections(values => values.filter((_, i) => i !== index))}
                  >
                    Bỏ
                  </Button>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setCorrections(values => [...values, ""])}>
                Thêm nội dung
              </Button>
            </fieldset>
          )}

          {ceoIcDecision && ["RETURN", "REJECT"].includes(decision) && (
            <Alert tone="warning" title={decision === "RETURN" ? "Trả IC để sửa" : "Từ chối IC"}>
              {decision === "RETURN"
                ? "Bản đã xét được giữ nguyên; Account sửa trên revision liên kết mới và trình lại từ Quản lý. Ngân sách hiện hành không tự bị vô hiệu."
                : "Kết quả CEO được lưu riêng; ngân sách đã có hiệu lực không tự bị vô hiệu và không phải quyền thanh toán."}
            </Alert>
          )}

          {request.currentRole === "ACCOUNTANT" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="reviewConfirmed" value="yes" />
              Đã kiểm tra đủ thông tin, chứng từ, phiên bản và các liên kết nghiệp vụ.
            </label>
          )}

          {state.error && <Alert tone="danger" title={state.error} />}

          <div className="flex justify-end border-t border-zinc-100 pt-4">
            <Button type="submit" loading={pending} loadingLabel="Đang lưu…" disabled={requiresSignature && decision === "APPROVE" && !signatureData}>
              Lưu quyết định
            </Button>
          </div>
        </form>
      </Dialog>

      {sigPadOpen && (
        <SignaturePad
          open={sigPadOpen}
          onClose={() => setSigPadOpen(false)}
          onConfirm={(dataUrl, pin) => {
            setSignatureData(dataUrl);
            setSignaturePin(pin ?? "");
            setSigPadOpen(false);
          }}
          userName="Người phê duyệt"
          userRoleTitle={request.currentRole ?? "Người phê duyệt"}
          title={`Ký duyệt — ${request.title}`}
        />
      )}
    </>
  );
}
