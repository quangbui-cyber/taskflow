"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, CheckCircle2, PenTool, ShieldCheck } from "lucide-react";
import ActionForm from "@/components/CostFlowActionForm";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { Alert, Panel, Table } from "@/components/ui/Presentation";
import { SignaturePad } from "@/components/SignaturePad";
import type { Finance } from "@/components/CostFlowPanel";
import { PaymentRequestPreview, type PaymentPreviewLine } from "./PaymentRequestPreview";

type EditableLine = { stableKey: string; description: string; amount: string; lineId: string; recipientKey: string };

const newLine = (): EditableLine => ({
  stableKey: crypto.randomUUID(),
  description: "",
  amount: "",
  lineId: "",
  recipientKey: "",
});

type SavedDossier = NonNullable<Finance["paymentDossiers"]>[number];

export function PaymentRequestEditor({ finance, onCreated, draft }:
  { finance: Finance; onCreated: () => void; draft?: SavedDossier }) {
  const revision = finance.data.revisions.find(item => item.effective);
  const draftRequest = draft ? finance.requests.find(request => request.id === draft.requestId) : undefined;
  const [title, setTitle] = useState(draft?.title ?? "");
  const [milestone, setMilestone] = useState(draft?.milestone ?? "");
  const [explanation, setExplanation] = useState(typeof draftRequest?.payload.explanation === "string" ? draftRequest.payload.explanation : "");
  const [expectedSettlementDate, setExpectedSettlementDate] = useState(draftRequest?.payload.expectedSettlementDate ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signPadOpen, setSignPadOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signaturePin, setSignaturePin] = useState<string | null>(null);
  const [lines, setLines] = useState<EditableLine[]>(() => draft?.lines.length ? draft.lines.map(line => ({ stableKey: line.stableKey, description: line.description, amount: line.amount, lineId: line.icLineId, recipientKey: line.recipientKey })) : [newLine()]);
  const recipients = useMemo(() => [
    ...finance.project.members.map(member => ({ key: `USER:${member.userId}`, label: `${finance.users.find(user => user.id === member.userId)?.name ?? "Nhân viên"} (nội bộ)` })),
    ...finance.data.beneficiaries.map(beneficiary => ({ key: `VENDOR:${beneficiary.id}`, label: `${beneficiary.name} (NCC)` })),
  ], [finance.data.beneficiaries, finance.project.members, finance.users]);
  const update = (stableKey: string, patch: Partial<EditableLine>) => setLines(current => current.map(line => line.stableKey === stableKey ? { ...line, ...patch } : line));
  const move = (index: number, delta: number) => setLines(current => {
    const target = index + delta;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const submittedLines = lines.map(line => ({
    stableKey: line.stableKey,
    description: line.description,
    amount: line.amount,
    revisionId: revision?.id ?? "",
    lineId: line.lineId,
    recipientKey: line.recipientKey,
    evidenceIds: [],
  }));
  const previewLines: PaymentPreviewLine[] = lines.map(line => ({
    ...line,
    sourceLabel: revision?.lines.find(source => source.id === line.lineId)?.description ?? "",
    recipientLabel: recipients.find(recipient => recipient.key === line.recipientKey)?.label ?? "",
  }));
  const clientTotal = lines.reduce((sum, line) => /^\d+$/.test(line.amount) ? sum + BigInt(line.amount) : sum, BigInt(0)).toString();
  const duplicate = (line: EditableLine, index: number) => setLines(current => [
    ...current.slice(0, index + 1),
    { ...line, stableKey: crypto.randomUUID() },
    ...current.slice(index + 1),
  ]);
  const remove = (stableKey: string) => setLines(current => current.filter(item => item.stableKey !== stableKey));

  if (!revision) return <Alert tone="warning" title="Chưa có IC hiệu lực">Đề nghị tạm ứng đa khoản chỉ được lập từ một IC đang có hiệu lực ngân sách.</Alert>;
  return <Panel className="space-y-5">
    <div>
      <h3 className="font-bold text-base text-[var(--foreground)]">{draft ? "Sửa và gửi lại ĐNTU" : "Đề nghị tạm ứng đa khoản"}</h3>
      <p className="tf-ui-help">Một hồ sơ có thể gồm nhiều NCC/nhân viên. Từng khoản giữ nguồn IC riêng; tổng hiển thị chỉ là xem trước và được server tính lại. Bản đã gửi trước đó không bị sửa.</p>
    </div>
    <ActionForm finance={finance} command={draft ? "RESUBMIT_PAYMENT_DOSSIER" : "CREATE_PAYMENT_DOSSIER"} requestId={draft?.requestId} label={draft ? "Gửi lại toàn bộ ĐNTU" : "Gửi duyệt ĐNTU đa khoản"} showSubmit={false} onSuccess={onCreated}>
      <input type="hidden" name="kind" value="ADVANCE" />
      <input type="hidden" name="lines" value={JSON.stringify(submittedLines)} />
      <input type="hidden" name="clientTotal" value={clientTotal} />
      <input type="hidden" name="signatureData" value={signatureData ?? ""} />
      <input type="hidden" name="signaturePin" value={signaturePin ?? ""} />
      <div className="grid gap-3 md:grid-cols-2">
        <Input name="title" label="Tên hồ sơ" value={title} onChange={event => setTitle(event.target.value)} required placeholder="Ví dụ: Tạm ứng chuẩn bị sự kiện" />
        <Input name="milestone" label="Mốc hồ sơ chung" value={milestone} onChange={event => setMilestone(event.target.value)} required placeholder="Ví dụ: Đợt chuẩn bị và đặt cọc" />
      </div>
      <Textarea name="explanation" label="Giải trình chung" value={explanation} onChange={event => setExplanation(event.target.value)} hint="Bắt buộc khi tổng một nguồn vượt số tham chiếu IC; không tự tạo revision IC." />
      <Input name="expectedSettlementDate" type="date" label="Hạn hoàn ứng dự kiến" value={expectedSettlementDate} onChange={event => setExpectedSettlementDate(event.target.value)} required hint="Quá hạn sẽ hiển thị cảnh báo vàng; không tự động chặn hồ sơ tạm ứng mới có giải trình." />
      <div className="tf-payment-line-editor space-y-3">
        <div className="tf-payment-line-table" aria-label="Bảng nhập các khoản đề nghị trên desktop">
          <Table caption="Các khoản trong đề nghị tạm ứng">
            <thead><tr><th scope="col">Khoản</th><th scope="col">Dòng IC hiệu lực</th><th scope="col">Người nhận</th><th scope="col">Số tiền VND</th><th scope="col">Thao tác</th></tr></thead>
            <tbody>{lines.map((line, index) => <tr key={line.stableKey}>
              <td><Input aria-label={`Nội dung khoản ${index + 1}`} aria-required="true" value={line.description} onChange={event => update(line.stableKey, { description: event.target.value })} /></td>
              <td><Select aria-label={`Dòng IC của khoản ${index + 1}`} aria-required="true" value={line.lineId} onChange={event => update(line.stableKey, { lineId: event.target.value })}>
                <option value="">Chọn dòng IC</option>{revision.lines.map(source => <option key={source.id} value={source.id}>{source.description}</option>)}
              </Select></td>
              <td><Select aria-label={`Người nhận khoản ${index + 1}`} aria-required="true" value={line.recipientKey} onChange={event => update(line.stableKey, { recipientKey: event.target.value })}>
                <option value="">Chọn người nhận</option>{recipients.map(recipient => <option key={recipient.key} value={recipient.key}>{recipient.label}</option>)}
              </Select></td>
              <td><Input aria-label={`Số tiền khoản ${index + 1}`} aria-required="true" inputMode="numeric" pattern="[0-9]+" value={line.amount} onChange={event => update(line.stableKey, { amount: event.target.value.replace(/\D/g, "") })} /></td>
              <td><div className="flex flex-wrap gap-1">
                <IconButton aria-label={`Đưa khoản ${index + 1} lên`} variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></IconButton>
                <IconButton aria-label={`Đưa khoản ${index + 1} xuống`} variant="ghost" size="sm" disabled={index === lines.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></IconButton>
                <IconButton aria-label={`Nhân đôi khoản ${index + 1}`} variant="ghost" size="sm" onClick={() => duplicate(line, index)}><Copy size={15} aria-hidden="true" /></IconButton>
                <IconButton aria-label={`Xóa khoản ${index + 1}`} variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => remove(line.stableKey)}><Trash2 size={15} aria-hidden="true" /></IconButton>
              </div></td>
            </tr>)}</tbody>
          </Table>
        </div>
        <div className="tf-payment-line-cards" aria-label="Các khoản đề nghị trên điện thoại">
        {lines.map((line, index) => <fieldset key={line.stableKey} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 space-y-3">
          <legend className="px-1 text-sm font-semibold">Khoản {index + 1}</legend>
          <div className="grid gap-3 lg:grid-cols-4">
            <Input label="Nội dung" aria-required="true" value={line.description} onChange={event => update(line.stableKey, { description: event.target.value })} />
            <Select label="Dòng IC hiệu lực" aria-required="true" value={line.lineId} onChange={event => update(line.stableKey, { lineId: event.target.value })}>
              <option value="">Chọn dòng IC</option>
              {revision.lines.map(source => <option key={source.id} value={source.id}>{source.description}</option>)}
            </Select>
            <Select label="Người nhận" aria-required="true" value={line.recipientKey} onChange={event => update(line.stableKey, { recipientKey: event.target.value })}>
              <option value="">Chọn người nhận</option>
              {recipients.map(recipient => <option key={recipient.key} value={recipient.key}>{recipient.label}</option>)}
            </Select>
            <Input label="Số tiền VND" aria-required="true" inputMode="numeric" pattern="[0-9]+" value={line.amount} onChange={event => update(line.stableKey, { amount: event.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <IconButton aria-label={`Đưa khoản ${index + 1} lên`} variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></IconButton>
            <IconButton aria-label={`Đưa khoản ${index + 1} xuống`} variant="ghost" size="sm" disabled={index === lines.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></IconButton>
            <IconButton aria-label={`Nhân đôi khoản ${index + 1}`} variant="ghost" size="sm" onClick={() => duplicate(line, index)}><Copy size={15} aria-hidden="true" /></IconButton>
            <IconButton aria-label={`Xóa khoản ${index + 1}`} variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => remove(line.stableKey)}><Trash2 size={15} aria-hidden="true" /></IconButton>
          </div>
        </fieldset>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setLines(current => [...current, newLine()])}><Plus size={15} className="mr-1" aria-hidden="true" />Thêm khoản</Button>
          <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(true)}>Xem trước snapshot gửi duyệt</Button>
        </div>

        {/* Khối Ký số người lập bắt buộc theo WF-04 */}
        <div className="pt-2">
          {signatureData ? (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70">
              <div className="flex items-center gap-3">
                <div className="w-16 h-10 bg-white rounded border border-emerald-200 p-0.5 flex items-center justify-center overflow-hidden shadow-inner">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={signatureData} alt="Chữ ký người lập" className="max-w-full max-h-full object-contain" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-600" aria-hidden="true" />
                    Đã ký số người đề nghị (E-Sign sẵn sàng)
                  </p>
                  <p className="text-[11px] text-zinc-500">Mã PIN xác thực: •••••• · Khóa toàn vẹn phiên gửi</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" type="button" onClick={() => setSignPadOpen(true)}>
                <PenTool size={13} className="mr-1" aria-hidden="true" />
                Ký lại
              </Button>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-amber-600" aria-hidden="true" />
                  Yêu cầu ký số người lập hồ sơ (WF-04 & ERPNext OSS)
                </p>
                <p className="text-[11px] text-amber-700">
                  Toàn bộ chứng từ chi bắt buộc ký số và nhập mã PIN 6 số trước khi gửi duyệt.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => {
                  if (!title.trim() || !milestone.trim() || !lines.length || !lines[0].description) {
                    alert("Vui lòng nhập Tên hồ sơ, Mốc chung và ít nhất 1 khoản chi trước khi ký số.");
                    return;
                  }
                  setSignPadOpen(true);
                }}
              >
                <PenTool size={13} className="mr-1" aria-hidden="true" />
                Ký số người lập
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between border-t border-zinc-100 pt-4 gap-3">
          <div className="text-xs text-zinc-500">
            Tổng đề nghị: <strong className="text-zinc-900 font-mono text-sm">{new Intl.NumberFormat("vi-VN").format(Number(clientTotal || 0))} ₫</strong>
          </div>
          <Button
            type="submit"
            variant="primary"
            disabled={!signatureData}
          >
            {draft ? "Gửi lại toàn bộ ĐNTU" : "Gửi duyệt ĐNTU đa khoản"}
          </Button>
        </div>
      </div>
    </ActionForm>
    <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} title="Xem trước hồ sơ gửi duyệt" description="Đây là projection từ dữ liệu đang nhập; server sẽ chuẩn hóa và tính lại trước khi lưu snapshot bất biến.">
      <PaymentRequestPreview title={title} milestone={milestone} explanation={explanation} revisionLabel={`IC-R${revision.number}`} lines={previewLines} />
    </Dialog>
    <SignaturePad
      open={signPadOpen}
      onClose={() => setSignPadOpen(false)}
      onConfirm={(dataUrl, pin) => {
        setSignatureData(dataUrl);
        setSignaturePin(pin ?? "");
        setSignPadOpen(false);
      }}
      title="Ký số người đề nghị — Đề nghị tạm ứng đa khoản"
    />
  </Panel>;
}
