"use client";

import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Link2, MessagesSquare, MoreHorizontal, Send, Unlink, UserPlus } from "lucide-react";
import {
  addMissingChatMembers,
  createProjectChatSpace,
  testProjectChat,
  unlinkProjectChatSpace,
  type ProjectChatState,
} from "@/app/actions/projectChat";
import { GOOGLE_RESULT } from "@/components/GoogleConnectionCard";
import { useInteraction } from "@/components/InteractionProvider";

const menuItem =
  "flex min-h-9 w-full items-center gap-2 rounded-[6px] px-2.5 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50";

/**
 * Nút Nhóm Chat ở đầu trang dự án. Chưa có nhóm: bấm một lần để tạo (chưa kết nối Google thì tự
 * kết nối rồi tạo luôn khi quay lại). Có nhóm: bấm để mở thẳng nhóm; việc ít dùng nằm trong menu "⋯".
 */
export default function ProjectChatButton({
  projectId,
  space,
  canManage,
  canUnlink,
  viewerConnected,
  configured,
  chatAppReady,
  chatAppProblem,
  autoCreate,
  googleResult,
}: {
  projectId: string;
  space: { uri: string } | null;
  canManage: boolean;
  canUnlink: boolean;
  /** Người xem đã kết nối Google và cho phép tạo nhóm Chat. */
  viewerConnected: boolean;
  configured: boolean;
  chatAppReady: boolean;
  chatAppProblem: string | null;
  /** Vừa quay về sau khi kết nối Google: tạo nhóm luôn. */
  autoCreate: boolean;
  googleResult: string | null;
}) {
  const router = useRouter();
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const projectPath = `/projects/${projectId}`;
  const connectHref = `/api/google/gmail/connect?returnTo=${encodeURIComponent(`${projectPath}?chat=create`)}`;

  function run(action: () => Promise<ProjectChatState>) {
    startTransition(async () => {
      const result = await action();
      notify({ message: result.error ?? result.success ?? "Đã cập nhật.", tone: result.error ? "error" : "success" });
      router.refresh();
    });
  }

  // Quay về từ trang kết nối Google: báo lỗi nếu có, hoặc tạo nhóm luôn, rồi dọn địa chỉ.
  const finishConnect = useEffectEvent(() => {
    const failure = googleResult && googleResult !== "connected" ? GOOGLE_RESULT[googleResult] : null;
    if (failure) notify({ message: failure.text, tone: "error" });
    else if (autoCreate && canManage && !space && viewerConnected) run(() => createProjectChatSpace(projectId));
    else if (autoCreate && !viewerConnected) notify({ message: GOOGLE_RESULT.denied.text, tone: "error" });
    router.replace(projectPath, { scroll: false });
  });
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current || (!autoCreate && !googleResult)) return;
    handledReturn.current = true;
    const id = setTimeout(() => finishConnect(), 0);
    return () => clearTimeout(id);
  }, [autoCreate, googleResult]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!space) {
    if (!canManage || !configured) return null;
    const createClass = "tf-button-primary !min-h-9 !px-3 !py-1.5 text-sm";
    // Chưa kết nối Google: đi qua trang kết nối, quay về là tự tạo nhóm.
    if (!viewerConnected) {
      return (
        <a href={connectHref} className={createClass}>
          <MessagesSquare size={15} strokeWidth={1.8} aria-hidden="true" />
          Tạo nhóm Chat
        </a>
      );
    }
    return (
      <button
        type="button"
        onClick={() => run(() => createProjectChatSpace(projectId))}
        disabled={pending}
        aria-busy={pending}
        className={createClass}
      >
        {pending ? <span className="tf-spinner" aria-hidden="true" /> : <MessagesSquare size={15} strokeWidth={1.8} aria-hidden="true" />}
        {pending ? "Đang tạo nhóm…" : "Tạo nhóm Chat"}
      </button>
    );
  }

  const hasMenu = canManage || canUnlink;
  const needsConnect = canManage && configured && !viewerConnected;

  return (
    <div ref={rootRef} className="relative flex items-center">
      <a
        href={space.uri}
        target="_blank"
        rel="noopener noreferrer"
        className={`tf-button-secondary !min-h-9 !px-3 !py-1.5 text-sm ${hasMenu ? "!rounded-r-none" : ""}`}
      >
        <MessagesSquare size={15} strokeWidth={1.8} aria-hidden="true" />
        Nhóm Chat
        <ExternalLink size={13} className="text-zinc-400" aria-hidden="true" />
      </a>

      {hasMenu && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="tf-icon-button relative !h-9 !min-h-9 !w-8 !rounded-l-none !border-zinc-300 -ml-px"
            aria-label="Thao tác khác với nhóm Chat"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-busy={pending}
            title="Thao tác khác"
          >
            {pending ? <span className="tf-spinner" aria-hidden="true" /> : <MoreHorizontal size={18} aria-hidden="true" />}
            {!chatAppReady && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
            )}
          </button>

          {open && (
            <div
              role="menu"
              className="tf-popover-enter absolute right-0 top-11 z-50 w-60 rounded-[8px] border border-zinc-200 bg-white p-1.5 shadow-xl"
            >
              {!chatAppReady && (
                <p role="status" className="mb-1 rounded-[6px] bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                  {chatAppProblem ?? "Máy chủ chưa cài Chat app nên nhóm chưa nhận được thông báo task."}
                </p>
              )}
              {needsConnect && (
                <a role="menuitem" href={connectHref} className={menuItem}>
                  <Link2 size={15} aria-hidden="true" />
                  Kết nối Google
                </a>
              )}
              {canManage && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    run(() => addMissingChatMembers(projectId));
                  }}
                  className={menuItem}
                >
                  <UserPlus size={15} aria-hidden="true" />
                  Thêm người còn thiếu
                </button>
              )}
              {canManage && chatAppReady && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    run(() => testProjectChat(projectId));
                  }}
                  className={menuItem}
                >
                  <Send size={15} aria-hidden="true" />
                  Gửi tin thử
                </button>
              )}
              {canUnlink && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    if (!window.confirm("Bỏ liên kết nhóm Chat khỏi dự án? Nhóm trong Google Chat vẫn giữ nguyên.")) return;
                    run(() => unlinkProjectChatSpace(projectId));
                  }}
                  className={`${menuItem} !text-red-600 hover:!bg-red-50`}
                >
                  <Unlink size={15} aria-hidden="true" />
                  Bỏ liên kết
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
