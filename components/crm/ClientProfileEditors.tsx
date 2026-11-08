"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClientProfileAction, scorePotentialAction, saveBuyingUnitAction, confirmImportedClientAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import CrmDialog from "./CrmDialog";
import { useClientEditSession } from "./ClientEditSession";

type Client = { id: string; version: number; industry: string | null; budgetSeason: string | null; budgetSeasonMonth: number | null; vendorSelection: string | null; valuedMost: string | null; potentialLevel: string | null };
type ManualKey = "industry" | "budgetSeason" | "vendorSelection" | "valuedMost";
type Editing = ManualKey | "profile" | "potential" | "unit" | null;
type ActionResult = { error?: string; success?: string; version?: number };
const LABELS: Record<ManualKey, string> = { industry: "Ngành", budgetSeason: "Mùa lập ngân sách", vendorSelection: "Cách chọn nhà cung cấp", valuedMost: "Điều khách coi trọng" };
const MANUAL = ["budgetSeason", "vendorSelection", "valuedMost"] as const;

export default function ClientProfileEditors({ client, variant, canEdit = false, canScore = false, canConfirm = false, potentialScale = [], buyingUnits = [] }: {
  client: Client; variant: "header" | "persona" | "tier" | "buyingUnits";
  canEdit?: boolean; canScore?: boolean; canConfirm?: boolean;
  potentialScale?: { key: string; label: string }[];
  buyingUnits?: { id: string; name: string; active: boolean; programs: string[] }[];
}) {
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
    {canConfirm && <button type="button" disabled={pending} className="tf-button-secondary" onClick={() => run(() => confirmImportedClientAction({ clientId: client.id }))}>Xác nhận khách của tôi</button>}
    {canEdit && <button type="button" disabled={pending} className="tf-button-secondary" onClick={() => begin("profile")}>Sửa thông tin</button>}
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
  return <dl className="space-y-4">{MANUAL.map((key) => <div key={key}><dt className="mb-1 text-xs text-zinc-500">{LABELS[key]}</dt><dd>
    {editing === key ? <form onSubmit={(event) => { event.preventDefault(); run(() => updateClientProfileAction({ clientId: client.id, expectedVersion, [key]: fields[key], ...(key === "budgetSeason" ? { budgetSeasonMonth: month ? Number(month) : null } : {}) })); }}><fieldset disabled={pending} className="min-w-0 space-y-3">{field(key)}{key === "budgetSeason" && monthField}{buttons}</fieldset></form> : canEdit ? <button type="button" disabled={pending || !!editing} onClick={() => begin(key)} className={`w-full text-left text-sm ${client[key] ? "text-zinc-900" : "text-zinc-400"}`}>{client[key] || "Chưa ghi"}{key === "budgetSeason" && client.budgetSeasonMonth ? ` · Tháng ${client.budgetSeasonMonth}` : ""}</button> : <p className={`text-sm ${client[key] ? "" : "text-zinc-400"}`}>{client[key] || "Chưa ghi"}{key === "budgetSeason" && client.budgetSeasonMonth ? ` · Tháng ${client.budgetSeasonMonth}` : ""}</p>}
  </dd></div>)}</dl>;
}
