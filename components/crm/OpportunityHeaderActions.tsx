"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import type { UserPickerOption } from "@/components/UserPicker";
import type { OutcomeReasons, OpportunityStage } from "@/lib/crm/opportunityDialogForms";
import StageTransitionDialog from "./StageTransitionDialog";
import OpportunityOutcomeDialog from "./OpportunityOutcomeDialog";
import { EditOpportunityDialog, OpportunityPicDialog, type EditableOpportunity } from "./OpportunityEditDialogs";
import { opportunityPrimaryAction, type BriefChecklistItem } from "@/lib/crm/opportunityView";

export type OpportunityHeaderActionsProps = {
  opportunity: EditableOpportunity; rights: { canAdvance: boolean; canClose: boolean; canEdit: boolean; canChangePic: boolean };
  reasons: OutcomeReasons; winPreview: { tasks: number; files: number; meetings: number } | null; openBidPrepTaskCount: number;
  users: UserPickerOption[]; picAccounts: { id: string; name: string }[]; teams: { id: string; name: string }[];
  programTypes: { code: string; label: string }[]; buyingUnits: { id: string; name: string }[]; todayKey: string;
  touchpointSlot?: ReactNode;
  competitors?: { id: string; name: string }[];
};
export default function OpportunityHeaderActions(props: OpportunityHeaderActionsProps) {
  const { opportunity: o, rights } = props;
  const [menu, setMenu] = useState(false);
  const [dialog, setDialog] = useState<"BRIEF" | "BIDDING" | "RESULT" | "END" | "EDIT" | "PIC" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const uid = useId();
  useEffect(() => {
    if (!menu) return;
    const raf = requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    function outside(e: PointerEvent) { if (!root.current?.contains(e.target as Node)) { setMenu(false); trigger.current?.focus(); } }
    document.addEventListener("pointerdown", outside);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("pointerdown", outside); };
  }, [menu]);
  if (o.outcome !== null) return null;
  const stage = o.stage as OpportunityStage;
  const primary = opportunityPrimaryAction(stage, o.outcome, rights);
  const items = [
    ...((stage === "CARE" || stage === "BRIEF") && rights.canClose ? [{ key: "END" as const, label: "Kết thúc Cơ hội" }] : []),
    ...(rights.canEdit ? [{ key: "EDIT" as const, label: "Sửa thông tin" }] : []),
    ...(rights.canChangePic ? [{ key: "PIC" as const, label: "Đổi PIC hoặc team" }] : []),
  ];
  function launch(value: typeof dialog) { trigger.current?.focus(); setMenu(false); setDialog(value); }
  function close(open: boolean) { if (!open) setDialog(null); }
  return <>
    {primary && <button type="button" className="tf-button-primary" onClick={() => setDialog(primary.key)}>{primary.label}</button>}
    {props.touchpointSlot}
    {!!items.length && <div ref={root} className="relative" onKeyDown={event => {
      if (event.key === "Escape" && menu) { event.preventDefault(); setMenu(false); trigger.current?.focus(); }
      if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const nodes = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + nodes.length) % nodes.length;
        nodes[next]?.focus();
      }
      if (event.key === "Tab" && menu) setMenu(false);
    }}>
      <button ref={trigger} type="button" className="tf-icon-button" aria-label="Thao tác khác" aria-expanded={menu} aria-haspopup="menu" aria-controls={menu ? uid : undefined} onClick={() => setMenu(v => !v)}><MoreHorizontal size={18} aria-hidden="true" /></button>
      {menu && <div id={uid} role="menu" aria-label="Thao tác Cơ hội" className="absolute right-0 z-20 mt-2 min-w-52 rounded-[10px] border border-zinc-200 bg-white p-1 shadow-lg">{items.map(item => <button key={item.key} type="button" role="menuitem" className="flex min-h-10 w-full items-center rounded-[8px] px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-100 focus:outline-none" onClick={() => launch(item.key)}>{item.label}</button>)}</div>}
    </div>}
    <StageTransitionDialog opportunityId={o.id} version={o.version} to={dialog === "BIDDING" ? "BIDDING" : "BRIEF"} initial={o} todayKey={props.todayKey} open={dialog === "BRIEF" || dialog === "BIDDING"} onOpenChange={close} />
    <OpportunityOutcomeDialog opportunityId={o.id} opportunityName={o.name} version={o.version} mode={dialog === "END" ? "END" : "RESULT"} stage={stage} outcome={o.outcome} budgetMin={o.budgetMin} budgetMax={o.budgetMax} reasons={props.reasons} winPreview={props.winPreview} openBidPrepTaskCount={props.openBidPrepTaskCount} competitors={props.competitors} users={props.users} defaultAssigneeId={o.picUserId} todayKey={props.todayKey} open={dialog === "RESULT" || dialog === "END"} onOpenChange={close} />
    <EditOpportunityDialog opportunity={o} programTypes={props.programTypes} buyingUnits={props.buyingUnits} open={dialog === "EDIT"} onOpenChange={close} />
    <OpportunityPicDialog opportunity={o} picAccounts={props.picAccounts} teams={props.teams} open={dialog === "PIC"} onOpenChange={close} />
  </>;
}

/** Brief checklist; "+ Thêm" opens the existing edit dialog, which still enforces EDIT on the server. */
export function OpportunityBriefChecklist({ items, opportunity, canEdit, programTypes, buyingUnits }: {
  items: BriefChecklistItem[]; opportunity: EditableOpportunity; canEdit: boolean;
  programTypes: { code: string; label: string }[]; buyingUnits: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return <>
    <ul className="space-y-1" aria-label="Hồ sơ Brief">{items.map(item => <li key={item.key} data-brief-item={item.key} data-done={item.done || undefined} className="py-1.5 text-sm">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border-[1.5px] text-[11px] ${item.done ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300"}`}>{item.done ? "✓" : ""}</span>
        <span className={item.done ? "text-zinc-900" : "text-zinc-600"}>{item.label}<span className="sr-only">{item.done ? ": đã có" : ": chưa có"}</span></span>
        <span className="ml-auto shrink-0 text-[13px] text-zinc-500">{item.done ? item.value : canEdit && item.canAdd ? <button type="button" aria-label={`Thêm ${item.label}`} className="font-semibold text-brand-700 hover:underline" onClick={() => setOpen(true)}>+ Thêm</button> : null}</span>
      </div>
      {item.text && <p className="ml-7 mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[13px] text-zinc-500">{item.text}</p>}
    </li>)}</ul>
    {canEdit && <EditOpportunityDialog opportunity={opportunity} programTypes={programTypes} buyingUnits={buyingUnits} open={open} onOpenChange={setOpen} />}
  </>;
}
