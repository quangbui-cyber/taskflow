"use client";

import { useRouter } from "next/navigation";
import TaskModal from "@/components/TaskModal";
import CrmDialog from "./CrmDialog";
import { taskStatusLabel, type TaskDTO, type MemberDTO } from "@/lib/types";

export default function CrmTaskDialog({ task, members, currentUserId, closeHref, canEdit, canDelete, canAssign }: {
  task: TaskDTO; members: MemberDTO[]; currentUserId: string; closeHref: string; canEdit: boolean; canDelete: boolean; canAssign: boolean;
}) {
  const router = useRouter();
  const close = () => router.replace(closeHref, { scroll: false });
  if (canEdit) return <TaskModal task={task} members={members} currentUserId={currentUserId} onClose={close} canDelete={canDelete} canAssign={canAssign} />;
  return <CrmDialog open title={task.title} onClose={close}>
    <div className="space-y-4 text-sm"><p className="text-zinc-500">{taskStatusLabel(task.status)}{task.dueDate ? ` · ${new Date(task.dueDate).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : ""}</p>
      {task.description && <p className="whitespace-pre-wrap break-words">{task.description}</p>}
      {task.result && <div><h3 className="mb-2 font-semibold">Kết quả công việc</h3><p className="whitespace-pre-wrap break-words">{task.result}</p></div>}
      {task.files.length > 0 && <ul className="space-y-2">{task.files.map((file) => <li key={file.id}><a href={file.driveUrl ?? `/api/tasks/${task.id}/files/${file.id}`} className="text-brand-700 hover:underline">{file.name}</a></li>)}</ul>}
      <section><h3 className="mb-3 font-semibold">Bình luận ({task.comments.length})</h3><ul className="space-y-3">{task.comments.map((comment) => <li key={comment.id}><p className="mb-1 text-xs text-zinc-500">{comment.author.name}</p><p className="whitespace-pre-wrap break-words">{comment.body}</p></li>)}</ul></section>
    </div>
  </CrmDialog>;
}
