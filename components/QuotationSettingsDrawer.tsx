"use client";

import { useState } from "react";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Field";
import { Alert } from "./ui/Presentation";
import { displayMoney } from "@/lib/costflow/money";
import { applyParameterImpact, previewParameterImpact, type ParameterImpactPreview, type QuotationParameterSnapshot } from "@/lib/costflow/quotationParameters";
import type { PairedRow } from "@/lib/costflow/types";

const EVENT_TYPES = ["Teambuilding", "Conference", "Gala", "Activation", "Exhibition", "Production", "Custom mixed"];

type Client = { id: string; name: string };

export default function QuotationSettingsDrawer({ open, onClose, title, onTitle, clientId, onClientId, clients, notes, onNotes, rows, parameterConfig, onApply, disabled = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  onTitle: (value: string) => void;
  clientId: string;
  onClientId: (value: string) => void;
  clients: Client[];
  notes: string;
  onNotes: (value: string) => void;
  rows: PairedRow[];
  parameterConfig?: QuotationParameterSnapshot;
  onApply: (rows: PairedRow[], parameterConfig: QuotationParameterSnapshot) => void;
  disabled?: boolean;
}) {
  const [proposed, setProposed] = useState<QuotationParameterSnapshot | undefined>(parameterConfig ? structuredClone(parameterConfig) : undefined);
  const [impact, setImpact] = useState<ParameterImpactPreview | null>(null);
  const [error, setError] = useState("");

  const propose = (next: QuotationParameterSnapshot) => {
    setProposed(next);
    setError("");
    if (!parameterConfig) return;
    try { setImpact(previewParameterImpact(rows, parameterConfig, next)); }
    catch (cause) { setImpact(null); setError((cause as Error).message); }
  };
  const cancel = () => {
    setProposed(parameterConfig ? structuredClone(parameterConfig) : undefined);
    setImpact(null);
    setError("");
  };
  const close = () => { cancel(); onClose(); };
  const apply = () => {
    if (!parameterConfig || !impact) return;
    try {
      const result = applyParameterImpact(rows, parameterConfig, impact);
      onApply(result.rows, result.parameterConfig);
      setImpact(null);
      setError("");
    } catch (cause) { setError((cause as Error).message); }
  };

  return <Dialog open={open} onClose={close} title="Thiết lập báo giá" description="Thay đổi tham số chỉ cập nhật bảng sau khi bạn xem tác động và chọn áp dụng." footer={<><Button variant="secondary" disabled={!impact || disabled} onClick={cancel}>Hủy thay đổi</Button><Button disabled={!impact || disabled} onClick={apply}>Áp dụng thay đổi</Button></>}>
    <fieldset disabled={disabled} className="tf-quotation-settings">
      <section>
        <h3>Thông tin chung</h3>
        <Input label="Tên báo giá" value={title} onChange={event => onTitle(event.target.value)} />
      </section>
      <section>
        <h3>Người nhận</h3>
        <Select label="Khách hàng" value={clientId} onChange={event => onClientId(event.target.value)}><option value="">Chọn khách hàng</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</Select>
      </section>
      <section>
        <h3>Tham số chương trình</h3>
        {!proposed || !parameterConfig ? <Alert title="Báo giá nhập tay">Báo giá này không có parameter schema. Các dòng tiếp tục hoạt động ở chế độ nhập tay.</Alert> : <>
          <div className="tf-quotation-parameter-grid">{proposed.definitions.filter(definition => definition.scope === "SHARED").map(definition => <Input key={definition.key} label={definition.label} inputMode="decimal" value={proposed.sharedValues[definition.key] ?? ""} onChange={event => propose({ ...proposed, sharedValues: { ...proposed.sharedValues, [definition.key]: event.target.value } })} />)}</div>
          <div className="tf-quotation-modules">{proposed.modules.map(module => <details key={module.id}><summary>{module.label}<span>{module.eventType || "Custom mixed"}</span></summary><div className="tf-quotation-module-fields"><Select label={`Gợi ý loại sự kiện · ${module.label}`} value={module.eventType || "Custom mixed"} onChange={event => propose({ ...proposed, modules: proposed.modules.map(item => item.id === module.id ? { ...item, eventType: event.target.value } : item) })}>{EVENT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</Select>{proposed.definitions.map(definition => <Input key={definition.key} label={`${definition.label} riêng cho module (không bắt buộc)`} inputMode="decimal" placeholder={proposed.sharedValues[definition.key] || definition.defaultValue} value={module.overrides[definition.key] ?? ""} onChange={event => propose({ ...proposed, modules: proposed.modules.map(item => item.id === module.id ? { ...item, overrides: { ...item.overrides, [definition.key]: event.target.value } } : item) })} />)}</div></details>)}</div>
        </>}
      </section>
      <section>
        <h3>Điều khoản thương mại</h3>
        <Textarea label="Ghi chú chung cho khách hàng" value={notes} onChange={event => onNotes(event.target.value)} />
      </section>
    </fieldset>
    {error && <Alert tone="danger" title={error} />}
    {impact && <section className="tf-quotation-impact" aria-live="polite"><div className="tf-quotation-impact-heading"><div><h3>Tác động dự kiến</h3><p>{impact.affected.length} giá trị sẽ thay đổi sau khi áp dụng.</p></div><div className="tf-quotation-impact-totals"><span>Báo giá <strong>{displayMoney(impact.oldTotals.sell.gross)} → {displayMoney(impact.newTotals.sell.gross)}</strong></span><span>IC <strong>{displayMoney(impact.oldTotals.buy.gross)} → {displayMoney(impact.newTotals.buy.gross)}</strong></span></div></div>{impact.issues.length > 0 && <Alert tone="warning" title="Còn công thức chưa tính được">{impact.issues.map(issue => <p key={`${issue.rowId}-${issue.side}-${issue.field}`}>{issue.rowName || issue.rowId}: {issue.message}</p>)}</Alert>}<div className="tf-quotation-impact-scroll"><table><thead><tr><th>Hạng mục</th><th>Phía</th><th>Trường</th><th>Cũ</th><th>Mới</th></tr></thead><tbody>{impact.affected.map(change => <tr key={`${change.rowId}-${change.side}-${change.field}`}><td>{change.rowName || change.rowId}</td><td>{change.side === "sell" ? "Bán" : "IC"}</td><td>{change.field === "quantity" ? "Số lượng" : "Đơn giá"}</td><td data-label="Cũ">{change.oldValue || "—"}</td><td data-label="Mới">{change.newValue || "—"}</td></tr>)}</tbody></table></div></section>}
  </Dialog>;
}
