"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Star, X } from "lucide-react";
import {
  createRecognition,
  type RecognitionActionState,
} from "@/app/actions/recognitions";
import { useActionFeedback } from "@/components/InteractionProvider";
import {
  RECOGNITION_CATEGORIES,
  RECOGNITION_VISIBILITIES,
} from "@/lib/recognitions";

type Recipient = {
  id: string;
  name: string;
};

const INITIAL_STATE: RecognitionActionState = {};

export default function RecognitionComposer({
  recipients,
  remainingStars,
  weeklyLimit,
}: {
  recipients: Recipient[];
  remainingStars: number;
  weeklyLimit: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, formAction, pending] = useActionState(
    createRecognition,
    INITIAL_STATE
  );
  useActionFeedback(state);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, pending]);

  useEffect(() => {
    if (!state.success) return;
    formRef.current?.reset();
    router.refresh();
    const frame = window.requestAnimationFrame(() => {
      setMessage("");
      setOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [router, state]);

  return (
    <>
      <button
        type="button"
        className="tf-button-primary min-h-11 px-4"
        onClick={() => setOpen(true)}
        disabled={recipients.length === 0 || remainingStars === 0}
        title={
          remainingStars === 0
            ? "Bạn đã dùng hết số sao của tuần này"
            : `Bạn còn ${remainingStars} ngôi sao trong tuần này`
        }
      >
        <Star size={18} strokeWidth={1.8} aria-hidden="true" />
        <span className="hidden sm:inline">
          {remainingStars === 0 ? "Hết sao tuần này" : "Gửi lời cảm ơn"}
        </span>
        <span className="sm:hidden">{remainingStars === 0 ? "Hết sao" : "Gửi sao"}</span>
        <span className="ml-1 flex items-center gap-1 border-l border-white/30 pl-2 font-semibold tabular-nums">
          {remainingStars}
          <Star size={13} fill="currentColor" aria-hidden="true" />
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
            aria-labelledby="recognition-dialog-title"
            className="tf-modal-enter max-h-[calc(100vh-32px)] w-full max-w-xl overflow-y-auto rounded-[10px] border border-zinc-200 bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-5 border-b border-zinc-200 px-5 py-5 sm:px-6">
              <div>
                <h2 id="recognition-dialog-title" className="text-xl font-semibold text-zinc-900">
                  Gửi lời cảm ơn
                </h2>
                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                  <Star size={13} fill="currentColor" aria-hidden="true" />
                  Còn {remainingStars}/{weeklyLimit} sao trong tuần này
                </span>
              </div>
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

            <form ref={formRef} action={formAction} className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-zinc-800">Gửi đến</span>
                <span className="relative block">
                  <select
                    name="recipientId"
                    className="tf-field appearance-none !pr-12"
                    required
                    defaultValue={recipients[0]?.id}
                  >
                    {recipients.map((recipient) => (
                      <option key={recipient.id} value={recipient.id}>
                        {recipient.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
                    aria-hidden="true"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-zinc-800">Lời cảm ơn</span>
                <span className="relative block">
                  <textarea
                    autoFocus
                    name="message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={500}
                    required
                    placeholder="Viết một lời cảm ơn thật lòng…"
                    className="tf-field min-h-32 resize-y pb-8 leading-6"
                  />
                  <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] text-zinc-400">
                    {message.length}/500
                  </span>
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-zinc-800">Chủ đề</span>
                  <span className="relative block">
                    <select
                      name="category"
                      className="tf-field appearance-none !pr-12"
                      defaultValue="KINDNESS"
                    >
                      {RECOGNITION_CATEGORIES.map((category) => (
                        <option key={category.key} value={category.key}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
                      aria-hidden="true"
                    />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-zinc-800">Ai có thể xem?</span>
                  <span className="relative block">
                    <select
                      name="visibility"
                      className="tf-field appearance-none !pr-12"
                      defaultValue="COMPANY"
                    >
                      {RECOGNITION_VISIBILITIES.map((visibility) => (
                        <option key={visibility.key} value={visibility.key}>
                          {visibility.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
                      aria-hidden="true"
                    />
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-2.5 rounded-[7px] bg-brand-50 px-3.5 py-3 text-sm text-brand-800">
                <Star size={17} fill="currentColor" className="shrink-0 text-brand-500" aria-hidden="true" />
                Gửi lời cảm ơn này sẽ dùng 1 sao · Sau đó bạn còn {Math.max(0, remainingStars - 1)} sao.
              </div>

              <div className="flex justify-end gap-2.5 pt-1">
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
                  {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Star size={17} aria-hidden="true" />}
                  {pending ? "Đang gửi…" : "Gửi một ngôi sao"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
