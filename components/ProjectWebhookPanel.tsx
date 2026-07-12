"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Copy, RefreshCw, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { regenerateProjectWebhookToken } from "@/app/actions/projects";

export default function ProjectWebhookPanel({
  projectId,
  webhookToken,
  canManage,
  baseUrl,
}: {
  projectId: string;
  webhookToken: string;
  canManage: boolean;
  baseUrl: string;
}) {
  const router = useRouter();
  const [token, setToken] = useState(webhookToken);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const webhookPath = useMemo(
    () => `/api/webhooks/projects/${projectId}/${token}`,
    [projectId, token]
  );
  const webhookUrl = baseUrl ? `${baseUrl}${webhookPath}` : webhookPath;

  async function copyUrl() {
    await navigator.clipboard.writeText(webhookUrl);
    setMessage("Đã copy webhook.");
  }

  function regenerate() {
    const confirmed = window.confirm(
      "Tạo lại webhook sẽ làm URL cũ ngừng hoạt động. Bạn muốn tiếp tục?"
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await regenerateProjectWebhookToken(projectId);
      if (result.error) {
        setMessage(result.error);
        return;
      }
      if (result.token) {
        setToken(result.token);
        setMessage("Đã tạo webhook mới.");
        router.refresh();
      }
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
            <h2 className="font-semibold text-zinc-950">Webhook</h2>
            <p className="text-sm text-zinc-500">
              Chỉ chủ dự án hoặc admin được xem webhook của dự án này.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="tf-panel mx-auto w-full max-w-4xl overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <Webhook size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-zinc-950">Webhook dự án</h2>
            <p className="text-sm text-zinc-500">
              URL riêng để app khác gửi task mới vào dự án này.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <label htmlFor="project-webhook-url" className="text-sm font-medium text-zinc-700">
            Webhook URL
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="project-webhook-url"
              readOnly
              value={webhookUrl}
              className="tf-field min-w-0 flex-1 font-mono text-xs"
            />
            <button type="button" className="tf-button-secondary" onClick={copyUrl}>
              <Copy size={16} aria-hidden="true" />
              Copy
            </button>
            <button
              type="button"
              className="tf-button-secondary"
              onClick={regenerate}
              disabled={isPending}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Tạo lại
            </button>
          </div>
          {message && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-zinc-500">
              <Check size={14} aria-hidden="true" />
              {message}
            </p>
          )}
        </div>

        <div className="rounded-[8px] border border-zinc-200 bg-zinc-50 p-4">
          <p className="text-sm font-medium text-zinc-700">Dữ liệu mẫu</p>
          <pre className="mt-3 overflow-x-auto rounded-[8px] bg-white p-4 text-xs leading-5 text-zinc-700">
{`POST ${webhookPath}
{
  "title": "Tên task mới",
  "description": "Nội dung công việc",
  "priority": "MEDIUM",
  "dueDate": "2026-07-20T09:00:00+07:00",
  "assigneeEmail": "user@congty.com"
}`}
          </pre>
        </div>
      </div>
    </section>
  );
}
