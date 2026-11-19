"use client";

import { SALUTATION_STYLES } from "@/components/mail/salutationStyles";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ClipboardPaste, Eye, FileUp, Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import {
  addRecipient,
  deleteRecipients,
  markRecipientsReviewed,
  previewCampaignEmail,
  setRecipientsSalutation,
  updateRecipient,
} from "@/app/actions/customerMail";
import { useInteraction } from "@/components/InteractionProvider";
import {
  ISSUE_LABELS,
  RECIPIENT_STATUS_LABELS,
  DEFAULT_SALUTATION,
  SALUTATION_OPTIONS,
  SALUTATION_LABELS,
  duplicateEmails,
  isSalutation,
  recipientIssues,
  type RecipientIssue,
  type Salutation,
} from "@/lib/customerMail";
import EmailPreview from "@/components/mail/EmailPreview";
import { Dialog } from "@/components/mail/MailCampaignList";

export type RecipientRow = {
  id: string;
  fullName: string;
  email: string | null;
  callName: string | null;
  salutation: string | null;
  group: string | null;
  note: string | null;
  source: string | null;
  confidence: number | null;
  reviewed: boolean;
  status: string;
  error: string | null;
  sentAt: string | null;
};

type Upload = { key: string; name: string; state: "reading" | "done" | "error"; message?: string };
type Original = { key: string; name: string; url: string; kind: "image" | "pdf" };

const MAX_UPLOAD = 4 * 1024 * 1024;
const ACCEPT = ".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,text/csv,application/pdf,image/*";

/** Thu nhỏ ảnh chụp lớn trước khi gửi (giữ đủ nét để đọc email); ảnh trình duyệt không mở được thì gửi nguyên. */
async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const ERROR_ISSUES: RecipientIssue[] = ["missing-email", "invalid-email", "duplicate-email", "missing-name"];

function InlineInput({
  value,
  placeholder,
  disabled,
  onCommit,
  className = "",
  type = "text",
  label,
}: {
  value: string | null;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: string) => void;
  className?: string;
  type?: string;
  label: string;
}) {
  return (
    <input
      // Đổi key khi giá trị trên máy chủ đổi để ô hiện đúng bản mới nhất.
      key={value ?? ""}
      type={type}
      defaultValue={value ?? ""}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next !== (value ?? "")) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={`w-full min-w-0 rounded-[7px] border border-transparent bg-transparent px-2 py-1.5 text-sm text-zinc-900 transition-colors duration-150 placeholder:text-zinc-400 hover:border-zinc-200 focus:border-brand-400 focus:bg-white focus:outline-none disabled:hover:border-transparent ${className}`}
    />
  );
}

function SalutationSelect({
  value,
  disabled,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  onPick: (value: Salutation) => void;
}) {
  const current = isSalutation(value) ? value : DEFAULT_SALUTATION;
  return (
    <select
      aria-label="Xưng hô"
      value={current}
      disabled={disabled}
      onChange={(event) => {
        if (isSalutation(event.target.value) && event.target.value !== current) onPick(event.target.value);
      }}
      className={`w-full min-w-0 rounded-[7px] border px-2 py-1.5 text-sm font-medium focus:outline-2 focus:outline-offset-2 focus:outline-brand-400 ${SALUTATION_STYLES[current]}`}
    >
      {SALUTATION_OPTIONS.map((option) => (
        <option key={option} value={option} className={SALUTATION_STYLES[option]}>
          {SALUTATION_LABELS[option]}
        </option>
      ))}
    </select>
  );
}

export default function RecipientWorkspace({
  campaignId,
  editable,
  aiReady,
  recipients,
}: {
  campaignId: string;
  editable: boolean;
  aiReady: boolean;
  recipients: RecipientRow[];
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [originals, setOriginals] = useState<Original[]>([]);
  const [showOriginals, setShowOriginals] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [filter, setFilter] = useState<"all" | "issues">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ html: string; subject: string; to: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const duplicates = useMemo(() => duplicateEmails(recipients), [recipients]);
  const issuesById = useMemo(
    () => new Map(recipients.map((row) => [row.id, editable ? recipientIssues(row, duplicates) : []])),
    [recipients, duplicates, editable]
  );
  const counts = {
    all: recipients.length,
    issues: recipients.filter((row) => issuesById.get(row.id)!.length).length,
  };
  const needle = query.trim().toLowerCase();
  const visible = recipients.filter((row) => {
    if (filter === "issues" && !issuesById.get(row.id)!.length) return false;
    if (!needle) return true;
    return [row.fullName, row.email, row.callName, row.group].some((value) => value?.toLowerCase().includes(needle));
  });
  const selectedIds = [...selected].filter((id) => recipients.some((row) => row.id === id));
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id));

  function run(action: () => Promise<{ error?: string; success?: string }>, quiet = false) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else if (result.success && !quiet) notify({ message: result.success, tone: "success" });
      router.refresh();
    });
  }

  async function sendImport(body: FormData, name: string) {
    const key = `${Date.now()}-${Math.random()}`;
    setUploads((current) => [{ key, name, state: "reading" }, ...current]);
    let message: string;
    let ok = false;
    try {
      const res = await fetch(`/api/mail/campaigns/${campaignId}/import`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; added?: number; merged?: number; summary?: string; usedAi?: boolean;
      };
      if (res.ok) {
        ok = true;
        const parts = [`+${data.added ?? 0} người`];
        if (data.merged) parts.push(`gộp ${data.merged} dòng trùng`);
        message = [parts.join(" · "), data.usedAi ? data.summary : ""].filter(Boolean).join(" — ");
      } else message = data.error ?? "Không đọc được danh sách này.";
    } catch {
      message = "Mất kết nối khi tải lên.";
    }
    setUploads((current) => current.map((item) => (item.key === key ? { ...item, state: ok ? "done" : "error", message } : item)));
    router.refresh();
  }

  async function handleFiles(list: FileList | File[]) {
    const files = [...list];
    for (const file of files) {
      const lower = file.name.toLowerCase();
      const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif)$/.test(lower);
      const isPdf = file.type === "application/pdf" || lower.endsWith(".pdf");
      if (isImage || isPdf) {
        setOriginals((current) => [
          ...current,
          { key: `${file.name}-${file.size}-${Date.now()}`, name: file.name, url: URL.createObjectURL(file), kind: isImage ? "image" : "pdf" },
        ]);
      }
    }
    // Đọc lần lượt từng file để mỗi lần gửi lên không quá giới hạn kích thước.
    for (const original of files) {
      const file = await prepareImage(original);
      if (file.size > MAX_UPLOAD) {
        setUploads((current) => [
          { key: `${Date.now()}-${original.name}`, name: original.name, state: "error", message: "File quá lớn. Mỗi file tối đa 4 MB." },
          ...current,
        ]);
        continue;
      }
      const body = new FormData();
      body.append("file", file, file.name);
      await sendImport(body, original.name);
    }
  }

  async function submitPaste() {
    const text = pasteText.trim();
    if (!text) return;
    const body = new FormData();
    body.append("text", text);
    setPasteOpen(false);
    setPasteText("");
    await sendImport(body, "Chữ dán");
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPreview(rowId: string) {
    startTransition(async () => {
      const result = await previewCampaignEmail(campaignId, rowId);
      if (result.html) setPreview({ html: result.html, subject: result.subject ?? "", to: result.to ?? "" });
      else if (result.error) notify({ message: result.error, tone: "error" });
    });
  }

  const hasOriginals = originals.length > 0 && showOriginals;

  return (
    <div className="space-y-6">
      {editable && (
        <div className="space-y-3">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length) void handleFiles(event.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center gap-3 rounded-[16px] border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 ${
              dragging ? "border-brand-400 bg-brand-50" : "border-zinc-200 bg-white"
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <FileUp size={20} aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-zinc-900">Kéo thả danh sách vào đây</p>
              <p className="mt-1 text-sm text-zinc-500">CSV, Excel{aiReady ? ", PDF, ảnh chụp" : ""}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="tf-button-primary" onClick={() => fileInput.current?.click()}>
                <FileUp size={16} aria-hidden="true" />
                Chọn file
              </button>
              {aiReady && (
                <button type="button" className="tf-button-secondary" onClick={() => setPasteOpen(true)}>
                  <ClipboardPaste size={16} aria-hidden="true" />
                  Dán danh sách
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) void handleFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {uploads.length > 0 && (
            <ul className="space-y-1.5">
              {uploads.map((upload) => (
                <li key={upload.key} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    {upload.state === "reading" ? (
                      <span className="tf-spinner" aria-hidden="true" />
                    ) : upload.state === "done" ? (
                      <Check size={16} className="text-brand-700" aria-hidden="true" />
                    ) : (
                      <X size={16} className="text-red-600" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium text-zinc-800">{upload.name}</span>
                    <span className={upload.state === "error" ? "text-red-600" : "text-zinc-500"}>
                      {upload.state === "reading" ? " · Đang đọc…" : upload.message ? ` · ${upload.message}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={hasOriginals ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" : ""}>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Lọc">
              {(
                [
                  ["all", "Tất cả"],
                  ["issues", "Cần sửa"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${
                    filter === key ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:text-zinc-900"
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 tabular-nums ${filter === key ? "text-zinc-300" : key === "issues" && counts.issues ? "text-red-600" : "text-zinc-400"}`}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {recipients.length > 12 && (
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm người nhận"
                  aria-label="Tìm người nhận"
                  className="tf-field min-h-9 w-48 py-1.5"
                />
              )}
              {originals.length > 0 && (
                <button type="button" className="tf-button-secondary" onClick={() => setShowOriginals((value) => !value)} aria-pressed={showOriginals}>
                  <ImageIcon size={16} aria-hidden="true" />
                  Bản gốc
                </button>
              )}
            </div>
          </div>

          {editable && selectedIds.length > 0 && (
            <div className="tf-pop-in flex flex-wrap items-center gap-2 rounded-[12px] bg-zinc-900 px-3 py-2 text-sm text-white">
              <span className="mr-1 font-medium tabular-nums">Đã chọn {selectedIds.length}</span>
              {SALUTATION_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setRecipientsSalutation(campaignId, selectedIds, option))}
                  className="rounded-[7px] bg-white/10 px-2.5 py-1 transition-colors hover:bg-white/20"
                >
                  {SALUTATION_LABELS[option]}
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => markRecipientsReviewed(campaignId, selectedIds), true)}
                className="rounded-[7px] bg-white/10 px-2.5 py-1 transition-colors hover:bg-white/20"
              >
                Đã xem lại
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await deleteRecipients(campaignId, selectedIds);
                    setSelected(new Set());
                    return result;
                  })
                }
                className="rounded-[7px] bg-red-500/80 px-2.5 py-1 transition-colors hover:bg-red-500"
              >
                Xoá
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="ml-auto rounded-[7px] px-2 py-1 text-zinc-300 hover:text-white" aria-label="Bỏ chọn">
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-[16px] border border-zinc-200/80 bg-white shadow-sm">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs text-zinc-500">
                <tr>
                  {editable && (
                    <th className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        checked={allVisibleSelected}
                        onChange={() =>
                          setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.id)))
                        }
                      />
                    </th>
                  )}
                  <th className="px-2 py-2.5 font-medium">Họ tên</th>
                  <th className="px-2 py-2.5 font-medium">Email</th>
                  <th className="w-28 px-2 py-2.5 font-medium">Tên gọi</th>
                  <th className="w-28 px-2 py-2.5 font-medium">Xưng hô</th>
                  <th className="w-36 px-2 py-2.5 font-medium">Nhóm</th>
                  <th className="px-2 py-2.5 font-medium">{editable ? "Kiểm tra" : "Trạng thái"}</th>
                  <th className="w-20 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {visible.map((row) => {
                  const issues = issuesById.get(row.id)!;
                  const hasError = issues.some((issue) => ERROR_ISSUES.includes(issue));
                  const lowConfidence = issues.includes("low-confidence");
                  const tint = hasError ? "bg-red-50/60" : lowConfidence ? "bg-amber-50/70" : "";
                  const save = (patch: Parameters<typeof updateRecipient>[1]) =>
                    run(() => updateRecipient(row.id, patch), true);
                  return (
                    <tr key={row.id} className={tint}>
                      {editable && (
                        <td className="px-3 py-1.5">
                          <input type="checkbox" aria-label={`Chọn ${row.fullName}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} />
                        </td>
                      )}
                      <td className="px-1 py-1.5">
                        <InlineInput label="Họ tên" value={row.fullName} disabled={!editable} onCommit={(value) => save({ fullName: value })} />
                        {row.source && <p className="truncate px-2 text-[11px] text-zinc-400">{row.source}</p>}
                      </td>
                      <td className="px-1 py-1.5">
                        <InlineInput
                          label="Email"
                          type="email"
                          value={row.email}
                          placeholder="Thiếu email"
                          disabled={!editable && row.status !== "failed"}
                          onCommit={(value) => save({ email: value })}
                          className={`font-mono text-[13px] ${issues.some((issue) => issue.endsWith("email")) ? "text-red-700 placeholder:text-red-400" : ""}`}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <InlineInput label="Tên gọi" value={row.callName} placeholder="Tên gọi" disabled={!editable} onCommit={(value) => save({ callName: value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <SalutationSelect
                          value={row.salutation}
                          disabled={!editable || pending}
                          onPick={(value) => save({ salutation: value })}
                        />
                      </td>
                      <td className="px-1 py-1.5">
                        <InlineInput label="Nhóm" value={row.group} disabled={!editable} onCommit={(value) => save({ group: value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        {editable ? (
                          issues.length ? (
                            <div className="flex flex-wrap gap-1">
                              {issues.map((issue) => (
                                <span
                                  key={issue}
                                  className={`tf-badge text-[11px] ${issue === "low-confidence" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}
                                >
                                  {ISSUE_LABELS[issue]}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <Check size={16} className="text-brand-600" aria-label="Ổn" />
                          )
                        ) : (
                          <span className={`text-xs ${row.status === "failed" ? "text-red-600" : row.status === "sent" ? "text-brand-700" : "text-zinc-500"}`}>
                            {RECIPIENT_STATUS_LABELS[row.status] ?? row.status}
                            {row.error && ` · ${row.error}`}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end gap-0.5">
                          {editable && lowConfidence && (
                            <button
                              type="button"
                              className="tf-icon-button h-8 min-h-8 w-8 border-transparent bg-transparent text-amber-700"
                              onClick={() => run(() => markRecipientsReviewed(campaignId, [row.id]), true)}
                              aria-label="Đã xem lại dòng này"
                              title="Đã xem lại"
                            >
                              <Check size={15} aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="tf-icon-button h-8 min-h-8 w-8 border-transparent bg-transparent"
                            onClick={() => openPreview(row.id)}
                            aria-label={`Xem thư của ${row.fullName}`}
                            title="Xem trước"
                          >
                            <Eye size={15} aria-hidden="true" />
                          </button>
                          {editable && (
                            <button
                              type="button"
                              className="tf-icon-button h-8 min-h-8 w-8 border-transparent bg-transparent hover:text-red-600"
                              onClick={() => run(() => deleteRecipients(campaignId, [row.id]), true)}
                              aria-label={`Xoá ${row.fullName}`}
                              title="Xoá"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-zinc-500">
                      {recipients.length ? "Không có dòng nào" : "Chưa có người nhận"}
                    </td>
                  </tr>
                )}
              </tbody>
              {editable && (
                <tfoot className="border-t border-zinc-100">
                  <tr>
                    <td className="px-3 py-2" />
                    <td className="px-1 py-2">
                      <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Thêm họ tên" aria-label="Họ tên người mới" className="tf-field min-h-9 py-1.5" />
                    </td>
                    <td className="px-1 py-2">
                      <input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} type="email" placeholder="email@congty.vn" aria-label="Email người mới" className="tf-field min-h-9 py-1.5 font-mono text-[13px]" />
                    </td>
                    <td colSpan={5} className="px-2 py-2">
                      <button
                        type="button"
                        className="tf-button-secondary min-h-9 py-1.5"
                        disabled={pending || (!newName.trim() && !newEmail.trim())}
                        onClick={() =>
                          run(async () => {
                            const result = await addRecipient(campaignId, { fullName: newName, email: newEmail });
                            if (!result.error) {
                              setNewName("");
                              setNewEmail("");
                            }
                            return result;
                          }, true)
                        }
                      >
                        <Plus size={15} aria-hidden="true" />
                        Thêm
                      </button>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {hasOriginals && (
          <aside className="space-y-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
            {originals.map((original) => (
              <figure key={original.key} className="overflow-hidden rounded-[14px] border border-zinc-200/80 bg-white shadow-sm">
                {original.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={original.url} alt={original.name} className="block w-full" />
                ) : (
                  <iframe src={original.url} title={original.name} className="block h-[520px] w-full border-0" />
                )}
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-zinc-500">
                  <span className="truncate">{original.name}</span>
                  <button
                    type="button"
                    className="shrink-0 text-zinc-400 hover:text-zinc-800"
                    aria-label={`Ẩn ${original.name}`}
                    onClick={() => {
                      URL.revokeObjectURL(original.url);
                      setOriginals((current) => current.filter((item) => item.key !== original.key));
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </figcaption>
              </figure>
            ))}
          </aside>
        )}
      </div>

      {pasteOpen && (
        <Dialog title="Dán danh sách" onClose={() => setPasteOpen(false)}>
          <div className="space-y-4">
            <textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              rows={10}
              className="tf-field font-mono text-[13px]"
              placeholder={"Chị Vũ Nguyễn Tuyết Nhung – nhung.vnt@congty.vn\nAnh Trần Minh – minh.tran@congty.vn"}
              aria-label="Danh sách người nhận"
              maxLength={60000}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="tf-button-secondary" onClick={() => setPasteOpen(false)}>Huỷ</button>
              <button type="button" className="tf-button-primary" onClick={submitPaste} disabled={!pasteText.trim()}>
                Đọc danh sách
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {preview && (
        <Dialog title="Xem trước" onClose={() => setPreview(null)} wide>
          <EmailPreview html={preview.html} subject={preview.subject} to={preview.to} />
        </Dialog>
      )}
    </div>
  );
}
