"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import {
  addRecognitionComment,
  deleteRecognitionComment,
  type RecognitionCommentState,
} from "@/app/actions/recognitions";
import Avatar from "@/components/Avatar";
import { useActionFeedback } from "@/components/InteractionProvider";
import { RECOGNITION_COMMENT_MAX_LENGTH } from "@/lib/recognitions";

export type RecognitionCommentItem = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
};

const INITIAL_STATE: RecognitionCommentState = {};

const TIME_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  hour12: false,
  timeZone: "Asia/Ho_Chi_Minh",
});

/** Bình luận dưới một lời cảm ơn: danh sách + ô nhập. Mở sẵn khi đã có bình luận. */
export default function RecognitionComments({
  recognitionId,
  comments,
  currentUserId,
  isAdmin,
  defaultOpen = false,
}: {
  recognitionId: string;
  comments: RecognitionCommentItem[];
  currentUserId: string;
  isAdmin: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || comments.length > 0);
  const [state, formAction, pending] = useActionState(addRecognitionComment, INITIAL_STATE);
  const [deleting, startDelete] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-[6px] px-1 py-1 text-xs font-medium text-zinc-600 transition-colors hover:text-brand-700"
      >
        <MessageCircle size={14} aria-hidden="true" />
        {comments.length > 0 ? `${comments.length} bình luận` : "Bình luận"}
      </button>

      {open && (
        <div className="mt-2 max-w-xl space-y-3">
          {comments.length > 0 && (
            <ul className="space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="flex gap-2.5">
                  <Avatar
                    id={comment.author.id}
                    name={comment.author.name}
                    avatarUrl={comment.author.avatarUrl}
                    className="h-8 w-8 text-xs"
                  />
                  <div className="min-w-0 flex-1 rounded-[10px] bg-zinc-50 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <strong className="truncate text-[13px] font-semibold text-zinc-900">
                        {comment.author.name}
                      </strong>
                      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-500">
                        <time dateTime={comment.createdAt}>
                          {TIME_FORMAT.format(new Date(comment.createdAt))}
                        </time>
                        {(comment.author.id === currentUserId || isAdmin) && (
                          <button
                            type="button"
                            disabled={deleting}
                            onClick={() => startDelete(() => deleteRecognitionComment(comment.id))}
                            aria-label="Xoá bình luận"
                            title="Xoá bình luận"
                            className="rounded p-0.5 text-zinc-400 hover:text-red-600 disabled:opacity-50"
                          >
                            <Trash2 size={13} aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-5 text-zinc-700">
                      {comment.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form ref={formRef} action={formAction} className="flex items-end gap-2">
            <input type="hidden" name="recognitionId" value={recognitionId} />
            <textarea
              name="body"
              required
              rows={1}
              maxLength={RECOGNITION_COMMENT_MAX_LENGTH}
              placeholder="Viết bình luận…"
              aria-label="Viết bình luận"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              className="tf-field min-h-10 flex-1 resize-y py-2 text-sm leading-5"
            />
            <button
              type="submit"
              disabled={pending}
              aria-label="Gửi bình luận"
              className="tf-button-primary !min-h-10 shrink-0 px-3"
            >
              <Send size={15} aria-hidden="true" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
