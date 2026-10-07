"use client";
import { useState } from "react";
import type { Finance } from "./CostFlowPanel";
import type { IcLine } from "@/lib/costflow/types";
import { costFlowAction } from "@/app/actions/costflow";
import { useRouter } from "next/navigation";
import IcEvidencePanel from "./IcEvidencePanel";
import { Button } from "./ui/Button";
import { Alert } from "./ui/Presentation";

export default function IcRequestEvidence({ finance, request, canSupplement }: { finance: Finance; request: Finance["requests"][number]; canSupplement: boolean }) {
  const router = useRouter(); const [line, setLine] = useState<IcLine | null>(null); const [ids,setIds]=useState<string[]>([]); const [reason,setReason]=useState(""); const [files,setFiles]=useState(finance.evidence); const [operation,setOperation]=useState(""); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  const [viewOnly,setViewOnly]=useState(true);
  const events = finance.supplements?.filter(s=>s.requestId===request.id) ?? [];
  return <div className="space-y-3"><h4>Minh chứng theo bản IC</h4>{request.payload.lines?.map(l=><div key={l.id} id={`ic-line-${l.id}`} tabIndex={-1} className="tf-evidence-line"><strong>{l.description}</strong><p>{l.evidenceIds?.length ? "Có minh chứng gốc" : l.evidenceReason?.trim() ? `Lý do gốc: ${l.evidenceReason}` : "Bản cũ chưa ghi minh chứng/lý do theo dòng"}</p>{l.evidenceIds?.map(id=><p key={id}><a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${id}`}>{files.find(f=>f.id===id)?.name ?? "Minh chứng gốc"}</a></p>)}{events.filter(s=>s.lineId===l.id).map(event=><div key={event.operationId}><p>Bổ sung · {finance.users.find(u=>u.id===event.actorId)?.name ?? "Người lập"} · {new Date(event.createdAt).toLocaleString("vi-VN")} · bản {event.requestVersion}</p><p>{event.reason}</p>{event.evidenceIds.map(id=><p key={id}><a className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${id}`}>{files.find(f=>f.id===id)?.name ?? "Minh chứng bổ sung"}</a></p>)}</div>)}<Button variant="ghost" onClick={()=>{setViewOnly(true);setLine(l);setIds(l.evidenceIds ?? []);setReason(l.evidenceReason ?? "");}}>Xem minh chứng gốc</Button>{canSupplement && request.state!=="DRAFT" && <Button variant="secondary" onClick={()=>{setViewOnly(false);setLine(l);setIds([]);setReason("");setOperation(crypto.randomUUID());setMessage("");}}>Bổ sung minh chứng</Button>}</div>)}
    <IcEvidencePanel finance={finance} readOnly={viewOnly} open={!!line} onClose={()=>setLine(null)} targets={line ? [line.description] : []} ids={ids} reason={reason} files={files} onFiles={f=>setFiles(current=>[...current,f])} onChange={(next,value)=>{setIds(next);setReason(value);}} footer={line && !viewOnly ? <Button disabled={busy} onClick={async()=>{setBusy(true);const form=new FormData();for(const [key,value] of Object.entries({projectId:finance.project.id,version:String(finance.version),command:"SUPPLEMENT_IC_EVIDENCE",requestId:request.id,requestVersion:String(request.version),lineId:line.id,operationId:operation,evidenceIds:JSON.stringify(ids),reason}))form.set(key,value);const result=await costFlowAction({},form);setBusy(false);setMessage(result.error??result.success??"");if(result.success){setLine(null);router.refresh();}}}>Lưu bổ sung riêng</Button> : undefined} />
{message && <Alert title={message} />}
  </div>;
}
