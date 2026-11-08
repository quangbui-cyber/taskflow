"use client";

import { useId, useState } from "react";
import GroupedProjectPicker from "./GroupedProjectPicker";
import type { PickerCrmTargets, PickerProject } from "@/lib/projectPickerGroups";
import type { WorkOwner, WorkOwnerKind } from "@/lib/workOwner";

const KINDS = [{ kind: "PROJECT", label: "Dự án" }, { kind: "OPPORTUNITY", label: "Cơ hội" }, { kind: "CLIENT", label: "Khách hàng" }] as const;
export default function MeetingOwnerPicker({ projects, targets = {}, crmOn = false, value, onChange, disabled, allowEmpty = false }: {
  projects: PickerProject[];
  targets?: PickerCrmTargets;
  crmOn?: boolean;
  value: WorkOwner | null;
  onChange: (owner: WorkOwner | null) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
}) {
  const [kind, setKind] = useState<WorkOwnerKind>(value?.kind ?? "PROJECT");
  const labelId = useId();
  const options = crmOn ? KINDS : KINDS.slice(0, 1);
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">Gắn với</span>
      {allowEmpty && value && <button type="button" disabled={disabled} className="text-sm text-zinc-500 hover:text-zinc-900" onClick={() => onChange(null)}>Bỏ lựa chọn</button>}
    </div>
    <div role="radiogroup" aria-label="Gắn với" className="flex flex-wrap gap-2">{options.map((option) => <button key={option.kind} type="button" role="radio" aria-checked={kind === option.kind} disabled={disabled} onClick={() => { setKind(option.kind); onChange(null); }} className={`rounded-[7px] border px-3 py-2 text-sm ${kind === option.kind ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`}>{option.label}</button>)}</div>
    <span id={labelId} className="sr-only">Chọn {KINDS.find((option) => option.kind === kind)?.label}</span>
    <GroupedProjectPicker ownerMode projects={kind === "PROJECT" ? projects : []} opportunities={kind === "OPPORTUNITY" ? targets.opportunities : []} clients={kind === "CLIENT" ? targets.clients : []} value={value?.kind === kind ? value : null} onChange={onChange} disabled={disabled} labelId={labelId} />
  </div>;
}
