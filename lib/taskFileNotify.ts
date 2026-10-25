import { followerIds, notify } from "@/lib/notify";
import type { TASK_FILE_KINDS } from "@/lib/taskFiles";

/** Tệp giao việc → báo người làm; tệp kết quả → báo người giao và người theo dõi. */
export async function notifyTaskFileAdded(
  task: { id: string; title: string; projectId: string; creatorId: string; assigneeId: string | null },
  user: { id: string; name: string },
  kind: (typeof TASK_FILE_KINDS)[number],
  fileName: string
) {
  const recipients = kind === "BRIEF" ? [task.assigneeId] : [task.creatorId, ...(await followerIds(task.id))];
  await notify(
    recipients.filter((id): id is string => Boolean(id) && id !== user.id),
    {
      type: "TASK_UPDATED",
      message:
        kind === "BRIEF"
          ? `${user.name} đính kèm tệp giao việc “${fileName}” vào task “${task.title}”.`
          : `${user.name} đã nộp tệp kết quả “${fileName}” cho task “${task.title}”.`,
      taskId: task.id,
      projectId: task.projectId,
    }
  );
}
