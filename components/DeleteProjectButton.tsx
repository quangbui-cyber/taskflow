"use client";

import { Trash2 } from "lucide-react";
import { deleteProject } from "@/app/actions/projects";
import { useInteraction } from "@/components/InteractionProvider";

export default function DeleteProjectButton({
  projectId,
}: {
  projectId: string;
}) {
  const { notify } = useInteraction();
  return (
    <button
      onClick={() => {
        if (confirm("Xoá project này? Tất cả task và bình luận sẽ mất vĩnh viễn.")) {
          void deleteProject(projectId).then(result => {
            if (result?.error) notify({ message: result.error, tone: "error" });
          }).catch(() => notify({ message: "Không thể xoá dự án. Hãy thử lại.", tone: "error" }));
        }
      }}
      className="tf-button-danger"
    >
      <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className="hidden sm:inline">Xoá dự án</span>
    </button>
  );
}
