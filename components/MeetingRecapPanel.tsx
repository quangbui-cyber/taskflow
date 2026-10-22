"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Copy,
  FileAudio,
  Mic,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import {
  deleteMeetingRecap,
  regenerateMeetingRecap,
  saveMeetingRecapContent,
  sendMeetingRecap,
  type MeetingRecapActionState,
} from "@/app/actions/meetingRecaps";
import { useInteraction } from "@/components/InteractionProvider";
import MeetingRecorder from "@/components/MeetingRecorder";
import { RECAP_AUDIO_ACCEPT, formatClock, parseRecapContent } from "@/lib/meetingRecap";
import { formatLimit, friendlyUploadError, uploadRecapAudio } from "@/lib/recapUploadClient";

export type MeetingRecapView = {
  status: string;
  stage: string | null;
  error: string | null;
  content: string | null;
  transcript: string | null;
  audioName: string | null;
  audioSeconds: number | null;
  sentAt: string | null;
  updatedAt: string;
  stale: boolean;
};

const MB = 1024 * 1024;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));

function RecapContent({ content }: { content: string }) {
  return (
    <div className="space-y-2 text-[15px] leading-7 text-zinc-700">
      {parseRecapContent(content).map((block, index) =>
        block.type === "heading" ? (
          <h2 key={index} className="pt-3 text-base font-semibold text-zinc-950 first:pt-0">
            {block.text}
          </h2>
        ) : block.type === "list" ? (
          <ul key={index} className="list-disc space-y-1 pl-5 marker:text-zinc-400">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{block.text}</p>
        )
      )}
    </div>
  );
}

function AudioUploader({
  meetingId,
  label,
  maxAudioMinutes,
  onDone,
}: {
  meetingId: string;
  label: string;
  maxAudioMinutes: number;
  onDone: () => void;
}) {
  const { notify } = useInteraction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  async function start() {
    setError(null);
    if (!file) return setError("Hãy chọn file ghi âm.");
    if (!consent) return setError("Hãy xác nhận đã báo cho người tham dự rằng cuộc họp được ghi âm.");

    setProgress(0);
    try {
      await uploadRecapAudio({ meetingId, file, durationSeconds: null, maxAudioMinutes, onProgress: setProgress });
      notify({ message: "Đã tải lên. AI đang chép lời và viết biên bản…", tone: "success" });
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onDone();
    } catch (err) {
      setError(friendlyUploadError(err));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed px-4 py-6 text-center transition-colors ${
          file ? "border-brand-300 bg-brand-50/50" : "border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <FileAudio size={26} className="text-zinc-400" aria-hidden="true" />
        {file ? (
          <span className="max-w-full break-all text-sm font-medium text-zinc-800">
            {file.name} · {(file.size / MB).toFixed(1)} MB
          </span>
        ) : (
          <span className="text-sm text-zinc-600">
            <span className="font-medium text-brand-700">Chọn file ghi âm</span> (mp3, m4a, wav, webm… tối đa 100 MB,{" "}
            {formatLimit(maxAudioMinutes)})
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={RECAP_AUDIO_ACCEPT}
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            setError(null);
            setFile(event.target.files?.[0] ?? null);
          }}
        />
      </label>

      <label className="flex items-start gap-2.5 text-sm leading-6 text-zinc-600">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[#a8d431]"
        />
        Tôi đã báo cho người tham dự biết cuộc họp được ghi âm. File ghi âm bị xoá ngay sau khi chép lời.
      </label>

      {error && (
        <p role="alert" className="rounded-[7px] bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {busy ? (
        <div className="space-y-1.5" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-zinc-500">Đang tải lên… {progress}%</p>
        </div>
      ) : (
        <button type="button" onClick={start} disabled={!file} className="tf-button-primary">
          <Upload size={16} aria-hidden="true" />
          {label}
        </button>
      )}
    </div>
  );
}

/** Hai cách lấy ghi âm. Cả hai luôn được giữ trên trang (chỉ ẩn bên không chọn) để đổi qua lại không làm dừng bản ghi. */
function AudioSource({
  meetingId,
  uploadLabel,
  maxAudioMinutes,
  onDone,
}: {
  meetingId: string;
  uploadLabel: string;
  maxAudioMinutes: number;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"record" | "file">("record");
  const tabs = [
    { key: "record" as const, label: "Ghi âm trong app", icon: Mic },
    { key: "file" as const, label: "Tải file lên", icon: FileAudio },
  ];
  return (
    <div>
      <div className="mb-4 inline-flex rounded-[8px] bg-zinc-100 p-1" role="tablist" aria-label="Cách lấy ghi âm">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            onClick={() => setMode(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === tab.key ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            <tab.icon size={15} aria-hidden="true" />
            {tab.label}
          </button>
        ))}
      </div>
      <div hidden={mode !== "record"}>
        <MeetingRecorder meetingId={meetingId} maxAudioMinutes={maxAudioMinutes} onUploaded={onDone} />
      </div>
      <div hidden={mode !== "file"}>
        <AudioUploader meetingId={meetingId} label={uploadLabel} maxAudioMinutes={maxAudioMinutes} onDone={onDone} />
      </div>
    </div>
  );
}

export default function MeetingRecapPanel({
  meetingId,
  canManage,
  enabled,
  startBlock,
  cancelled,
  maxAudioMinutes,
  recap,
}: {
  meetingId: string;
  canManage: boolean;
  enabled: boolean;
  startBlock: string | null;
  cancelled: boolean;
  maxAudioMinutes: number;
  recap: MeetingRecapView | null;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(recap?.content ?? "");

  const processing = recap?.status === "PROCESSING" && !recap.stale;

  // Đang xử lý thì cứ vài giây tải lại để thấy kết quả (chỉ khi tab đang mở, tự dừng sau 15 phút).
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [processing, router]);

  function run(action: () => Promise<MeetingRecapActionState>, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.error) notify({ message: result.error, tone: "error" });
      else {
        if (result.success) notify({ message: result.success, tone: "success" });
        after?.();
      }
      router.refresh();
    });
  }

  const canUpload = canManage && enabled && !startBlock;
  const content = recap?.content?.trim() ? recap.content : null;

  // ----- Người tham dự (không quản lý) -----
  if (!canManage) {
    return (
      <section className="tf-panel px-5 py-5">
        {content ? (
          <>
            <RecapContent content={content} />
            {recap?.sentAt && (
              <p className="mt-5 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                Biên bản do AI viết từ file ghi âm, người tổ chức đã đọc lại và gửi lúc {formatDateTime(recap.sentAt)}.
              </p>
            )}
          </>
        ) : (
          <p className="py-6 text-center text-sm text-zinc-500">
            {recap ? "Người tổ chức đang hoàn thiện biên bản. Bạn sẽ được báo khi có." : "Cuộc họp này chưa có biên bản."}
          </p>
        )}
      </section>
    );
  }

  // ----- Người tổ chức / admin -----
  return (
    <div className="space-y-5">
      {processing && (
        <section className="tf-panel flex items-start gap-3 px-5 py-5" aria-live="polite">
          <span className="tf-spinner mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-zinc-900">
              {recap?.stage === "SUMMARIZING" ? "AI đang viết biên bản…" : "Đang chép lời file ghi âm…"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Thường mất 1–3 phút. Bạn có thể rời trang, khi xong app sẽ báo.
            </p>
          </div>
        </section>
      )}

      {recap?.status === "PROCESSING" && recap.stale && (
        <p role="alert" className="flex items-start gap-2 rounded-[8px] bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          Lần xử lý trước bị gián đoạn. Hãy tải file ghi âm lên lại.
        </p>
      )}

      {recap?.status === "FAILED" && recap.error && (
        <div role="alert" className="flex flex-wrap items-start gap-3 rounded-[8px] bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">{recap.error}</p>
          {recap.transcript && enabled && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => regenerateMeetingRecap(meetingId))}
              className="tf-button-secondary !min-h-8 !px-3 text-xs"
            >
              <RefreshCw size={14} aria-hidden="true" />
              Thử viết lại
            </button>
          )}
        </div>
      )}

      {content && !processing && (
        <section className="tf-panel px-5 py-5">
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-zinc-100 pb-4">
            <span
              className={`tf-badge mt-0 ${recap?.sentAt ? "bg-brand-50 text-brand-800" : "bg-amber-50 text-amber-800"}`}
            >
              {recap?.sentAt ? `Đã gửi ${formatDateTime(recap.sentAt)}` : "Chưa gửi — hãy đọc lại trước khi gửi"}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {!editing && (
                <>
                  <button
                    type="button"
                    className="tf-button-secondary !min-h-9 !px-3 text-xs"
                    onClick={() => {
                      setDraft(content);
                      setEditing(true);
                    }}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    Sửa
                  </button>
                  <button
                    type="button"
                    className="tf-button-secondary !min-h-9 !px-3 text-xs"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(content.replace(/^## /gm, ""));
                        notify({ message: "Đã sao chép biên bản.", tone: "success" });
                      } catch {
                        notify({ message: "Trình duyệt không cho sao chép.", tone: "error" });
                      }
                    }}
                  >
                    <Copy size={14} aria-hidden="true" />
                    Sao chép
                  </button>
                  {enabled && recap?.transcript && (
                    <button
                      type="button"
                      disabled={pending}
                      className="tf-button-secondary !min-h-9 !px-3 text-xs"
                      onClick={() => {
                        if (window.confirm("Viết lại biên bản bằng AI? Những chỗ bạn đã sửa tay sẽ mất.")) {
                          run(() => regenerateMeetingRecap(meetingId));
                        }
                      }}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                      Viết lại
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    className="tf-button-primary !min-h-9 !px-3 text-xs"
                    onClick={() => {
                      const again = recap?.sentAt ? " lại" : "";
                      if (window.confirm(`Gửi${again} biên bản cho người tham dự? Họ sẽ nhận thông báo và email.`)) {
                        run(() => sendMeetingRecap(meetingId));
                      }
                    }}
                  >
                    <Send size={14} aria-hidden="true" />
                    {recap?.sentAt ? "Gửi lại" : "Gửi cho người tham dự"}
                  </button>
                </>
              )}
            </div>
          </div>

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={Math.min(30, Math.max(12, draft.split("\n").length + 2))}
                className="tf-field w-full font-mono text-sm leading-6"
                aria-label="Nội dung biên bản"
              />
              <p className="text-xs text-zinc-500">
                Dòng bắt đầu bằng “## ” là tiêu đề, dòng bắt đầu bằng “- ” là gạch đầu dòng.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  className="tf-button-primary"
                  onClick={() => run(() => saveMeetingRecapContent(meetingId, draft), () => setEditing(false))}
                >
                  Lưu
                </button>
                <button type="button" className="tf-button-secondary" onClick={() => setEditing(false)}>
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <RecapContent content={content} />
          )}

          {recap?.transcript && (
            <details className="mt-6 border-t border-zinc-100 pt-4">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                Bản chép lời đầy đủ
                {recap.audioSeconds ? ` · ${formatClock(recap.audioSeconds)}` : ""}
                {recap.audioName ? ` · ${recap.audioName}` : ""}
              </summary>
              <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap rounded-[7px] bg-zinc-50 p-3 font-sans text-sm leading-6 text-zinc-700">
                {recap.transcript}
              </pre>
            </details>
          )}
        </section>
      )}

      {!processing && (
        <section className="tf-panel px-5 py-5">
          {canUpload ? (
            content ? (
              <details>
                <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                  Ghi âm hoặc tải file khác để làm lại từ đầu
                </summary>
                <div className="mt-4">
                  <AudioSource
                    meetingId={meetingId}
                    uploadLabel="Chép lời và viết lại biên bản"
                    maxAudioMinutes={maxAudioMinutes}
                    onDone={() => router.refresh()}
                  />
                </div>
              </details>
            ) : (
              <>
                <h2 className="text-base font-semibold text-zinc-950">Tạo biên bản cuộc họp</h2>
                <p className="mb-4 mt-1 text-sm leading-6 text-zinc-500">
                  Ghi âm ngay tại đây hoặc tải file ghi âm có sẵn. AI sẽ chép lời tiếng Việt và viết biên bản gồm
                  tóm tắt, quyết định và việc cần làm. Bạn đọc lại, sửa nếu cần, rồi mới gửi cho người tham dự.
                </p>
                <AudioSource
                  meetingId={meetingId}
                  uploadLabel="Tạo biên bản"
                  maxAudioMinutes={maxAudioMinutes}
                  onDone={() => router.refresh()}
                />
              </>
            )
          ) : (
            !content && (
              <p className="py-4 text-center text-sm text-zinc-500">
                {cancelled
                  ? "Cuộc họp đã bị huỷ."
                  : !enabled
                    ? "Chức năng biên bản họp chưa được cấu hình. Nhờ quản trị viên xem mục Biên bản họp trong DEPLOY.md."
                    : startBlock ?? "Chưa có biên bản."}
              </p>
            )
          )}

          {recap && (
            <div className={`flex justify-end ${canUpload || !content ? "mt-4 border-t border-zinc-100 pt-4" : ""}`}>
              <button
                type="button"
                disabled={pending}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-red-700"
                onClick={() => {
                  if (window.confirm("Xoá biên bản và bản chép lời của cuộc họp này? Không khôi phục được.")) {
                    run(() => deleteMeetingRecap(meetingId), () => setEditing(false));
                  }
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
                Xoá biên bản
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
