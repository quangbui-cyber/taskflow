"use client";

import { useId, useState, useTransition } from "react";
import { FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { attachOwnerToMeeting } from "@/app/actions/meetingRecaps";
import { useInteraction } from "@/components/InteractionProvider";
import MeetingOwnerPicker from "@/components/MeetingOwnerPicker";
import type { PickerProject, PickerCrmTargets } from "@/lib/projectPickerGroups";
import type { WorkOwner } from "@/lib/workOwner";

export default function MeetingProjectLink({ meetingId, projects, crmTargets, crmOn = false }: {
  meetingId: string;
  projects: PickerProject[];
  crmTargets?: PickerCrmTargets;
  crmOn?: boolean;
}) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState<WorkOwner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();

  return (
    <section aria-labelledby={labelId} className="mt-4 rounded-[8px] border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id={labelId} className="text-sm font-semibold text-zinc-800">Cuộc họp chưa được gắn</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="tf-button-secondary !min-h-9 !px-3 text-sm">
            <FolderPlus size={16} aria-hidden="true" /> Gắn cuộc họp
          </button>
        )}
      </div>
      {open && (
        <form aria-label="Gắn với" className="mt-3 space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (!owner) return;
          setError(null);
          startTransition(async () => {
            try {
              const result = await attachOwnerToMeeting(meetingId, owner.kind, owner.id);
              if (result.error) setError(result.error);
              else {
                notify({ message: result.success ?? "Đã gắn cuộc họp.", tone: "success" });
                router.refresh();
              }
            } catch {
              setError("Không thể gắn cuộc họp lúc này. Vui lòng thử lại.");
            }
          });
        }}>
          <MeetingOwnerPicker projects={projects} targets={crmTargets} crmOn={crmOn} value={owner} onChange={setOwner} disabled={pending} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={pending || !owner} className="tf-button-primary !min-h-9 !px-3 text-sm">
              {pending ? "Đang lưu…" : "Lưu liên kết"}
            </button>
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }} className="tf-button-secondary !min-h-9 !px-3 text-sm">Huỷ</button>
          </div>
        </form>
      )}
    </section>
  );
}
