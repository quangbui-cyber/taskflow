"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Building2, Plus, X } from "lucide-react";
import { createProjectClient } from "@/app/actions/catalog";
import { CLIENT_NAME_MAX_LENGTH } from "@/lib/clientCatalog";
import { useInteraction } from "@/components/InteractionProvider";
import type { ClientOption } from "@/components/ClientSelect";

export default function QuickClientCreator({
  suggestedName = "",
  disabled = false,
  onCreated,
}: {
  suggestedName?: string;
  disabled?: boolean;
  onCreated: (client: ClientOption) => void;
}) {
  const { notify } = useInteraction();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  function openModal() {
    setName(suggestedName);
    setError("");
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function submit() {
    if (pending) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await createProjectClient(name);
        if (result.error || !result.client) {
          const message = result.error ?? "Không thể tạo Client lúc này.";
          setError(message);
          notify({ message, tone: "error" });
          return;
        }

        onCreated(result.client);
        notify({
          message: result.success ?? `Đã chọn Client "${result.client.name}".`,
          tone: "success",
        });
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      } catch {
        const message = "Không thể tạo Client lúc này. Vui lòng thử lại.";
        setError(message);
        notify({ message, tone: "error" });
      }
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={openModal}
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-[7px] px-2 text-xs font-medium text-brand-800 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={14} aria-hidden="true" />
        Tạo khách hàng mới
      </button>

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
          onClick={close}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
            if (event.key === "Enter" && event.target === inputRef.current) {
              event.preventDefault();
              submit();
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-client-title"
            aria-describedby="quick-client-description"
            onClick={(event) => event.stopPropagation()}
            className="tf-modal-enter my-auto w-full max-w-md space-y-5 rounded-[10px] border border-zinc-200 bg-white p-5 shadow-xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-800">
                  <Building2 size={19} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="quick-client-title" className="font-semibold text-zinc-900">
                    Tạo khách hàng mới
                  </h2>
                  <p id="quick-client-description" className="mt-1 text-xs leading-5 text-zinc-500">
                    Client mới sẽ được thêm vào danh mục và tự động chọn cho dự án này.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={close}
                className="tf-icon-button !h-9 !min-h-9 !w-9"
                aria-label="Đóng"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <label className="block" htmlFor="quick-client-name">
              <span className="tf-label">Tên khách hàng</span>
              <input
                ref={inputRef}
                id="quick-client-name"
                type="text"
                value={name}
                maxLength={CLIENT_NAME_MAX_LENGTH}
                disabled={pending}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
                autoComplete="organization"
                placeholder="Ví dụ: Ngân hàng ABC"
                className="tf-field mt-1"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "quick-client-error" : undefined}
              />
            </label>

            {error && (
              <p id="quick-client-error" role="alert" className="rounded-[7px] bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={close}
                className="tf-button-secondary"
              >
                Huỷ
              </button>
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={submit}
                className="tf-button-primary"
                aria-busy={pending}
              >
                {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                {pending ? "Đang tạo..." : "Tạo và chọn"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
