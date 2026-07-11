"use client";

import { Trash2 } from "lucide-react";
import { deleteProject } from "@/app/actions/projects";

export default function DeleteProjectButton({
  projectId,
}: {
  projectId: string;
}) {
  return (
    <button
      onClick={() => {
        if (confirm("Xoá project này? Tất cả task và bình luận sẽ mất vĩnh viễn.")) {
          deleteProject(projectId);
        }
      }}
      className="tf-button-danger"
    >
      <Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className="hidden sm:inline">Xoá dự án</span>
    </button>
  );
}
