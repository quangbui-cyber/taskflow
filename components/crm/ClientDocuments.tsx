import Link from "next/link";
import { formatCrmDate } from "@/lib/crm/dates";

type DocumentItem = { id: string; name: string; createdAt: Date; href: string | null; driveUrl: string | null; uploaderName: string | null; context: string | null };
type Group = { key: string; label: string; items: DocumentItem[] };
type Meeting = { id: string; title: string; startAt: Date; status: string; context: string | null; hasRecap: boolean };

/** Files from the client, its Opportunities and Projects (Project files only when the viewer may open the Project), plus meetings. */
export default function ClientDocuments({ groups, meetings, now }: { groups: Group[]; meetings: Meeting[]; now: Date }) {
  const recapCount = meetings.filter((meeting) => meeting.hasRecap).length;
  return <div className="space-y-5">
    {groups.length ? groups.map((group) => <section key={group.key} aria-labelledby={`docs-${group.key}`} className="space-y-1">
      <h3 id={`docs-${group.key}`} className="text-[13px] font-semibold">{group.label} <span className="font-normal text-zinc-500">· {group.items.length}</span></h3>
      <ul className="divide-y divide-zinc-100">{group.items.map((file) => <li key={file.id} className="space-y-0.5 py-2.5">
        {file.href ? <a href={file.href} className="break-words text-sm font-medium hover:underline">{file.name}</a> : file.driveUrl ? <a href={file.driveUrl} target="_blank" rel="noopener noreferrer" className="break-words text-sm font-medium hover:underline">{file.name}</a> : <p className="break-words text-sm font-medium">{file.name}</p>}
        <p className="text-xs text-zinc-500">{[formatCrmDate(file.createdAt, now), file.uploaderName, file.context].filter(Boolean).join(" · ")}</p>
      </li>)}</ul>
    </section>) : <p className="text-sm text-zinc-500">Chưa có tệp.</p>}
    <section aria-labelledby="docs-meetings" className="space-y-1">
      <h3 id="docs-meetings" className="text-[13px] font-semibold">Cuộc họp <span className="font-normal text-zinc-500">· {meetings.length}{recapCount ? `, ${recapCount} có biên bản` : ""}</span></h3>
      {meetings.length ? <ul className="divide-y divide-zinc-100">{meetings.map((meeting) => <li key={meeting.id} className="space-y-0.5 py-2.5">
        <p className="flex flex-wrap items-center gap-2"><Link href={`/meetings?focus=${meeting.id}#meeting-${meeting.id}`} className="break-words text-sm font-medium hover:underline">{meeting.title}</Link>{meeting.hasRecap && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">Có biên bản</span>}</p>
        <p className="text-xs text-zinc-500">{[formatCrmDate(meeting.startAt, now), meeting.status === "CANCELLED" ? "Đã hủy" : null, meeting.context].filter(Boolean).join(" · ")}</p>
      </li>)}</ul> : <p className="text-sm text-zinc-500">Chưa có cuộc họp.</p>}
    </section>
  </div>;
}
