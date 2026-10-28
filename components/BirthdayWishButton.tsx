"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Heart, X } from "lucide-react";
import {
  createRecognition,
  type RecognitionActionState,
} from "@/app/actions/recognitions";
import Confetti from "@/components/Confetti";
import { useActionFeedback } from "@/components/InteractionProvider";
import { BIRTHDAY_RECOGNITION_CATEGORY } from "@/lib/recognitions";

const INITIAL_STATE: RecognitionActionState = {};

/** Nút gửi lời chúc sinh nhật; lời chúc hiện trong Góc cảm ơn, không trừ sao tuần. */
export default function BirthdayWishButton({
  recipientId,
  recipientName,
  defaultMessage,
  alreadyWished,
  size = "md",
}: {
  recipientId: string;
  recipientName: string;
  defaultMessage: string;
  alreadyWished: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(defaultMessage);
  const [state, formAction, pending] = useActionState(
    createRecognition,
    INITIAL_STATE
  );
  useActionFeedback(state);

  useEffect(() => {
    if (!state.success) return;
    router.refresh();
    const frame = window.requestAnimationFrame(() => setOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [router, state]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, pending]);

  const sizeClass = size === "sm" ? "h-8 px-3" : "h-10 px-[18px]";
  const textClass = size === "sm" ? "text-xs" : "text-sm";

  if (alreadyWished || state.success) {
    return (
      <span
        className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-100 font-semibold text-brand-800 ${sizeClass} ${textClass}`}
      >
        {/* Vừa gửi xong: bung pháo giấy nhỏ quanh nút. */}
        {state.success && <Confetti variant="burst" count={14} />}
        <Check size={size === "sm" ? 13 : 16} aria-hidden="true" />
        Đã chúc
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex shrink-0 items-center rounded-full bg-brand-400 text-zinc-950 transition-colors hover:bg-brand-300 ${sizeClass}`}
      >
        {/* globals.css đặt font: inherit cho button, nên cỡ/độ đậm chữ đặt ở thẻ con. */}
        <span className={`inline-flex items-center gap-1.5 font-bold ${textClass}`}>
          <Heart size={size === "sm" ? 13 : 16} aria-hidden="true" />
          {size === "sm" ? "Chúc mừng" : "Gửi lời chúc"}
        </span>
      </button>

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={`birthday-wish-${recipientId}`}
            className="tf-modal-enter w-full max-w-md rounded-[14px] border border-zinc-200 bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <h2
                id={`birthday-wish-${recipientId}`}
                className="text-lg font-semibold text-zinc-900"
              >
                Chúc mừng sinh nhật {recipientName}
              </h2>
              <button
                type="button"
                className="tf-icon-button shrink-0"
                onClick={() => setOpen(false)}
                disabled={pending}
                aria-label="Đóng"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>
            <form action={formAction} className="space-y-4 px-5 py-5">
              <input type="hidden" name="recipientId" value={recipientId} />
              <input
                type="hidden"
                name="category"
                value={BIRTHDAY_RECOGNITION_CATEGORY}
              />
              <input type="hidden" name="visibility" value="COMPANY" />
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-zinc-800">
                  Lời chúc
                </span>
                <textarea
                  autoFocus
                  name="message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={500}
                  required
                  className="tf-field min-h-28 resize-y leading-6"
                />
              </label>
              <p className="text-xs text-zinc-600">
                Lời chúc hiện trong Kudos Wall cho cả công ty và không trừ sao
                của tuần.
              </p>
              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  className="tf-button-secondary"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Để sau
                </button>
                <button
                  type="submit"
                  className="tf-button-primary"
                  disabled={pending || message.trim().length < 2}
                  aria-busy={pending}
                >
                  {pending ? (
                    <span className="tf-spinner" aria-hidden="true" />
                  ) : (
                    <Heart size={16} aria-hidden="true" />
                  )}
                  {pending ? "Đang gửi…" : "Gửi lời chúc"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
