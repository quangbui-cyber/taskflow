"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  message: string;
  tone?: ToastTone;
  duration?: number;
};

type ToastItem = Required<ToastInput> & { id: number };

type InteractionContextValue = {
  notify: (input: ToastInput | string) => void;
};

const InteractionContext = createContext<InteractionContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-white text-zinc-800",
  error: "border-red-200 bg-white text-zinc-800",
  info: "border-blue-200 bg-white text-zinc-800",
};

const ICON_STYLES: Record<ToastTone, string> = {
  success: "text-emerald-600",
  error: "text-red-600",
  info: "text-blue-600",
};

function ToastIcon({ tone }: { tone: ToastTone }) {
  const className = `mt-0.5 shrink-0 ${ICON_STYLES[tone]}`;
  if (tone === "error") {
    return <AlertCircle size={18} className={className} aria-hidden="true" />;
  }
  if (tone === "info") {
    return <Info size={18} className={className} aria-hidden="true" />;
  }
  return <CheckCircle2 size={18} className={className} aria-hidden="true" />;
}

export default function InteractionProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (input: ToastInput | string) => {
      const normalized = typeof input === "string" ? { message: input } : input;
      const message = normalized.message.trim();
      if (!message) return;

      const id = ++nextId.current;
      const toast: ToastItem = {
        id,
        message,
        tone: normalized.tone ?? "success",
        duration: normalized.duration ?? 3200,
      };

      setToasts((current) => [...current.slice(-2), toast]);
      timers.current.set(id, setTimeout(() => dismiss(id), toast.duration));
    },
    [dismiss]
  );

  useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <InteractionContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-3 bottom-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`tf-toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-[8px] border px-3.5 py-3 shadow-lg ${TONE_STYLES[toast.tone]}`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <ToastIcon tone={toast.tone} />
            <p className="min-w-0 flex-1 text-sm font-medium leading-5">
              {toast.message}
            </p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              aria-label="Đóng thông báo"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </InteractionContext.Provider>
  );
}

export function useInteraction() {
  const context = useContext(InteractionContext);
  if (!context) {
    throw new Error("useInteraction must be used inside InteractionProvider");
  }
  return context;
}

export function useActionFeedback(state: { error?: string; success?: string }) {
  const { notify } = useInteraction();
  const previousState = useRef(state);

  useEffect(() => {
    if (previousState.current === state) return;
    previousState.current = state;
    if (state.error) notify({ message: state.error, tone: "error" });
    else if (state.success) notify({ message: state.success, tone: "success" });
  }, [notify, state]);
}
