"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { GripVertical } from "lucide-react";
import Avatar from "@/components/Avatar";
import type { UserPickerOption } from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import { formatCrmDate } from "@/lib/crm/dates";
import { OPPORTUNITY_OUTCOMES } from "@/lib/crm/labels";
import { formatBudgetRange, formatCompactVnd } from "@/lib/crm/opportunityFormat";
import { BOARD_COLUMNS, boardDropIntent, budgetSpan, type BoardCard, type BoardColumnKey } from "@/lib/crm/opportunityList";
import type { OpportunityStage, OutcomeReasons } from "@/lib/crm/opportunityDialogForms";
import { proposalCountdown } from "@/lib/crm/opportunityView";
import StageTransitionDialog from "./StageTransitionDialog";
import OpportunityOutcomeDialog from "./OpportunityOutcomeDialog";

type Props = {
  cards: BoardCard[]; reasons: OutcomeReasons; competitors: { id: string; name: string }[]; users: UserPickerOption[];
  todayKey: string; now: Date; periodLabel: string;
};
type Dialog = { card: BoardCard; kind: "BRIEF" | "BIDDING" | "RESULT" | "END" } | null;
const COLUMN_TONE: Partial<Record<BoardColumnKey, string>> = { WON: "bg-[#effaf2]", ENDED: "bg-zinc-100" };
const toneOf = (due: { tone: "late" | "warn" | null } | null) => due?.tone === "late" ? "bg-[#fff4ed] text-[#c2410c]" : due?.tone === "warn" ? "bg-[#fff7e6] text-[#b86a08]" : "bg-zinc-100 text-zinc-600";

/**
 * crm51 (sketch 006 screen 4): stage columns with mouse and keyboard drag and drop. A drop only opens the
 * existing stage or close dialog; the server action behind it still checks stage, permission and version.
 */
export default function OpportunityBoard({ cards, reasons, competitors, users, todayKey, now, periodLabel }: Props) {
  const { notify } = useInteraction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<BoardColumnKey | null>(null);
  const [moving, setMoving] = useState<{ id: string; target: BoardColumnKey } | null>(null);
  const [announce, setAnnounce] = useState("");
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const byColumn = (key: BoardColumnKey) => cards.filter(c => c.column === key).sort((a, b) =>
    Number(!a.nextStep) - Number(!b.nextStep) || (a.nextStep?.dueDate?.getTime() ?? Infinity) - (b.nextStep?.dueDate?.getTime() ?? Infinity) || a.clientName.localeCompare(b.clientName, "vi") || a.id.localeCompare(b.id));
  const label = (key: BoardColumnKey) => BOARD_COLUMNS.find(c => c.key === key)!.label;

  function drop(card: BoardCard, to: BoardColumnKey) {
    const intent = boardDropIntent(card, to);
    if (intent.kind === "NONE") return;
    if (intent.kind === "ERROR") { notify({ tone: "error", message: intent.message }); setAnnounce(intent.message); return; }
    setDialog({ card, kind: intent.kind });
  }
  function onDrop(event: DragEvent, to: BoardColumnKey) {
    event.preventDefault();
    const card = cards.find(c => c.id === event.dataTransfer.getData("text/plain"));
    setOver(null); setDragging(null);
    if (card) drop(card, to);
  }
  function onHandleKey(event: KeyboardEvent<HTMLButtonElement>, card: BoardCard) {
    const columns = BOARD_COLUMNS.map(c => c.key);
    if (!moving || moving.id !== card.id) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setMoving({ id: card.id, target: card.column });
        setAnnounce(`Đã chọn ${card.clientName} · ${card.name} ở cột ${label(card.column)}. Mũi tên trái phải để chọn cột, Enter để thả, Esc để hủy.`);
      }
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const index = columns.indexOf(moving.target) + (event.key === "ArrowRight" ? 1 : -1);
      const target = columns[Math.max(0, Math.min(columns.length - 1, index))];
      setMoving({ id: card.id, target }); setAnnounce(`Cột ${label(target)}`);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const target = moving.target; setMoving(null);
      if (target === card.column) setAnnounce("Đã hủy chuyển.");
      else drop(card, target);
    } else if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setMoving(null); setAnnounce("Đã hủy chuyển.");
    }
  }
  function closeDialog(open: boolean) {
    if (open) return;
    const id = dialog?.card.id;
    setDialog(null);
    if (id) requestAnimationFrame(() => handles.current.get(id)?.focus());
  }

  return <>
    <p aria-live="assertive" className="sr-only">{announce}</p>
    <div role="region" aria-label="Bảng Cơ hội theo giai đoạn" tabIndex={0} className="-mx-1 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
      <div className="grid min-w-[1060px] grid-cols-5 gap-3">
        {BOARD_COLUMNS.map(column => {
          const list = byColumn(column.key);
          const span = budgetSpan(list);
          const target = over === column.key || moving?.target === column.key && moving.id !== null;
          const ended = column.key === "ENDED" ? OPPORTUNITY_OUTCOMES.filter(o => o.key !== "WON").map(o => ({ label: o.label, count: list.filter(c => c.outcome === o.key).length })).filter(o => o.count) : [];
          const sum = column.key === "WON" ? `${periodLabel} · ${formatCompactVnd(list.reduce((s, c) => s + (c.contractValue ?? 0), 0))}`
            : column.key === "ENDED" ? (ended.length ? ended.map(o => `${o.label} ${o.count}`).join(" · ") : periodLabel)
            : span ? formatBudgetRange(span.min, span.max) : "Chưa có ngân sách";
          return <section key={column.key} aria-labelledby={`board-${column.key}`} data-board-column={column.key}
            onDragOver={event => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (over !== column.key) setOver(column.key); } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(o => o === column.key ? null : o); }}
            onDrop={event => onDrop(event, column.key)}
            className={`flex min-h-[360px] min-w-0 flex-col gap-2 rounded-[16px] p-2.5 transition-shadow duration-150 ${COLUMN_TONE[column.key] ?? "bg-[#eef0f3]"} ${target ? "shadow-[inset_0_0_0_2px_#18181b]" : ""}`}>
            <h2 id={`board-${column.key}`} className="mx-1 mt-0.5 flex items-baseline justify-between text-[13px] font-semibold">{column.label}<span className="font-normal tabular-nums text-zinc-500">{list.length}</span></h2>
            <p className="mx-1 -mt-1 mb-1 truncate text-xs text-zinc-500">{sum}</p>
            <ul className="flex flex-col gap-2">{list.map(card => <BoardCardView key={card.id} card={card} now={now} dragging={dragging === card.id} picked={moving?.id === card.id}
              onDragStart={event => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; setDragging(card.id); }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              handleRef={node => { if (node) handles.current.set(card.id, node); else handles.current.delete(card.id); }}
              onHandleKey={event => onHandleKey(event, card)} />)}</ul>
          </section>;
        })}
      </div>
    </div>
    {dialog && (dialog.kind === "BRIEF" || dialog.kind === "BIDDING") && <StageTransitionDialog opportunityId={dialog.card.id} version={dialog.card.version} to={dialog.kind} todayKey={todayKey} open onOpenChange={closeDialog}
      initial={{ budgetMin: dialog.card.budgetMin, budgetMax: dialog.card.budgetMax, briefSummary: dialog.card.dialog.briefSummary, winStrategy: dialog.card.dialog.winStrategy, proposalDueAt: dialog.card.dialog.proposalDueAt, proposalPlannedAt: dialog.card.dialog.proposalPlannedAt }} />}
    {dialog && (dialog.kind === "RESULT" || dialog.kind === "END") && <OpportunityOutcomeDialog opportunityId={dialog.card.id} opportunityName={dialog.card.name} version={dialog.card.version} mode={dialog.kind} stage={dialog.card.stage as OpportunityStage} outcome={dialog.card.outcome}
      budgetMin={dialog.card.budgetMin} budgetMax={dialog.card.budgetMax} reasons={reasons} winPreview={dialog.card.stage === "BIDDING" ? dialog.card.dialog.preview : null} openBidPrepTaskCount={dialog.card.dialog.openBidPrepTaskCount}
      competitors={competitors} users={users} defaultAssigneeId={dialog.card.pic?.userId ?? null} todayKey={todayKey} open onOpenChange={closeDialog} />}
  </>;
}

function BoardCardView({ card, now, dragging, picked, onDragStart, onDragEnd, handleRef, onHandleKey }: {
  card: BoardCard; now: Date; dragging: boolean; picked: boolean;
  onDragStart: (event: DragEvent) => void; onDragEnd: () => void;
  handleRef: (node: HTMLButtonElement | null) => void; onHandleKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const movable = card.outcome === null && (card.rights.canAdvance || card.rights.canClose);
  const due = card.nextStep?.dueDate ? card.nextStep.overdue ? { label: "Trễ", tone: "late" as const } : { label: formatCrmDate(card.nextStep.dueDate, now), tone: null } : null;
  const countdown = card.column === "BRIEF" ? proposalCountdown(card.proposalDueAt, now) : null;
  const outcome = OPPORTUNITY_OUTCOMES.find(o => o.key === card.outcome)?.label;
  return <li draggable={movable} onDragStart={movable ? onDragStart : undefined} onDragEnd={onDragEnd} data-board-card={card.id}
    className={`group flex min-w-0 flex-col gap-1.5 rounded-[12px] border bg-white px-3 py-2.5 text-[13px] transition-[opacity,transform] duration-150 motion-reduce:transition-none ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${dragging ? "opacity-50" : ""} ${picked ? "border-zinc-900 shadow-[0_0_0_1px_#18181b]" : "border-[#e9eaee] hover:-translate-y-0.5 motion-reduce:hover:transform-none"}`}>
    <div className="flex items-center justify-between gap-2">
      <span className="truncate rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{card.programTypeLabel}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">{card.timingLabel}
        {movable && <button ref={handleRef} type="button" aria-label={`Chuyển ${card.clientName} · ${card.name}`} aria-pressed={picked} onKeyDown={onHandleKey}
          className="-mr-1 grid h-7 w-7 place-items-center rounded-[6px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:text-zinc-900"><GripVertical size={14} aria-hidden="true" /></button>}
      </span>
    </div>
    <Link href={`/crm/opportunities/${card.id}`} className="break-words font-semibold text-zinc-900 hover:underline">{card.clientName} · {card.name}</Link>
    {card.column === "BRIEF" && countdown && <p className={`text-xs ${countdown.tone === "late" ? "text-[#c2410c]" : countdown.tone === "warn" ? "text-[#b86a08]" : "text-zinc-500"}`}>{countdown.label.replace("Nộp đề xuất", "Hạn nộp đề xuất")}</p>}
    {card.column === "BIDDING" && card.competitors.length > 0 && <p className="truncate text-xs text-zinc-500">Đối thủ: {card.competitors.join(", ")}</p>}
    {card.column === "WON" && <p className="text-xs text-zinc-500">{[card.contractValue !== null ? formatCompactVnd(card.contractValue) : null, card.projectId ? "đã tạo Project" : null].filter(Boolean).join(" · ")}</p>}
    {card.column === "ENDED" && <p className="text-xs text-zinc-500">{[outcome, card.reasonLabel].filter(Boolean).join(" · ")}</p>}
    {card.outcome === null && <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex min-w-0 items-center gap-1.5 text-zinc-600">{card.pic && <Avatar id={card.pic.accountId} name={card.pic.name} className="h-5 w-5 shrink-0 text-[10px]" />}<span className="truncate">{card.nextStep?.title ?? <span className="text-zinc-400">Chưa có việc tiếp theo</span>}</span></span>
      {due && <span className={`shrink-0 rounded-full px-2 py-0.5 ${toneOf(due)}`}>{due.label}</span>}
    </div>}
  </li>;
}
