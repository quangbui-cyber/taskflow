"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { updateClientProfileAction, scorePotentialAction, saveBuyingUnitAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import CrmDialog from "./CrmDialog";
import { useClientEditSession } from "./ClientEditSession";

type Client = { id: string; version: number; industry: string | null; budgetSeason: string | null; budgetSeasonMonth: number | null; vendorSelection: string | null; valuedMost: string | null; potentialLevel: string | null };
type ManualKey = "industry" | "budgetSeason" | "vendorSelection" | "valuedMost";
type Editing = ManualKey | "profile" | "potential" | "unit" | null;
type ActionResult = { error?: string; success?: string; version?: number };
const LABELS: Record<ManualKey, string> = { industry: "Ngành", budgetSeason: "Mùa lập ngân sách", vendorSelection: "Cách chọn nhà cung cấp", valuedMost: "Điều khách coi trọng" };
const MANUAL = ["budgetSeason", "vendorSelection", "valuedMost"] as const;

export default function ClientProfileEditors({ client, variant, canEdit = false, canScore = false, potentialScale = [], buyingUnits = [], firstHeaderMenuItem, lastHeaderMenuItem, missing = [] }: {
  client: Client; variant: "header" | "persona" | "tier" | "buyingUnits";
  canEdit?: boolean; canScore?: boolean;
  potentialScale?: { key: string; label: string }[];
  buyingUnits?: { id: string; name: string; active: boolean; programs: string[] }[];
  firstHeaderMenuItem?: ReactNode;
  lastHeaderMenuItem?: ReactNode;
  missing?: string[];
}) {
  const [menu, setMenu] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!menu) return;
    const raf = requestAnimationFrame(() => menuRoot.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    function outside(event: PointerEvent) {
      const target = event.target as Element;
      if (!menuRoot.current?.contains(target) && !target.closest('[role="dialog"],[data-floating-layer]')) setMenu(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("pointerdown", outside); };
  }, [menu]);
  const router = useRouter(); const { notify } = useInteraction();
  const session = useClientEditSession();
  const [editing, setEditing] = useState<Editing>(null);
  const [savedVersion, setSavedVersion] = useState(client.version);
  const [expectedVersion, setExpectedVersion] = useState(client.version);
  const [fields, setFields] = useState({ industry: client.industry ?? "", budgetSeason: client.budgetSeason ?? "", vendorSelection: client.vendorSelection ?? "", valuedMost: client.valuedMost ?? "" });
  const [month, setMonth] = useState(String(client.budgetSeasonMonth ?? ""));
  const [level, setLevel] = useState(client.potentialLevel ?? potentialScale[0]?.key ?? "");
  const [note, setNote] = useState("");
  const [unit, setUnit] = useState<{ id?: string; name: string; active: boolean }>({ name: "", active: true });
  const [actionPending, startTransition] = useTransition();
  const pending = actionPending || !!session?.busy;
  function begin(mode: Editing) {
    setExpectedVersion(Math.max(client.version, savedVersion, session?.version ?? 0));
    setFields({ industry: client.industry ?? "", budgetSeason: client.budgetSeason ?? "", vendorSelection: client.vendorSelection ?? "", valuedMost: client.valuedMost ?? "" });
    setMonth(String(client.budgetSeasonMonth ?? ""));
    setLevel(client.potentialLevel ?? potentialScale[0]?.key ?? ""); setNote(""); setEditing(mode);
  }
  function run(action: () => Promise<ActionResult>) {
    if (pending) return;
    session?.setBusy(true);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) { notify({ message: result.error, tone: "error" }); return; }
        if (result.version !== undefined) { setSavedVersion(result.version); session?.saved(result.version); }
        notify({ message: result.success ?? "Đã lưu thay đổi.", tone: "success" }); setEditing(null); router.refresh();
      } catch { notify({ message: "Không lưu được thay đổi. Vui lòng thử lại.", tone: "error" }); }
      finally { session?.setBusy(false); }
    });
  }
  const monthField = <label className="block text-sm">Tháng lập ngân sách<select className="tf-field mt-2" value={month} onChange={(event) => setMonth(event.target.value)}><option value="">Chưa ghi</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>Tháng {index + 1}</option>)}</select></label>;
  const field = (key: ManualKey) => <label key={key} className="block text-sm">{LABELS[key]}<textarea className="tf-field mt-2 resize-y" rows={2} maxLength={500} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} /></label>;
  const buttons = <div className="flex justify-end gap-2"><button type="button" disabled={pending} className="tf-button-secondary" onClick={() => setEditing(null)}>Hủy</button><button type="submit" disabled={pending} className="tf-button-primary">Lưu</button></div>;
  if (variant === "header") return <>
    {canEdit && (firstHeaderMenuItem ? <div ref={menuRoot} className="relative" onKeyDown={event => {
      if (event.defaultPrevented || (event.target as Element).closest('[role="dialog"]')) return;
      if (event.key === "Escape" && menu) { event.preventDefault(); setMenu(false); menuTrigger.current?.focus(); }
      if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const items = [...(menuRoot.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
      }
      if (event.key === "Tab") setMenu(false);
    }}><button ref={menuTrigger} type="button" disabled={pending} className="tf-icon-button" aria-label="Thao tác khách hàng" aria-haspopup="menu" aria-expanded={menu} aria-controls={menu ? menuId : undefined} onClick={() => setMenu(value => !value)}><MoreHorizontal size={18} aria-hidden="true" /></button>
      {menu && <div id={menuId} role="menu" aria-label="Thao tác khách hàng" className="absolute right-0 z-20 mt-2 w-64 max-w-[calc(100vw-24px)] rounded-[10px] border border-zinc-200 bg-white p-1 shadow-lg">{firstHeaderMenuItem}<button type="button" role="menuitem" disabled={pending} className="flex min-h-10 w-full items-center rounded-[8px] px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-100 focus:outline-none" onClick={() => begin("profile")}>Sửa thông tin</button>{lastHeaderMenuItem}</div>}
    </div> : <button type="button" disabled={pending} className="tf-button-secondary" onClick={() => begin("profile")}>Sửa thông tin</button>)}
    <CrmDialog open={editing === "profile"} title="Sửa thông tin" pending={pending} onClose={() => setEditing(null)}><form onSubmit={(event) => { event.preventDefault(); run(() => updateClientProfileAction({ clientId: client.id, expectedVersion, ...fields, budgetSeasonMonth: month ? Number(month) : null })); }}><fieldset disabled={pending} className="min-w-0 space-y-4">{(["industry", ...MANUAL] as const).map(field)}{monthField}{buttons}</fieldset></form></CrmDialog>
  </>;
  if (variant === "tier") return <div className="mt-4">
    {canScore && (potentialScale.length ? <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => begin("potential")}>Chấm tiềm năng</button> : <p className="text-sm text-zinc-500">Chưa có thang tiềm năng</p>)}
    {editing === "potential" && <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); run(() => scorePotentialAction({ clientId: client.id, level, note })); }}><fieldset disabled={pending} className="min-w-0 space-y-4"><label className="block text-sm">Tiềm năng<select required className="tf-field mt-2" value={level} onChange={(event) => setLevel(event.target.value)}>{potentialScale.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label className="block text-sm">Ghi chú<textarea className="tf-field mt-2" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} /></label>{buttons}</fieldset></form>}
  </div>;
  if (variant === "buyingUnits") return <div className="space-y-4">
    {buyingUnits.length ? <ul className="space-y-3">{buyingUnits.map((item) => <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 text-sm"><div><p className={item.active ? "" : "text-zinc-400"}>{item.name}{!item.active && <span className="ml-2 text-xs">Đã ẩn</span>}</p>{item.programs.length > 0 && <p className="mt-1 text-xs text-zinc-500">{item.programs.join(", ")}</p>}</div>{canEdit && <div className="flex gap-2"><button type="button" disabled={pending || !!editing} aria-label={`Sửa ${item.name}`} className="text-zinc-500 hover:text-zinc-900" onClick={() => { setUnit({ id: item.id, name: item.name, active: item.active }); begin("unit"); }}>Sửa</button><button type="button" disabled={pending || !!editing} className="text-zinc-500 hover:text-zinc-900" onClick={() => run(() => saveBuyingUnitAction({ clientId: client.id, id: item.id, name: item.name, active: !item.active }))}>{item.active ? "Ẩn" : "Hiện"}</button></div>}</li>)}</ul> : <p className="text-sm text-zinc-500">Chưa có đơn vị mua</p>}
    {canEdit && !editing && <button type="button" className="tf-button-secondary" disabled={pending} onClick={() => { setUnit({ name: "", active: true }); begin("unit"); }}>Thêm đơn vị mua</button>}
    {editing === "unit" && <form onSubmit={(event) => { event.preventDefault(); run(() => saveBuyingUnitAction({ clientId: client.id, ...unit })); }}><fieldset disabled={pending} className="min-w-0 space-y-3"><label className="block text-sm">Tên đơn vị mua<input required maxLength={200} className="tf-field mt-2" value={unit.name} onChange={(event) => setUnit({ ...unit, name: event.target.value })} /></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unit.active} onChange={(event) => setUnit({ ...unit, active: event.target.checked })} />Đang dùng</label>{buttons}</fieldset></form>}
  </div>;
  const valueText = (key: typeof MANUAL[number]) => [client[key], key === "budgetSeason" && client.budgetSeasonMonth ? `Tháng ${client.budgetSeasonMonth}` : null].filter(Boolean).join(" · ");
  return <dl className="space-y-3">{MANUAL.map((key) => {
    const text = valueText(key);
    const isMissing = missing.includes(key) || key === "budgetSeason" && missing.includes("budgetSeasonMonth");
    return <div key={key} data-persona-field={key} data-missing={isMissing || undefined} className={editing === key ? "" : "flex items-baseline justify-between gap-3"}><dt className={`text-[13px] ${editing === key ? "mb-1" : "shrink-0"} ${isMissing ? "font-semibold text-[#b86a08]" : "text-zinc-500"}`}>{LABELS[key]}</dt><dd className={editing === key ? "" : "min-w-0 text-right"}>
    {editing === key ? <form onSubmit={(event) => { event.preventDefault(); run(() => updateClientProfileAction({ clientId: client.id, expectedVersion, [key]: fields[key], ...(key === "budgetSeason" ? { budgetSeasonMonth: month ? Number(month) : null } : {}) })); }}><fieldset disabled={pending} className="min-w-0 space-y-3">{field(key)}{key === "budgetSeason" && monthField}{buttons}</fieldset></form>
      : canEdit ? text ? <button type="button" disabled={pending || !!editing} onClick={() => begin(key)} className="break-words text-right text-[13px] text-zinc-900 hover:underline">{text}</button>
        : <button type="button" disabled={pending || !!editing} aria-label={`Thêm ${LABELS[key]}`} onClick={() => begin(key)} className="whitespace-nowrap text-[13px] font-semibold text-brand-700 hover:underline">+ Thêm</button>
      : <p className={`break-words text-[13px] ${text ? "" : "text-zinc-400"}`}>{text || "Chưa ghi"}</p>}
  </dd></div>; })}</dl>;
}
