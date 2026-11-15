"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Circle, Eye, FlaskConical, RotateCcw, Send, X } from "lucide-react";
import {
  cancelSchedule,
  previewCampaignEmail,
  retryFailed,
  scheduleCampaign,
  sendCampaignNow,
  sendTestEmail,
  updateRecipient,
} from "@/app/actions/customerMail";
import { useInteraction } from "@/components/InteractionProvider";
import {
  SALUTATIONS,
  SALUTATION_LABELS,
  formatVietnamDateTime,
  toVietnamDateTimeInput,
  type CampaignStatus,
  type Readiness,
  type Salutation,
} from "@/lib/customerMail";
import EmailPreview from "@/components/mail/EmailPreview";
import { Dialog } from "@/components/mail/MailCampaignList";
import type { RecipientRow } from "@/components/mail/RecipientWorkspace";

type Event = { id: string; action: string; detail: string | null; user: string | null; at: string };

const EVENT_LABELS: Record<string, string> = {
  created: "Tạo chiến dịch",
  import: "Tải danh sách",
  test: "Gửi thử",
  send: "Bấm gửi",
  schedule: "Hẹn giờ",
  cancel: "Huỷ hẹn giờ",
  retry: "Gửi lại",
  finished: "Gửi xong",
};

/** 19:00 hôm nay (giờ Việt Nam) nếu chưa qua, không thì 19:00 ngày mai. */
function defaultSendTime() {
  const now = new Date();
  const today = toVietnamDateTimeInput(now).slice(0, 10);
  const candidate = `${today}T19:00`;
  if (candidate > toVietnamDateTimeInput(new Date(now.getTime() + 5 * 60_000))) return candidate;
  return `${toVietnamDateTimeInput(new Date(now.getTime() + 24 * 3600_000)).slice(0, 10)}T19:00`;
}

function CheckRow({ done, children, action }: { done: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? "bg-brand-100 text-brand-700" : "bg-zinc-100 text-zinc-400"}`}>
        {done ? <Check size={14} aria-hidden="true" /> : <Circle size={10} aria-hidden="true" />}
      </span>
      <span className={`min-w-0 flex-1 text-sm ${done ? "text-zinc-700" : "text-zinc-900"}`}>{children}</span>
      {action}
    </li>
  );
}

export default function SendPanel({
  campaignId,
  status,
  sendAt,
  readiness,
  sender,
  subject,
  testerEmail,
  testSent,
  recipients,
  events,
}: {
  campaignId: string;
  status: CampaignStatus;
  sendAt: string | null;
  readiness: Readiness;
  sender: { name: string; replyTo: string | null; address: string | null; configured: boolean };
  subject: string;
  testerEmail: string;
  testSent: boolean;
  recipients: RecipientRow[];
  events: Event[];
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"now" | "later">("later");
  const [when, setWhen] = useState(defaultSendTime);
  const [confirming, setConfirming] = useState(false);
  const [previewed, setPreviewed] = useState<Set<Salutation>>(new Set());
  const [preview, setPreview] = useState<{ html: string; subject: string; to: string } | null>(null);

  // Đang gửi: tự làm mới để thấy số thư tăng dần.
  useEffect(() => {
    if (status !== "sending") return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [status, router]);

  function run(action: () => Promise<{ error?: string; success?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else if (result.success) notify({ message: result.success, tone: "success" });
      setConfirming(false);
      router.refresh();
    });
  }

  const sampleFor = (salutation: Salutation) => recipients.find((row) => row.salutation === salutation);
  const presentSalutations = SALUTATIONS.filter((salutation) => readiness.bySalutation[salutation] > 0);

  function openSample(salutation: Salutation) {
    const row = sampleFor(salutation);
    if (!row) return;
    startTransition(async () => {
      const result = await previewCampaignEmail(campaignId, row.id);
      if (result.html) {
        setPreview({ html: result.html, subject: result.subject ?? "", to: result.to ?? "" });
        setPreviewed((current) => new Set(current).add(salutation));
      } else if (result.error) notify({ message: result.error, tone: "error" });
    });
  }

  const sent = recipients.filter((row) => row.status === "sent").length;
  const failed = recipients.filter((row) => row.status === "failed");
  const waiting = recipients.length - sent - failed.length;
  const retrying = recipients.find((row) => row.status === "pending" && row.error);
  const canSend = readiness.ready && sender.configured;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-8">
        {(status === "draft" || status === "scheduled") && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-zinc-700">Kiểm tra trước khi gửi</h2>
            <ul className="divide-y divide-zinc-100 rounded-[16px] border border-zinc-200/80 bg-white px-4 shadow-sm">
              <CheckRow
                done={readiness.total > 0 && readiness.blocked === 0}
                action={
                  readiness.blocked > 0 || readiness.total === 0 ? (
                    <Link href={`/mail/${campaignId}?tab=danh-sach`} className="tf-button-secondary min-h-9 py-1.5">
                      Mở danh sách
                    </Link>
                  ) : undefined
                }
              >
                {readiness.total === 0
                  ? "Chưa có người nhận"
                  : readiness.blocked > 0
                    ? <><span className="font-semibold text-red-600">{readiness.blocked}</span> / {readiness.total} người còn thiếu email, xưng hô hoặc cần xem lại</>
                    : `${readiness.total} người đủ email, xưng hô, không trùng`}
              </CheckRow>
              <CheckRow
                done={presentSalutations.length > 0 && presentSalutations.every((salutation) => previewed.has(salutation))}
                action={
                  <div className="flex gap-1.5">
                    {presentSalutations.map((salutation) => (
                      <button
                        key={salutation}
                        type="button"
                        className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                          previewed.has(salutation) ? "border-brand-200 bg-brand-50 text-brand-800" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"
                        }`}
                        onClick={() => openSample(salutation)}
                        disabled={pending}
                      >
                        <Eye size={13} aria-hidden="true" />
                        {SALUTATION_LABELS[salutation]} ({readiness.bySalutation[salutation]})
                      </button>
                    ))}
                  </div>
                }
              >
                Xem trước một thư cho mỗi cách xưng hô
              </CheckRow>
              <CheckRow
                done={testSent}
                action={
                  <button
                    type="button"
                    className="tf-button-secondary min-h-9 py-1.5"
                    disabled={pending || !sender.configured}
                    onClick={() => run(() => sendTestEmail(campaignId, recipients[0]?.id ?? null))}
                  >
                    <FlaskConical size={15} aria-hidden="true" />
                    Gửi thử
                  </button>
                }
              >
                Gửi thử tới <span className="font-medium">{testerEmail}</span>, mở trên điện thoại và máy tính
              </CheckRow>
              <CheckRow done={sender.configured}>
                <span className="block">
                  Từ <span className="font-medium">{sender.name}</span>
                  {sender.address ? <span className="text-zinc-500"> &lt;{sender.address}&gt;</span> : <span className="text-red-600"> · chưa có hộp thư SMTP</span>}
                </span>
                <span className="block text-zinc-500">Hồi âm về {sender.replyTo || sender.address || "hộp thư gửi"}</span>
                <span className="block text-zinc-500">Tiêu đề: {subject}</span>
              </CheckRow>
            </ul>
          </section>
        )}

        {status === "draft" && (
          <section className="space-y-3">
            <div className="flex gap-1 rounded-[12px] bg-zinc-100 p-1 sm:w-fit" role="radiogroup" aria-label="Thời điểm gửi">
              {(
                [
                  ["later", "Hẹn giờ"],
                  ["now", "Gửi ngay"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={mode === key}
                  onClick={() => {
                    setMode(key);
                    setConfirming(false);
                  }}
                  className={`flex-1 rounded-[9px] px-4 py-2 text-sm transition-colors duration-150 sm:flex-none ${
                    mode === key ? "bg-white font-semibold text-zinc-950 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {mode === "later" && (
                <div>
                  <label className="tf-label" htmlFor="send-at">Giờ Việt Nam</label>
                  <input id="send-at" type="datetime-local" className="tf-field" value={when} onChange={(event) => setWhen(event.target.value)} />
                </div>
              )}
              {!confirming ? (
                <button type="button" className="tf-button-primary" disabled={!canSend || pending} onClick={() => setConfirming(true)}>
                  {mode === "later" ? <CalendarClock size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                  {mode === "later" ? `Hẹn gửi ${readiness.total} thư` : `Gửi ${readiness.total} thư`}
                </button>
              ) : (
                <div className="tf-pop-in flex flex-wrap items-center gap-2">
                  <button type="button" className="tf-button-secondary" onClick={() => setConfirming(false)}>Chưa</button>
                  <button
                    type="button"
                    className="tf-button-primary"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() =>
                      run(() => (mode === "later" ? scheduleCampaign(campaignId, when) : sendCampaignNow(campaignId)))
                    }
                  >
                    {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                    {mode === "later" ? `Chắc chắn hẹn ${when.slice(11)} ${when.slice(8, 10)}/${when.slice(5, 7)}` : `Chắc chắn gửi ${readiness.total} thư`}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {status === "scheduled" && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-amber-200 bg-amber-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <CalendarClock size={20} className="text-amber-700" aria-hidden="true" />
              <p className="text-sm text-amber-900">
                Sẽ gửi {readiness.total} thư lúc <span className="font-semibold">{sendAt ? formatVietnamDateTime(new Date(sendAt)) : ""}</span>
              </p>
            </div>
            <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => run(() => cancelSchedule(campaignId))}>
              <X size={16} aria-hidden="true" />
              Huỷ hẹn giờ
            </button>
          </section>
        )}

        {(status === "sending" || status === "done") && (
          <section className="space-y-5">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-3xl font-semibold tabular-nums text-zinc-950">
                  {sent}<span className="text-lg font-normal text-zinc-400">/{recipients.length}</span>
                </p>
                <p className="text-sm text-zinc-600">đã gửi</p>
                {failed.length > 0 && <p className="text-sm font-medium text-red-600">{failed.length} lỗi</p>}
                {waiting > 0 && <p className="text-sm text-zinc-500">{waiting} đang chờ</p>}
                {retrying && <p className="text-sm text-amber-700">Sẽ thử lại: {retrying.error}</p>}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full w-full origin-left rounded-full bg-brand-400 transition-transform duration-200 ease-out"
                  style={{ transform: `scaleX(${recipients.length ? sent / recipients.length : 0})` }}
                />
              </div>
            </div>

            {failed.length > 0 && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-zinc-700">Thư lỗi</h2>
                  <button type="button" className="tf-button-primary" disabled={pending} onClick={() => run(() => retryFailed(campaignId))}>
                    <RotateCcw size={16} aria-hidden="true" />
                    Gửi lại {failed.length} thư lỗi
                  </button>
                </div>
                <ul className="divide-y divide-zinc-100 rounded-[16px] border border-zinc-200/80 bg-white shadow-sm">
                  {failed.map((row) => (
                    <li key={row.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                      <span className="truncate text-sm font-medium text-zinc-900">{row.fullName}</span>
                      <input
                        key={row.email ?? ""}
                        defaultValue={row.email ?? ""}
                        aria-label={`Email của ${row.fullName}`}
                        className="tf-field min-h-9 py-1.5 font-mono text-[13px]"
                        onBlur={(event) => {
                          const value = event.currentTarget.value.trim();
                          if (value !== (row.email ?? "")) run(() => updateRecipient(row.id, { email: value }));
                        }}
                      />
                      <span className="text-sm text-red-600">{row.error}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>

      <aside className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-700">Nhật ký</h2>
        {events.length === 0 ? (
          <p className="text-sm text-zinc-400">Chưa có hoạt động</p>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="text-sm">
                <p className="text-zinc-800">
                  <span className="font-medium">{EVENT_LABELS[event.action] ?? event.action}</span>
                  {event.detail && <span className="text-zinc-600"> · {event.detail}</span>}
                </p>
                <p className="text-xs text-zinc-400">
                  {event.at}
                  {event.user && ` · ${event.user}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </aside>

      {preview && (
        <Dialog title="Xem trước" onClose={() => setPreview(null)} wide>
          <EmailPreview html={preview.html} subject={preview.subject} to={preview.to} />
        </Dialog>
      )}
    </div>
  );
}
