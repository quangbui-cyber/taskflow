"use client";

import { useEffect, useState, useTransition } from "react";
import { BookmarkPlus, Save } from "lucide-react";
import { previewCampaignEmail, saveAsTemplate, saveCampaignContent } from "@/app/actions/customerMail";
import { useInteraction } from "@/components/InteractionProvider";
import TemplateField from "./TemplateField";
import RecipientPreviewSelect from "./RecipientPreviewSelect";
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
  const dirty = (Object.keys(content) as (keyof Content)[]).some((key) => content[key] !== saved[key]);

  // Xem trước theo nội dung đang soạn, chờ người soạn dừng gõ một chút.
  const previewKey = JSON.stringify([sampleId, content]);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const loadingPreview = renderedKey !== previewKey;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      let result: Awaited<ReturnType<typeof previewCampaignEmail>>;
      try {
        result = await previewCampaignEmail(campaignId, sampleId || null, content);
      } catch {
        if (!cancelled) { setRenderedKey(previewKey); setPreviewError("Chưa tải được bản xem trước. Hãy thử lại."); }
        return;
      }
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


  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
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
          <TemplateField id="mail-title" label="Tiêu đề viết tay" value={content.title} onChange={(value) => update("title", value)} maxLength={60} disabled={!editable} />
        </div>
        <TemplateField id="mail-subject" label="Tiêu đề email" value={content.subject} onChange={(value) => update("subject", value)} maxLength={200} disabled={!editable} />
        <TemplateField id="mail-greeting" label="Lời chào" value={content.greeting} onChange={(value) => update("greeting", value)} maxLength={120} disabled={!editable} />
        <TemplateField id="mail-body" label="Nội dung" value={content.body} onChange={(value) => update("body", value)} maxLength={8000} disabled={!editable} multiline />
        <div className="grid gap-4 sm:grid-cols-2">
          <TemplateField id="mail-signoff" label="Lời kết" value={content.signOff} onChange={(value) => update("signOff", value)} maxLength={60} disabled={!editable} />
          <TemplateField id="mail-signature" label="Chữ ký" value={content.signature} onChange={(value) => update("signature", value)} maxLength={60} disabled={!editable} />
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
        <RecipientPreviewSelect recipients={recipients} value={sampleId} onChange={setSampleId} />
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
