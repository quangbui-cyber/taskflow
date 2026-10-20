"use client";
import Link from "next/link";
import { useState } from "react";
import type { Finance } from "@/components/CostFlowPanel";
import ActionForm from "@/components/CostFlowActionForm";
import { Input, Select } from "@/components/ui/Field";
import { Table } from "@/components/ui/Presentation";
import { displayMoney, decimal, round, sum } from "@/lib/costflow/money";
import { currentPurchaseOrders } from "@/lib/costflow/budgetSources";

export default function PurchaseOrderVersions({ finance, canCreate }: { finance: Finance; canCreate: boolean }) {
  const [intent, setIntent] = useState("ADD_PO");
  const [parentId, setParentId] = useState("");
  const current = currentPurchaseOrders(finance.data.pos);
  return <details className="mt-4"><summary>Đầu vào Brief / PO và lịch sử nguồn</summary><p>Tổng PO hiện tại: {displayMoney(round(sum(current.map(po => decimal(po.net)))))}</p><Table caption="Các phiên bản nguồn PO" hideCaption><thead><tr><th scope="col">PO / phiên bản</th><th scope="col">Giá trị net VND</th><th scope="col">Nguồn</th><th scope="col">Quan hệ</th></tr></thead><tbody>{finance.data.pos.map(po => <tr key={po.id}><td>{po.number} · v{po.version ?? 1} · {current.some(p => p.id === po.id) ? "Hiện tại" : "Đã có bản mới"}</td><td>{displayMoney(po.net)}</td><td><Link className="tf-link" href={`/api/projects/${finance.project.id}/costflow/evidence/${po.sourceId}`}>Xem nguồn gốc</Link></td><td>{po.parentPoId ? "Phiên bản từ " : po.replacesPoId ? "Thay thế " : "Nguồn đầu tiên"}{finance.data.pos.find(p => p.id === (po.parentPoId ?? po.replacesPoId))?.number}</td></tr>)}</tbody></Table>{canCreate && <ActionForm finance={finance} command={intent} onSuccess={() => { setIntent("ADD_PO"); setParentId(""); }} label={intent === "ADD_BRIEF" ? "Lưu Brief" : intent === "REVISE_PO" ? "Lưu phiên bản PO" : intent === "REPLACE_PO" ? "Lưu PO thay thế" : "Lưu PO"}>
    <Select label="Thao tác nguồn" value={intent} onChange={e => { setIntent(e.target.value); setParentId(""); }}><option value="ADD_PO">Thêm PO</option><option value="REVISE_PO">Tạo phiên bản PO</option><option value="REPLACE_PO">Thay thế PO</option><option value="ADD_BRIEF">Lưu Brief làm nguồn</option></Select>
    {["REVISE_PO", "REPLACE_PO"].includes(intent) && <Select name="predecessorId" label="PO hiện tại được cập nhật / thay thế" required value={parentId} onChange={e => setParentId(e.target.value)}><option value="">Chọn PO hiện tại</option>{current.map(po => <option key={po.id} value={po.id}>{po.number} · v{po.version ?? 1}</option>)}</Select>}
    <Input key={`${intent}:${parentId}`} label={intent === "ADD_BRIEF" ? "Tên Brief" : "Số PO"} name={intent === "ADD_BRIEF" ? "title" : "poNumber"} required defaultValue={intent === "REVISE_PO" ? current.find(p => p.id === parentId)?.number : ""} />
    {intent !== "ADD_BRIEF" && <><Input name="net" label="Giá trị PO net (VND)" required inputMode="decimal" /><label className="tf-source-option"><input type="checkbox" name="confirmed" value="yes" required />Tôi đã kiểm tra số PO và giá trị với tài liệu gốc.</label><p>PO mới thay giá trị bản trước trong tổng hiện tại. IC cũ vẫn giữ nguồn đã dùng.</p></>}
    <Select label="File nguồn đã lưu trong project" name="sourceFileId" required><option value="">Chọn file gốc</option>{finance.files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</Select>
  </ActionForm>}</details>;
}
