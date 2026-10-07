"use client";

import { useActionState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { costFlowAction, type CostFlowActionState } from "@/app/actions/costflow";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Presentation";

export default function CostFlowActionForm({ finance, command, requestId, request, children, label = "Lưu", danger = false, onSuccess, showSubmit = true, onSubmit }: {
  finance: { project: { id: string }; version: number }; command: string; requestId?: string; request?: { module: string; currentAttemptId: string | null; currentStep: number; approvalEvents?: { action: string; attemptId: string | null; submittedVersion: number | null }[] }; children?: ReactNode; label?: string; danger?: boolean; onSuccess?: (result: CostFlowActionState) => void; showSubmit?: boolean; onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(async (previous: CostFlowActionState, form: FormData) => {
    const result = await costFlowAction(previous, form);
    if (result.success) { router.refresh(); onSuccess?.(result); }
    return result;
  }, {});
  return <form action={action} onSubmit={onSubmit} className="space-y-4">
    <input type="hidden" name="projectId" value={finance.project.id} /><input type="hidden" name="version" value={finance.version} /><input type="hidden" name="command" value={command} />
    {requestId && <input type="hidden" name="requestId" value={requestId} />}
    {request && <><input type="hidden" name="module" value={request.module} /><input type="hidden" name="attemptId" value={request.currentAttemptId ?? ""} /><input type="hidden" name="stepIndex" value={request.currentStep} /><input type="hidden" name="submittedVersion" value={request.approvalEvents?.find(event => event.action === "SUBMIT" && event.attemptId === request.currentAttemptId)?.submittedVersion ?? ""} /></>}
    {children}
    {state.lineErrors?.length ? <ul role="alert">{state.lineErrors.map(e=><li key={e.lineId}><a className="tf-link" href={`#ic-line-${e.lineId}`} onClick={()=>document.getElementById(`ic-line-${e.lineId}`)?.focus()}>{e.message}</a></li>)}</ul> : null}
    {state.error && <Alert tone="danger" title={state.error} />}{state.success && <Alert tone="success" title={state.success} />}
    {showSubmit && <div className="flex justify-end border-t border-zinc-100 pt-4"><Button type="submit" variant={danger ? "danger" : "primary"} loading={pending} loadingLabel="Đang lưu…">{label}</Button></div>}
  </form>;
}
