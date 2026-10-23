"use client";

import { useId, useState, useTransition } from "react";
import { FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { attachProjectToMeeting } from "@/app/actions/meetingRecaps";
import { useInteraction } from "@/components/InteractionProvider";
import GroupedProjectPicker from "@/components/GroupedProjectPicker";
import type { PickerProject } from "@/lib/projectPickerGroups";

export default function MeetingProjectLink({ meetingId, projects, hasPublishedRecap }: {
  meetingId: string;
  projects: PickerProject[];
  hasPublishedRecap: boolean;
}) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();

  return (
    <section aria-label="Gắn cuộc họp vào dự án" className="mt-4 rounded-[8px] border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-800">Cuộc họp chưa thuộc dự án nào</p>
          <p className="mt-1 text-xs text-zinc-500">Chọn dự án để lưu trữ biên bản cuộc họp.</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="tf-button-secondary !min-h-9 !px-3 text-sm">
            <FolderPlus size={16} aria-hidden="true" /> Gắn vào dự án
          </button>
        )}
      </div>
      {open && (
        <form className="mt-3 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            try {
              const result = await attachProjectToMeeting(meetingId, projectId);
              if (result.error) setError(result.error);
              else {
                notify({ message: result.success ?? "Đã gắn cuộc họp vào dự án.", tone: "success" });
                router.refresh();
              }
            } catch {
              setError("Không thể gắn dự án lúc này. Vui lòng thử lại.");
            }
          });
        }}>
          <div>
            <span id={labelId} className="tf-label">Dự án lưu trữ biên bản</span>
            <div className="mt-1">
              <GroupedProjectPicker projects={projects} value={projectId} onChange={setProjectId}
                disabled={pending} labelId={labelId} />
            </div>
          </div>
          <p className="text-xs leading-5 text-zinc-500">
            {hasPublishedRecap ? "Bản biên bản đã gửi sẽ được lưu ngay thành file Word trong Tài liệu dự án."
              : "Biên bản sẽ được lưu vào Tài liệu dự án khi bạn bấm gửi."}
            {" "}Các task đã tạo giữ nguyên dự án hiện tại.
          </p>
          {projects.length === 0 && <p className="text-sm text-amber-700">Bạn chưa có dự án để chọn. Hãy tạo hoặc tham gia một dự án trước.</p>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !projectId} className="tf-button-primary !min-h-9 !px-3 text-sm">
              {pending ? "Đang lưu…" : "Gắn và lưu biên bản"}
            </button>
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }} className="tf-button-secondary !min-h-9 !px-3 text-sm">Huỷ</button>
          </div>
        </form>
      )}
    </section>
  );
}
