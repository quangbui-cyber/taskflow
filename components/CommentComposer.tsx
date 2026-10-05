"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Send } from "lucide-react";
import { addComment, type ActionState } from "@/app/actions/tasks";
import { mentionQuery, updateCommentMentions, type CommentMention } from "@/lib/commentMentions";
import type { MemberDTO } from "@/lib/types";
import Avatar from "@/components/Avatar";
import { useInteraction } from "@/components/InteractionProvider";

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

export default function CommentComposer({ taskId, members }: { taskId: string; members: MemberDTO[] }) {
  const { notify } = useInteraction();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState<CommentMention[]>([]);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    const response = await addComment(previous, formData);
    if (response.error) {
      notify({ message: response.error, tone: "error" });
    } else {
      setBody("");
      setMentions([]);
      setCaret(0);
      notify({ message: "Đã gửi bình luận.", tone: "success" });
    }
    return response;
  }, {});

  const query = mentionQuery(body, caret);
  const open = !dismissed && query && !mentions.some((mention) => query.start >= mention.start && query.start < mention.end);
  const options = open
    ? members.filter((member) => member.user.isActive !== false && normalize(`${member.user.name} ${member.user.email}`).includes(normalize(query.query))).slice(0, 8)
    : [];
  const selectedIndex = Math.min(activeIndex, Math.max(0, options.length - 1));

  function choose(member: MemberDTO) {
    if (!query) return;
    const text = `@${member.user.name}`;
    const next = body.slice(0, query.start) + text + " " + body.slice(query.end);
    const updated = updateCommentMentions(body, next, mentions);
    setMentions([...updated, { userId: member.userId, name: member.user.name, start: query.start, end: query.start + text.length }]);
    setBody(next);
    const nextCaret = query.start + text.length + 1;
    setCaret(nextCaret);
    setDismissed(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="mentions" value={JSON.stringify(mentions)} />
      <div className="relative">
        <textarea
          ref={inputRef}
          name="body"
          value={body}
          required
          maxLength={5000}
          rows={2}
          disabled={pending}
          aria-label="Bình luận task"
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && options.length ? `${listId}-${selectedIndex}` : undefined}
          placeholder="Viết bình luận… Gõ @ để nhắc đồng đội"
          className="tf-field w-full resize-y"
          onChange={(event) => {
            const next = event.target.value;
            setMentions(updateCommentMentions(body, next, mentions));
            setBody(next);
            setCaret(event.target.selectionStart);
            setDismissed(false);
            setActiveIndex(0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onBlur={() => setDismissed(true)}
          onKeyDown={(event) => {
            if (!open || event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(true);
            } else if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setActiveIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
            } else if (options.length && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault();
              choose(options[selectedIndex]);
            }
          }}
        />
        {open && (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-full max-w-sm overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-lg">
            <p className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-500">Nhắc thành viên dự án</p>
            <ul id={listId} role="listbox" aria-label="Người có thể nhắc" className="max-h-56 overflow-y-auto">
              {options.map((member, index) => (
                <li key={member.userId}>
                  <button
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${index === selectedIndex ? "bg-brand-50" : "hover:bg-zinc-50"}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(member)}
                  >
                    <Avatar id={member.userId} name={member.user.name} avatarUrl={member.user.avatarUrl} className="h-8 w-8 shrink-0 text-xs" />
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-medium text-zinc-800">{member.user.name}</strong>
                      <span className="block truncate text-xs text-zinc-500">{member.user.email}</span>
                    </span>
                  </button>
                </li>
              ))}
              {!options.length && <li className="px-3 py-3 text-xs text-zinc-500">Không tìm thấy thành viên phù hợp.</li>}
            </ul>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">Chọn người từ danh sách @ để gửi thông báo cho họ.</p>
        <button type="submit" disabled={pending || !body.trim()} className="tf-button-primary shrink-0" aria-busy={pending}>
          {pending ? <span className="tf-spinner" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          {pending ? "Đang gửi…" : "Gửi"}
        </button>
      </div>
      {state.error && <p role="alert" className="text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
