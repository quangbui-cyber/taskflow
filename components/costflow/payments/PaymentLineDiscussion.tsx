"use client";

import { useState } from "react";
import ActionForm from "@/components/CostFlowActionForm";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import type { Finance } from "@/components/CostFlowPanel";

type Discussion = { id: string; lineId: string; authorId: string; body: string; createdAt: string; author: { name: string } };

export function PaymentLineDiscussion({ finance, requestId, lineId, discussions }: { finance: Finance; requestId: string; lineId: string; discussions: Discussion[] }) {
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const members = finance.project.members.map(member => finance.users.find(user => user.id === member.userId)).filter((user): user is Finance["users"][number] => !!user);
  const toggle = (userId: string) => setMentionIds(current => current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]);
  return <details className="tf-payment-line-discussion rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
    <summary className="cursor-pointer text-xs font-semibold">Trao đổi về khoản này ({discussions.length})</summary>
    <div className="mt-3 space-y-3">
      {discussions.length > 0 && <ol className="space-y-2">
        {discussions.map(discussion => <li key={discussion.id} className="rounded-lg bg-[var(--surface-soft)] p-2 text-xs">
          <div className="flex flex-wrap justify-between gap-2 text-[var(--text-secondary)]"><strong className="text-[var(--foreground)]">{discussion.author.name}</strong><time>{new Date(discussion.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</time></div>
          <p className="mt-1 whitespace-pre-wrap">{discussion.body}</p>
        </li>)}
      </ol>}
      <ActionForm finance={finance} command="ADD_PAYMENT_LINE_DISCUSSION" requestId={requestId} label="Gửi trao đổi">
        <input type="hidden" name="lineId" value={lineId} />
        <input type="hidden" name="mentionIds" value={JSON.stringify(mentionIds)} />
        <Textarea name="body" label="Nội dung trao đổi" required hint="Trao đổi được gắn vào đúng phiên bản khoản; không phải quyết định duyệt." />
        {members.length > 0 && <fieldset className="space-y-2"><legend className="text-xs font-medium">Nhắc thành viên Project (tùy chọn)</legend><div className="flex flex-wrap gap-2">{members.map(member => <Button key={member.id} type="button" size="sm" variant={mentionIds.includes(member.id) ? "primary" : "secondary"} onClick={() => toggle(member.id)}>{member.name}</Button>)}</div></fieldset>}
      </ActionForm>
    </div>
  </details>;
}
