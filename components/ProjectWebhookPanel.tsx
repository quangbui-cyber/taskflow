"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Link2, Send, Unplug, Webhook } from "lucide-react";
import {
  disconnectProjectGoogleChatWebhook,
  saveProjectGoogleChatWebhook,
  testProjectGoogleChatWebhook,
} from "@/app/actions/projects";
import { useInteraction } from "@/components/InteractionProvider";

export default function ProjectWebhookPanel({
  projectId,
  configured,
  canManage,
}: {
  projectId: string;
  configured: boolean;
  canManage: boolean;
}) {
  const { notify } = useInteraction();
  const [isConfigured, setIsConfigured] = useState(configured);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isPending, startTransition] = useTransition();

  function showResult(result: { error?: string; success?: string }) {
    setIsError(Boolean(result.error));
    setMessage(result.error ?? result.success ?? "");
    notify({
      message: result.error ?? result.success ?? "Đã cập nhật webhook.",
      tone: result.error ? "error" : "success",
    });
  }

  function saveWebhook() {
    startTransition(async () => {
      const result = await saveProjectGoogleChatWebhook(projectId, webhookUrl);
      showResult(result);
      if ("success" in result && result.success) {
        setIsConfigured(true);
        setWebhookUrl("");
      }
    });
  }

  function testWebhook() {
    startTransition(async () => {
      showResult(await testProjectGoogleChatWebhook(projectId));
    });
  }

  function disconnectWebhook() {
    if (!window.confirm("Ngắt kết nối Google Chat khỏi dự án này?")) return;
    startTransition(async () => {
      const result = await disconnectProjectGoogleChatWebhook(projectId);
      showResult(result);
      if ("success" in result && result.success) setIsConfigured(false);
    });
  }

  if (!canManage) {
    return (
      <section className="tf-panel mx-auto w-full max-w-3xl p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <Webhook size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-zinc-950">Thông báo vào Google Chat (webhook)</h2>
            <p className="text-sm text-zinc-500">
              Chỉ chủ dự án hoặc admin được cấu hình webhook.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="tf-panel mx-auto w-full max-w-3xl overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <Webhook size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-zinc-950">Thông báo vào Google Chat (webhook)</h2>
            <p className="text-sm text-zinc-500">
              Gửi thông báo của dự án vào một Space riêng.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2
            size={17}
            className={isConfigured ? "text-brand-700" : "text-zinc-300"}
            aria-hidden="true"
          />
          <span className={isConfigured ? "font-medium text-zinc-800" : "text-zinc-500"}>
            {isConfigured ? "Đã kết nối Google Chat" : "Chưa kết nối"}
          </span>
        </div>

        <div>
          <label htmlFor="google-chat-webhook-url" className="text-sm font-medium text-zinc-700">
            URL webhook của Space
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Link2
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                id="google-chat-webhook-url"
                type="password"
                value={webhookUrl}
                onChange={(event) => setWebhookUrl(event.target.value)}
                placeholder={isConfigured ? "Dán URL mới để thay đổi" : "https://chat.googleapis.com/..."}
                autoComplete="off"
                className="tf-field w-full font-mono text-xs"
                style={{ paddingLeft: "2.25rem" }}
              />
            </div>
            <button
              type="button"
              className="tf-button-primary"
              onClick={saveWebhook}
              disabled={isPending || !webhookUrl.trim()}
              aria-busy={isPending}
            >
              {isPending && <span className="tf-spinner" aria-hidden="true" />}
              {isPending ? "Đang lưu..." : "Lưu webhook"}
            </button>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            URL được giữ kín. Tin nhắn gồm trạng thái, người được giao và link mở job.
          </p>
        </div>

        {isConfigured && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
            <button
              type="button"
              className="tf-button-secondary"
              onClick={testWebhook}
              disabled={isPending}
            >
              <Send size={16} aria-hidden="true" />
              Gửi thử
            </button>
            <button
              type="button"
              className="tf-button-secondary text-red-600 hover:text-red-700"
              onClick={disconnectWebhook}
              disabled={isPending}
            >
              <Unplug size={16} aria-hidden="true" />
              Ngắt kết nối
            </button>
          </div>
        )}

        {message && (
          <p className={`text-sm ${isError ? "text-red-600" : "text-brand-800"}`}>
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
