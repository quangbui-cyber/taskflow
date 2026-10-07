"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input, Select } from "@/components/ui/Field";
import ActionForm from "@/components/CostFlowActionForm";
import type { Finance } from "@/components/CostFlowPanel";
import type { IcLine, IcRevision } from "@/lib/costflow/types";
import { resolveIcLineOrigin } from "@/lib/costflow/budgetLineage";

export function IcLineProvenance({ finance, line }: { finance: Finance; line: IcLine }) {
  return <details><summary>Nguồn dòng</summary>{line.originLines?.length ? line.originLines.map(ref => <p key={`${ref.revisionId}:${ref.lineId}`}>IC r{finance.data.revisions.find(r => r.id === ref.revisionId)?.number} · {resolveIcLineOrigin(finance.data, ref.revisionId, ref.lineId)?.description ?? "Dòng cũ"} · {ref.lineId}</p>) : <p>Dòng gốc · {line.id}</p>}</details>;
}

export default function IcLineTransform({ finance, revision }: { finance: Finance; revision: IcRevision }) {
  const [mode, setMode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const blank = (): Partial<IcLine> => ({ description: "", unit: "", quantity: "", unitPrice: "", vatPercent: "", basis: "NET" });
  const [outputs, setOutputs] = useState<Partial<IcLine>[]>([]);
  const open = (value: string) => { setMode(value); setSelected([]); setOutputs(value === "SPLIT_IC_LINE" ? [blank(), blank()] : [blank()]); };
  return <><div className="flex gap-2 mt-4"><Button variant="secondary" size="sm" onClick={() => open("SPLIT_IC_LINE")}>Tách dòng IC</Button><Button variant="secondary" size="sm" onClick={() => open("MERGE_IC_LINES")}>Gộp dòng IC</Button></div><Dialog open={!!mode} onClose={() => setMode("")} title={mode === "SPLIT_IC_LINE" ? "Tách dòng IC" : "Gộp dòng IC"} description="Dòng mới có mã riêng. AC, tiền và chứng từ cũ vẫn thuộc dòng gốc. Nhập rõ số lượng/giá; không tự phân bổ."><ActionForm finance={finance} requestId={revision.requestId} command={mode} label="Xác nhận dòng kết quả" onSuccess={() => setMode("")}><fieldset><legend>Chọn dòng nguồn</legend>{revision.lines.map(line => <label className="tf-source-option" key={line.id}><input type="checkbox" name="lineIds" value={line.id} checked={selected.includes(line.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, line.id] : ids.filter(id => id !== line.id))} />{line.description}</label>)}</fieldset><input type="hidden" name="lines" value={JSON.stringify(outputs)} />{outputs.map((row, index) => <fieldset key={index}><legend>Dòng kết quả {index + 1}</legend>{[["description", "Nội dung"], ["unit", "Đơn vị"], ["quantity", "Số lượng"], ["unitPrice", "Giá vốn"], ["vatPercent", "VAT"]].map(([key, label]) => <Input key={key} label={`${label} kết quả ${index + 1}`} value={String(row[key as keyof IcLine] ?? "")} required={key === "description"} onChange={e => setOutputs(rows => rows.map((r, i) => i === index ? { ...r, [key]: e.target.value } : r))} />)}<Select label={`Giá nhập kết quả ${index + 1}`} value={row.basis} onChange={e => setOutputs(rows => rows.map((r, i) => i === index ? { ...r, basis: e.target.value as "NET" | "GROSS" } : r))}><option value="NET">Net</option><option value="GROSS">Gross</option></Select></fieldset>)}</ActionForm></Dialog></>;
}
