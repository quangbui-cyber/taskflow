"use client";

import { useEffect, useState, useTransition } from "react";
import { BookmarkPlus, Save } from "lucide-react";
import { previewCampaignEmail, saveAsTemplate, saveCampaignContent } from "@/app/actions/customerMail";
import { useInteraction } from "@/components/InteractionProvider";
import { SALUTATION_LABELS, VARIABLE_TOKENS, isSalutation } from "@/lib/customerMail";
import EmailPreview from "@/components/mail/EmailPreview";
import { Dialog } from "@/components/mail/MailCampaignList";

type Content = {
  senderId: string;
  subject: string;
  title: string;
  greeting: string;
  body: string;
  signOff: string;
  signature: string;
};
type Field = Exclude<keyof Content, "senderId">;

const TOKEN_LABELS: Record<(typeof VARIABLE_TOKENS)[number], string> = {
  "{{Xung_ho}}": "Anh/Chị (đầu câu)",
  "{{xung_ho}}": "anh/chị (giữa câu)",
  "{{ten_goi}}": "Tên gọi",
  "{{ho_ten}}": "Họ tên",
  "{{nhom}}": "Nhóm",
};

export default function MailComposer({
  campaignId,
  editable,
  senders,
  initial,
  recipients,
}: {
  campaignId: string;
  editable: boolean;
  senders: { id: string; name: string }[];
  initial: Content;
  recipients: { id: string; fullName: string; salutation: string | null }[];
}) {
  const { notify } = useInteraction();
  const [content, setContent] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [sampleId, setSampleId] = useState<string>(recipients[0]?.id ?? "");
  const [preview, setPreview] = useState<{ html: string; subject: string; to: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [focused, setFocused] = useState<{ field: Field; element: HTMLInputElement | HTMLTextAreaElement } | null>(null);
  const dirty = (Object.keys(content) as (keyof Content)[]).some((key) => content[key] !== saved[key]);

  // Xem trước theo nội dung đang soạn, chờ người soạn dừng gõ một chút.
  const previewKey = JSON.stringify([sampleId, content]);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const loadingPreview = renderedKey !== previewKey;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await previewCampaignEmail(campaignId, sampleId || null, content);
      if (cancelled) return;
      setRenderedKey(previewKey);
      if (result.html) {
        setPreview({ html: result.html, subject: result.subject ?? "", to: result.to ?? "" });
        setPreviewError(null);
      } else setPreviewError(result.error ?? null);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [campaignId, sampleId, content, previewKey]);

  function update(field: keyof Content, value: string) {
    setContent((current) => ({ ...current, [field]: value }));
  }

  function insertToken(token: string) {
    const target = focused;
    if (!target || !editable) return;
    const { element, field } = target;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? start;
    const next = element.value.slice(0, start) + token + element.value.slice(end);
    update(field, next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function save() {
    startSaving(async () => {
      const result = await saveCampaignContent(campaignId, content);
      if (result.error) notify({ message: result.error, tone: "error" });
      else {
        setSaved(content);
        notify({ message: result.success ?? "Đã lưu thư.", tone: "success" });
      }
    });
  }

  function saveTemplate() {
    startSaving(async () => {
      if (dirty) {
        const saveResult = await saveCampaignContent(campaignId, content);
        if (saveResult.error) return notify({ message: saveResult.error, tone: "error" });
        setSaved(content);
      }
      const result = await saveAsTemplate(campaignId, templateName);
      if (result.error) notify({ message: result.error, tone: "error" });
      else {
        notify({ message: result.success ?? "Đã lưu mẫu.", tone: "success" });
        setTemplateOpen(false);
      }
    });
  }

  function rememberFocus(event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setFocused({ field: event.currentTarget.dataset.field as Field, element: event.currentTarget });
  }
  function changeField(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    update(event.currentTarget.dataset.field as Field, event.currentTarget.value);
  }
  const fieldProps = (field: Field) => ({
    value: content[field],
    disabled: !editable,
    "data-field": field,
    onChange: changeField,
    onFocus: rememberFocus,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="tf-label" htmlFor="mail-sender">Thương hiệu gửi</label>
            <select
              id="mail-sender"
              className="tf-field"
              value={content.senderId}
              disabled={!editable}
              onChange={(event) => update("senderId", event.target.value)}
            >
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>{sender.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="tf-label" htmlFor="mail-title">Tiêu đề viết tay</label>
            <input id="mail-title" className="tf-field" maxLength={60} {...fieldProps("title")} />
          </div>
        </div>
        <div>
          <label className="tf-label" htmlFor="mail-subject">Tiêu đề email</label>
          <input id="mail-subject" className="tf-field" maxLength={200} {...fieldProps("subject")} />
        </div>
        <div>
          <label className="tf-label" htmlFor="mail-greeting">Lời chào</label>
          <input id="mail-greeting" className="tf-field" maxLength={120} {...fieldProps("greeting")} />
        </div>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="tf-label mb-0" htmlFor="mail-body">Nội dung</label>
            {editable && (
              <div className="flex flex-wrap gap-1.5" aria-label="Chèn biến">
                {VARIABLE_TOKENS.map((token) => (
                  <button
                    key={token}
                    type="button"
                    // Giữ con trỏ ở ô đang gõ khi bấm chèn.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertToken(token)}
                    className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 transition duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:text-zinc-900"
                    title={token}
                  >
                    {TOKEN_LABELS[token]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <textarea id="mail-body" rows={14} className="tf-field leading-relaxed" maxLength={8000} {...fieldProps("body")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="tf-label" htmlFor="mail-signoff">Lời kết</label>
            <input id="mail-signoff" className="tf-field" maxLength={60} {...fieldProps("signOff")} />
          </div>
          <div>
            <label className="tf-label" htmlFor="mail-signature">Chữ ký</label>
            <input id="mail-signature" className="tf-field" maxLength={60} {...fieldProps("signature")} />
          </div>
        </div>
        {editable && (
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="tf-button-secondary" onClick={() => setTemplateOpen(true)} disabled={saving}>
              <BookmarkPlus size={16} aria-hidden="true" />
              Lưu làm mẫu
            </button>
            <button type="button" className="tf-button-primary" onClick={save} disabled={saving || !dirty} aria-busy={saving}>
              {saving ? <span className="tf-spinner" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
              {dirty ? "Lưu thư" : "Đã lưu"}
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <select
          className="tf-field"
          value={sampleId}
          onChange={(event) => setSampleId(event.target.value)}
          aria-label="Xem thư của"
          disabled={!recipients.length}
        >
          {recipients.length === 0 && <option value="">Người nhận mẫu: Chị Nhung</option>}
          {recipients.map((row) => (
            <option key={row.id} value={row.id}>
              {row.fullName}
              {isSalutation(row.salutation) ? ` · ${SALUTATION_LABELS[row.salutation]}` : " · Chưa chọn xưng hô"}
            </option>
          ))}
        </select>
        {previewError ? (
          <p className="rounded-[12px] bg-red-50 px-4 py-3 text-sm text-red-700">{previewError}</p>
        ) : (
          <EmailPreview html={preview?.html ?? null} subject={preview?.subject} to={preview?.to} loading={loadingPreview} />
        )}
      </div>

      {templateOpen && (
        <Dialog title="Lưu làm mẫu" onClose={() => setTemplateOpen(false)}>
          <div className="space-y-4">
            <input
              className="tf-field"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Tên mẫu"
              aria-label="Tên mẫu"
              maxLength={120}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="tf-button-secondary" onClick={() => setTemplateOpen(false)}>Huỷ</button>
              <button type="button" className="tf-button-primary" onClick={saveTemplate} disabled={saving} aria-busy={saving}>
                {saving && <span className="tf-spinner" aria-hidden="true" />}
                Lưu mẫu
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
