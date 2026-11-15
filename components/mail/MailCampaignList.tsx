"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus, Send, X } from "lucide-react";
import { createCampaign, saveSender, type MailActionState } from "@/app/actions/customerMail";
import { useActionFeedback } from "@/components/InteractionProvider";

type SenderOption = { id: string; name: string };
type TemplateOption = { id: string; name: string; senderId: string | null };

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/45 p-4 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`tf-modal-enter my-auto w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-[16px] border border-zinc-200 bg-white p-5 shadow-2xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="tf-icon-button border-transparent" onClick={onClose} aria-label="Đóng">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NewCampaignButton({ senders, templates }: { senders: SenderOption[]; templates: TemplateOption[] }) {
  const [open, setOpen] = useState(false);
  const [senderId, setSenderId] = useState(senders[0]?.id ?? "");
  const [state, formAction, pending] = useActionState<MailActionState, FormData>(createCampaign, {});
  useActionFeedback(state);
  const choices = templates.filter((template) => !template.senderId || template.senderId === senderId);

  return (
    <>
      <button type="button" className="tf-button-primary" onClick={() => setOpen(true)} disabled={!senders.length}>
        <Plus size={16} aria-hidden="true" />
        Chiến dịch mới
      </button>
      {open && (
        <Dialog title="Chiến dịch mới" onClose={() => setOpen(false)}>
          <form action={formAction} className="space-y-4">
            <div>
              <label className="tf-label" htmlFor="campaign-name">Tên chiến dịch</label>
              <input id="campaign-name" name="name" className="tf-field" placeholder="Cảm ơn Gia tộc Markool" maxLength={160} required autoFocus />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="tf-label" htmlFor="campaign-sender">Thương hiệu gửi</label>
                <select
                  id="campaign-sender"
                  name="senderId"
                  className="tf-field"
                  value={senderId}
                  onChange={(event) => setSenderId(event.target.value)}
                >
                  {senders.map((sender) => (
                    <option key={sender.id} value={sender.id}>{sender.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="tf-label" htmlFor="campaign-template">Mẫu thư</label>
                <select id="campaign-template" name="templateId" className="tf-field" defaultValue={choices[0]?.id ?? ""}>
                  {choices.map((template) => (
                    <option key={template.id} value={template.id}>{template.name}</option>
                  ))}
                  <option value="">Thư trống</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="tf-button-secondary" onClick={() => setOpen(false)}>Huỷ</button>
              <button type="submit" className="tf-button-primary" disabled={pending} aria-busy={pending}>
                {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                Tạo chiến dịch
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

type SenderRow = { id: string; name: string; replyTo: string | null; smtpRef: string | null; configured: boolean };

function SenderForm({ sender, onDone }: { sender: SenderRow | null; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<MailActionState, FormData>(saveSender, {});
  useActionFeedback(state);
  useEffect(() => {
    if (state.success) onDone();
  }, [state, onDone]);
  return (
    <form action={formAction} className="space-y-4">
      {sender && <input type="hidden" name="id" value={sender.id} />}
      <div>
        <label className="tf-label" htmlFor="sender-name">Tên người gửi</label>
        <input id="sender-name" name="name" className="tf-field" defaultValue={sender?.name ?? ""} placeholder="Ga – Creative Station" maxLength={120} required />
      </div>
      <div>
        <label className="tf-label" htmlFor="sender-reply">Email nhận hồi âm</label>
        <input id="sender-reply" name="replyTo" type="email" className="tf-field" defaultValue={sender?.replyTo ?? ""} placeholder="hello@creativestation.vn" />
      </div>
      <div>
        <label className="tf-label" htmlFor="sender-smtp">Hộp thư SMTP riêng</label>
        <input id="sender-smtp" name="smtpRef" className="tf-field font-mono uppercase" defaultValue={sender?.smtpRef ?? ""} placeholder="Mặc định của app" maxLength={30} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="tf-button-secondary" onClick={onDone}>Huỷ</button>
        <button type="submit" className="tf-button-primary" disabled={pending} aria-busy={pending}>
          {pending && <span className="tf-spinner" aria-hidden="true" />}
          Lưu
        </button>
      </div>
    </form>
  );
}

export function SenderManager({ senders }: { senders: SenderRow[] }) {
  const [editing, setEditing] = useState<SenderRow | "new" | null>(null);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-700">Thương hiệu gửi</h2>
        <button type="button" className="tf-button-secondary" onClick={() => setEditing("new")}>
          <Plus size={16} aria-hidden="true" />
          Thêm
        </button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {senders.map((sender) => (
          <li key={sender.id} className="flex items-start justify-between gap-3 rounded-[14px] border border-zinc-200/80 bg-white px-4 py-3 shadow-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-900">{sender.name}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {sender.replyTo ? `Hồi âm: ${sender.replyTo}` : "Hồi âm về hộp thư gửi"}
              </p>
              {!sender.configured && (
                <p className="mt-1 text-xs text-red-600">Chưa có SMTP_{sender.smtpRef}_USER trên máy chủ</p>
              )}
            </div>
            <button type="button" className="tf-icon-button h-8 min-h-8 w-8 border-transparent" onClick={() => setEditing(sender)} aria-label={`Sửa ${sender.name}`}>
              <Pencil size={15} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {editing && (
        <Dialog title={editing === "new" ? "Thương hiệu gửi mới" : "Sửa thương hiệu gửi"} onClose={() => setEditing(null)}>
          <SenderForm sender={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        </Dialog>
      )}
    </section>
  );
}
