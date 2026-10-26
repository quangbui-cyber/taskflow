"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, MessagesSquare, Send, Unlink, UserPlus } from "lucide-react";
import {
  addMissingChatMembers,
  createProjectChatSpace,
  testProjectChat,
  unlinkProjectChatSpace,
  type ProjectChatState,
} from "@/app/actions/projectChat";
import { GOOGLE_RESULT } from "@/components/GoogleConnectionCard";
import { useInteraction } from "@/components/InteractionProvider";

export default function ProjectChatSpacePanel({
  projectId,
  space,
  canManage,
  canUnlink,
  viewerConnected,
  configured,
  googleResult,
  chatAppReady,
  chatAppProblem = null,
  legacyWebhook,
}: {
  projectId: string;
  space: { uri: string; creatorName: string | null } | null;
  memberCount: number;
  canManage: boolean;
  canUnlink: boolean;
  /** Người xem đã kết nối Google và cho phép tạo nhóm Chat. */
  viewerConnected: boolean;
  configured: boolean;
  googleResult: string | null;
  /** Máy chủ đã cài Chat app "myCreative" để gửi thông báo vào nhóm. */
  chatAppReady: boolean;
  /** Lý do Chat app chưa dùng được (vd khoá dán sai), hiện cho người cài đặt. */
  chatAppProblem?: string | null;
  /** Dự án cũ còn gửi thông báo qua webhook (chưa tạo nhóm từ app). */
  legacyWebhook: boolean;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const banner = googleResult ? GOOGLE_RESULT[googleResult] : null;
  const connectHref = `/api/google/gmail/connect?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=webhook`)}`;

  function run(action: () => Promise<ProjectChatState>) {
    startTransition(async () => {
      const result = await action();
      notify({ message: result.error ?? result.success ?? "Đã cập nhật.", tone: result.error ? "error" : "success" });
      router.refresh();
    });
  }

  return (
    <section className="tf-panel mx-auto w-full max-w-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <MessagesSquare size={20} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-zinc-950">Nhóm Google Chat của dự án</h2>
            {space && (
              <p className="text-sm text-zinc-500">
                {`Đã có nhóm${space.creatorName ? `, do ${space.creatorName} tạo` : ""}.`}
              </p>
            )}
          </div>
        </div>
        {space && (
          <a href={space.uri} target="_blank" rel="noopener noreferrer" className="tf-button-primary">
            <ExternalLink size={16} aria-hidden="true" />
            Mở nhóm Chat
          </a>
        )}
      </div>

      {legacyWebhook && !space && (
        <p className="mt-4 rounded-[8px] bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Dự án đang nhận thông báo qua webhook cũ. Tạo nhóm Google Chat để chuyển sang cách mới; webhook cũ sẽ tự bỏ.
        </p>
      )}
      {space && !chatAppReady && (
        <p className="mt-4 rounded-[8px] bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Nhóm chưa nhận được thông báo task: {chatAppProblem ?? "máy chủ chưa cài Chat app."} Nhờ quản trị viên xem mục
          Google Chat trong DEPLOY.md.
        </p>
      )}

      {banner && googleResult !== "connected" && (
        <p role="status" className="mt-4 rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-800">
          {banner.text}
        </p>
      )}

      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
          {!space &&
            (viewerConnected ? (
              <button
                type="button"
                disabled={pending}
                aria-busy={pending}
                onClick={() => run(() => createProjectChatSpace(projectId))}
                className="tf-button-primary"
              >
                {pending ? <span className="tf-spinner" aria-hidden="true" /> : <MessagesSquare size={16} aria-hidden="true" />}
                Tạo nhóm Google Chat
              </button>
            ) : configured ? (
              <div className="space-y-2">
                <a href={connectHref} className="tf-button-primary inline-flex">
                  <Link2 size={16} aria-hidden="true" />
                  Kết nối Google
                </a>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Chức năng Google chưa được cấu hình trên máy chủ này.</p>
            ))}
          {space && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => addMissingChatMembers(projectId))}
              className="tf-button-secondary"
            >
              <UserPlus size={16} aria-hidden="true" />
              Thêm người còn thiếu
            </button>
          )}
          {space && chatAppReady && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => testProjectChat(projectId))}
              className="tf-button-secondary"
            >
              <Send size={16} aria-hidden="true" />
              Gửi tin thử
            </button>
          )}
          {space && !viewerConnected && configured && (
            <a href={connectHref} className="tf-button-secondary">
              <Link2 size={16} aria-hidden="true" />
              Kết nối Google
            </a>
          )}
          {space && canUnlink && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (!confirm("Bỏ liên kết nhóm Chat khỏi dự án? Nhóm trong Google Chat vẫn giữ nguyên.")) return;
                run(() => unlinkProjectChatSpace(projectId));
              }}
              className="tf-button-secondary"
            >
              <Unlink size={16} aria-hidden="true" />
              Bỏ liên kết
            </button>
          )}
        </div>
      )}
    </section>
  );
}
