"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { MessageCircle, Send } from "lucide-react";
import { createProjectWish, retryProjectWishChat, type ProjectWishState } from "@/app/actions/projectWishes";
import Avatar from "@/components/Avatar";

type Wish = {
  id: string;
  body: string;
  time: string;
  sent: boolean;
  author: { id: string; name: string; avatarUrl: string | null };
};

function WishRetry({ wishId }: { wishId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ProjectWishState>({});
  return (
    <div className="mt-1">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        className="min-h-9 text-xs font-semibold text-brand-700 disabled:opacity-60"
        onClick={() => startTransition(async () => {
          try {
            setState(await retryProjectWishChat(wishId));
          } catch {
            setState({ error: "Chưa gửi lại được. Bạn hãy thử lại sau." });
          }
        })}
      >
        {pending ? "Đang gửi lại…" : "Gửi lại vào Google Chat"}
      </button>
      <p role="status" className="text-xs leading-5 text-zinc-600">
        {state.error || state.warning || state.success}
      </p>
    </div>
  );
}

function WishComment({ wish, currentUserId }: { wish: Wish; currentUserId: string }) {
  return (
    <li className="flex gap-2.5">
      <Avatar id={wish.author.id} name={wish.author.name} avatarUrl={wish.author.avatarUrl} className="h-7 w-7 text-[10px]" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5">
          <span className="font-semibold text-zinc-800">{wish.author.name}</span>
          <span className="ml-2 text-zinc-500">{wish.time}</span>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-600">{wish.body}</p>
        {wish.author.id === currentUserId && (
          wish.sent
            ? <p className="mt-0.5 text-[11px] text-zinc-500">Đã gửi vào Google Chat</p>
            : <WishRetry wishId={wish.id} />
        )}
      </div>
    </li>
  );
}

export default function ProjectWishComments({
  projectId, projectName, currentUserId, wishes, count,
}: {
  projectId: string;
  projectName: string;
  currentUserId: string;
  wishes: Wish[];
  count: number;
}) {
  const [body, setBody] = useState("");
  const requestId = useRef<string | null>(null);
  const [state, action, pending] = useActionState(async (previous: ProjectWishState, data: FormData) => {
    requestId.current ??= crypto.randomUUID();
    data.set("requestId", requestId.current);
    try {
      const result = await createProjectWish(previous, data);
      if (result.success) {
        setBody("");
        requestId.current = null;
      }
      return result;
    } catch {
      return { error: "Chưa nhận được phản hồi. Lời chúc vẫn ở đây, bạn hãy thử lại." };
    }
  }, {});

  return (
    <div className="mt-4">
      {wishes.length > 0 && (
        <div className="mb-3">
          <p className="mb-3 text-xs font-semibold text-zinc-500">{count} lời chúc hôm nay</p>
          <ul className="space-y-3">
            {wishes.slice(0, 3).map((wish) => <WishComment key={wish.id} wish={wish} currentUserId={currentUserId} />)}
          </ul>
          {wishes.length > 3 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-2 text-xs font-semibold text-brand-700">
                Xem thêm {wishes.length - 3} lời chúc
              </summary>
              <ul className="mt-2 max-h-72 space-y-3 overflow-y-auto">
                {wishes.slice(3).map((wish) => <WishComment key={wish.id} wish={wish} currentUserId={currentUserId} />)}
              </ul>
            </details>
          )}
          {count > wishes.length && <p className="mt-2 text-xs text-zinc-500">Hiển thị {wishes.length} lời chúc gần nhất.</p>}
        </div>
      )}
      <details>
        <summary className="w-fit cursor-pointer rounded-[10px] px-1 py-2 text-sm font-semibold text-brand-700">
          <span className="inline-flex items-center gap-2"><MessageCircle size={16} aria-hidden="true" />Gửi lời chúc</span>
        </summary>
        <form action={action} className="mt-2 space-y-2.5">
          <input type="hidden" name="projectId" value={projectId} />
          <label className="block">
            <span className="sr-only">Lời chúc cho team {projectName}</span>
            <textarea
              name="body"
              value={body}
              onChange={(event) => { setBody(event.target.value); requestId.current = null; }}
              placeholder="Gửi một lời động viên đến đội mình…"
              required
              minLength={2}
              maxLength={500}
              disabled={pending}
              rows={2}
              className="tf-field resize-y bg-white text-sm leading-6"
            />
          </label>
          <div className="flex justify-end">
            <button type="submit" disabled={pending || body.trim().length < 2} aria-busy={pending} className="tf-button-primary shrink-0">
              <Send size={14} aria-hidden="true" />{pending ? "Đang gửi…" : "Gửi lời chúc"}
            </button>
          </div>
          <p role="status" className="text-xs leading-5 text-zinc-600">{state.error || state.warning || state.success}</p>
        </form>
      </details>
    </div>
  );
}
