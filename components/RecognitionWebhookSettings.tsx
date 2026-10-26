"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, LockKeyhole, Send, Trash2 } from "lucide-react";
import {
  updateRecognitionWebhook,
  type RecognitionWebhookState,
} from "@/app/actions/recognitions";

const INITIAL_STATE: RecognitionWebhookState = {};

export default function RecognitionWebhookSettings({
  configured,
  source,
  updatedAt,
}: {
  configured: boolean;
  source: "APP" | "ENV" | null;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    updateRecognitionWebhook,
    INITIAL_STATE
  );

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
  }, [router, state.success]);

  return (
    <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8 sm:py-10">
      <div className="flex items-start gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
          <Link2 size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">Kết nối Google Chat</h2>
        </div>
      </div>

      <div
        className={`mt-7 flex items-start gap-3 rounded-[8px] border px-4 py-3.5 ${
          configured
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-zinc-200 bg-zinc-50 text-zinc-700"
        }`}
      >
        <CheckCircle2
          size={19}
          className={configured ? "mt-0.5 shrink-0 text-emerald-600" : "mt-0.5 shrink-0 text-zinc-400"}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <strong className="block text-sm font-semibold">
            {configured ? "Webhook đã được kết nối" : "Chưa kết nối webhook"}
          </strong>
          <span className="mt-0.5 block text-xs leading-5 opacity-75">
            {configured
              ? source === "ENV"
                ? "Đang dùng cấu hình từ máy chủ. Bạn có thể thay thế bằng URL mới tại đây."
                : `URL được che kín và mã hóa${updatedAt ? ` · Cập nhật ${updatedAt}` : ""}.`
              : "Dán URL incoming webhook của Google Chat để bắt đầu."}
          </span>
        </div>
      </div>

      <form ref={formRef} action={formAction} className="mt-7 space-y-5">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-zinc-800">
            URL webhook Google Chat
          </span>
          <input
            type="password"
            name="webhookUrl"
            autoComplete="off"
            spellCheck={false}
            className="tf-field font-mono text-xs"
            placeholder={configured ? "Dán URL mới để thay thế kết nối hiện tại" : "https://chat.googleapis.com/v1/spaces/…"}
          />
          <span className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-zinc-500">
            <LockKeyhole size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            URL được kiểm tra trước, mã hóa khi lưu và không hiển thị lại trên trình duyệt.
          </span>
        </label>

        {state.error && (
          <p role="alert" className="rounded-[7px] bg-red-50 px-3.5 py-3 text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.success && (
          <p role="status" className="rounded-[7px] bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
            {state.success}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-5">
          <div>
            {configured && source === "APP" && (
              <button
                type="submit"
                name="intent"
                value="remove"
                className="tf-button-secondary text-red-600 hover:text-red-700"
                disabled={pending}
              >
                <Trash2 size={16} aria-hidden="true" />
                Ngắt kết nối
              </button>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2.5">
            {configured && (
              <button
                type="submit"
                name="intent"
                value="test"
                className="tf-button-secondary"
                disabled={pending}
              >
                <Send size={16} aria-hidden="true" />
                Gửi tin thử
              </button>
            )}
            <button
              type="submit"
              name="intent"
              value="save"
              className="tf-button-primary"
              disabled={pending}
            >
              {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
              {pending ? "Đang kết nối…" : "Lưu và kiểm tra"}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-8 rounded-[8px] border border-zinc-200 px-4 py-4">
        <h3 className="text-sm font-semibold text-zinc-900">Nội dung nào sẽ được gửi?</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-5 text-zinc-500">
          <li>• Chỉ lời cảm ơn “Công khai trong công ty”.</li>
          <li>• Lời cảm ơn riêng tư không bao giờ đi qua webhook.</li>
          <li>• Nếu Google Chat lỗi, lời cảm ơn vẫn được lưu trong ứng dụng.</li>
        </ul>
      </div>
    </div>
  );
}
