"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import type { UserPickerOption } from "@/components/UserPicker";
import type { OutcomeReasons, OpportunityStage } from "@/lib/crm/opportunityDialogForms";
import StageTransitionDialog from "./StageTransitionDialog";
import OpportunityOutcomeDialog from "./OpportunityOutcomeDialog";
import { EditOpportunityDialog, OpportunityPicDialog, type EditableOpportunity } from "./OpportunityEditDialogs";

export type OpportunityHeaderActionsProps = {
  opportunity: EditableOpportunity; rights: { canAdvance: boolean; canClose: boolean; canEdit: boolean; canChangePic: boolean };
  reasons: OutcomeReasons; winPreview: { tasks: number; files: number; meetings: number } | null; openBidPrepTaskCount: number;
  users: UserPickerOption[]; picAccounts: { id: string; name: string }[]; teams: { id: string; name: string }[];
  programTypes: { code: string; label: string }[]; buyingUnits: { id: string; name: string }[]; todayKey: string;
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
  const primary = stage === "CARE" && rights.canAdvance ? ["BRIEF", "Nhận Brief"] as const : stage === "BRIEF" && rights.canAdvance ? ["BIDDING", "Bắt đầu Bidding"] as const : stage === "BIDDING" && rights.canClose ? ["RESULT", "Ghi kết quả"] as const : null;
  const items = [
    ...((stage === "CARE" || stage === "BRIEF") && rights.canClose ? [{ key: "END" as const, label: "Kết thúc Cơ hội" }] : []),
    ...(rights.canEdit ? [{ key: "EDIT" as const, label: "Sửa thông tin" }] : []),
    ...(rights.canChangePic ? [{ key: "PIC" as const, label: "Đổi PIC hoặc team" }] : []),
  ];
  function launch(value: typeof dialog) { trigger.current?.focus(); setMenu(false); setDialog(value); }
  function close(open: boolean) { if (!open) setDialog(null); }
  return <>
    {primary && <button type="button" className="tf-button-primary" onClick={() => setDialog(primary[0])}>{primary[1]}</button>}
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
    <OpportunityOutcomeDialog opportunityId={o.id} opportunityName={o.name} version={o.version} mode={dialog === "END" ? "END" : "RESULT"} stage={stage} outcome={o.outcome} budgetMin={o.budgetMin} budgetMax={o.budgetMax} reasons={props.reasons} winPreview={props.winPreview} openBidPrepTaskCount={props.openBidPrepTaskCount} users={props.users} defaultAssigneeId={o.picUserId} todayKey={props.todayKey} open={dialog === "RESULT" || dialog === "END"} onOpenChange={close} />
    <EditOpportunityDialog opportunity={o} programTypes={props.programTypes} buyingUnits={props.buyingUnits} open={dialog === "EDIT"} onOpenChange={close} />
    <OpportunityPicDialog opportunity={o} picAccounts={props.picAccounts} teams={props.teams} open={dialog === "PIC"} onOpenChange={close} />
  </>;
}
