"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import ActionForm from "@/components/CostFlowActionForm";
import { Button, IconButton } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Alert, Panel } from "@/components/ui/Presentation";
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

  if (!revision) return <Alert tone="warning" title="Chưa có IC hiệu lực">Đề nghị tạm ứng đa khoản chỉ được lập từ một IC đang có hiệu lực ngân sách.</Alert>;
  return <Panel className="space-y-5">
    <div>
      <h3 className="font-bold text-base text-[var(--foreground)]">{draft ? "Sửa và gửi lại ĐNTU" : "Đề nghị tạm ứng đa khoản"}</h3>
      <p className="tf-ui-help">Một hồ sơ có thể gồm nhiều NCC/nhân viên. Từng khoản giữ nguồn IC riêng; tổng hiển thị chỉ là xem trước và được server tính lại. Bản đã gửi trước đó không bị sửa.</p>
    </div>
    <ActionForm finance={finance} command={draft ? "RESUBMIT_PAYMENT_DOSSIER" : "CREATE_PAYMENT_DOSSIER"} requestId={draft?.requestId} label={draft ? "Gửi lại toàn bộ ĐNTU" : "Gửi duyệt ĐNTU đa khoản"} onSuccess={onCreated}>
      <input type="hidden" name="kind" value="ADVANCE" />
      <input type="hidden" name="lines" value={JSON.stringify(submittedLines)} />
      <input type="hidden" name="clientTotal" value={clientTotal} />
      <div className="grid gap-3 md:grid-cols-2">
        <Input name="title" label="Tên hồ sơ" value={title} onChange={event => setTitle(event.target.value)} required placeholder="Ví dụ: Tạm ứng chuẩn bị sự kiện" />
        <Input name="milestone" label="Mốc hồ sơ chung" value={milestone} onChange={event => setMilestone(event.target.value)} required placeholder="Ví dụ: Đợt chuẩn bị và đặt cọc" />
      </div>
      <Textarea name="explanation" label="Giải trình chung" value={explanation} onChange={event => setExplanation(event.target.value)} hint="Bắt buộc khi tổng một nguồn vượt số tham chiếu IC; không tự tạo revision IC." />
      <div className="space-y-3">
        {lines.map((line, index) => <fieldset key={line.stableKey} className="rounded-xl border border-[var(--border)] bg-[var(--surface-soft)] p-3 space-y-3">
          <legend className="px-1 text-sm font-semibold">Khoản {index + 1}</legend>
          <div className="grid gap-3 lg:grid-cols-4">
            <Input label="Nội dung" value={line.description} onChange={event => update(line.stableKey, { description: event.target.value })} required />
            <Select label="Dòng IC hiệu lực" value={line.lineId} onChange={event => update(line.stableKey, { lineId: event.target.value })} required>
              <option value="">Chọn dòng IC</option>
              {revision.lines.map(source => <option key={source.id} value={source.id}>{source.description}</option>)}
            </Select>
            <Select label="Người nhận" value={line.recipientKey} onChange={event => update(line.stableKey, { recipientKey: event.target.value })} required>
              <option value="">Chọn người nhận</option>
              {recipients.map(recipient => <option key={recipient.key} value={recipient.key}>{recipient.label}</option>)}
            </Select>
            <Input label="Số tiền VND" inputMode="numeric" pattern="[0-9]+" value={line.amount} onChange={event => update(line.stableKey, { amount: event.target.value.replace(/\D/g, "") })} required />
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            <IconButton aria-label={`Đưa khoản ${index + 1} lên`} variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} /></IconButton>
            <IconButton aria-label={`Đưa khoản ${index + 1} xuống`} variant="ghost" size="sm" disabled={index === lines.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} /></IconButton>
            <IconButton aria-label={`Nhân đôi khoản ${index + 1}`} variant="ghost" size="sm" onClick={() => setLines(current => [...current.slice(0, index + 1), { ...line, stableKey: crypto.randomUUID() }, ...current.slice(index + 1)])}><Copy size={15} /></IconButton>
            <IconButton aria-label={`Xóa khoản ${index + 1}`} variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines(current => current.filter(item => item.stableKey !== line.stableKey))}><Trash2 size={15} /></IconButton>
          </div>
        </fieldset>)}
        <Button variant="secondary" size="sm" onClick={() => setLines(current => [...current, newLine()])}><Plus size={15} className="mr-1" />Thêm khoản</Button>
      </div>
      <PaymentRequestPreview milestone={milestone} lines={previewLines} />
    </ActionForm>
  </Panel>;
}
