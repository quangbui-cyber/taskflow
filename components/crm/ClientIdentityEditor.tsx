"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { addClientAliasAction, archiveClientAction, removeClientAliasAction, restoreClientAction, setClientTagsAction, updateClientIdentityAction } from "@/app/actions/crmClients";
import { useInteraction } from "@/components/InteractionProvider";
import CrmDialog from "./CrmDialog";
import { useClientEditSession } from "./ClientEditSession";

type ActionResult = { error?: string; success?: string; version?: number };
export type ClientIdentity = {
  id: string; version: number; name: string;
  taxCode: string | null; legalName: string | null; shortName: string | null; website: string | null; address: string | null;
  acquisitionSource: string | null; referredBy: string | null; notes: string | null;
  parent: { id: string; name: string } | null;
};
const EMPTY = "Chưa có";
const MENU_ITEM = "flex min-h-10 w-full items-center rounded-[8px] px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-100 focus:outline-none";

/** Shared save flow: one pending state per client page, version taken from the edit session, one toast per action. */
function useClientAction(version: number) {
  const router = useRouter(); const { notify } = useInteraction();
  const session = useClientEditSession();
  const [savedVersion, setSavedVersion] = useState(version);
  const [actionPending, startTransition] = useTransition();
  const pending = actionPending || !!session?.busy;
  const current = () => Math.max(version, savedVersion, session?.version ?? 0);
  function run(action: () => Promise<ActionResult>, done?: () => void) {
    if (pending) return;
    session?.setBusy(true);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) { notify({ message: result.error, tone: "error" }); return; }
        if (result.version !== undefined) { setSavedVersion(result.version); session?.saved(result.version); }
        notify({ message: result.success ?? "Đã lưu thay đổi.", tone: "success" }); done?.(); router.refresh();
      } catch { notify({ message: "Không lưu được thay đổi. Vui lòng thử lại.", tone: "error" }); }
      finally { session?.setBusy(false); }
    });
  }
  return { pending, run, current };
}
function Buttons({ pending, onCancel, label = "Lưu" }: { pending: boolean; onCancel: () => void; label?: string }) {
  return <div className="flex justify-end gap-2"><button type="button" disabled={pending} className="tf-button-secondary" onClick={onCancel}>Hủy</button><button type="submit" disabled={pending} className="tf-button-primary">{label}</button></div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-[13px] text-zinc-500">{label}</dt><dd className="min-w-0 break-words text-right text-[13px]">{children}</dd></div>;
}
const value = (text: string | null) => text ? text : <span className="text-zinc-400">{EMPTY}</span>;

/** Aside block "Thông tin công ty". Empty fields stay optional; each save is partial. */
export default function ClientIdentityEditor({ client, aliases, canEdit, sources, parentOptions }: {
  client: ClientIdentity; aliases: { id: string; name: string }[]; canEdit: boolean;
  sources: { label: string; active: boolean }[]; parentOptions: { id: string; name: string }[];
}) {
  const { pending, run, current } = useClientAction(client.version);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [alias, setAlias] = useState("");
  const begin = () => setDraft({
    taxCode: client.taxCode ?? "", legalName: client.legalName ?? "", shortName: client.shortName ?? "", website: client.website ?? "", address: client.address ?? "",
    acquisitionSource: client.acquisitionSource ?? "", referredBy: client.referredBy ?? "", parentClientId: client.parent?.id ?? "",
  });
  const activeSources = sources.filter((source) => source.active || source.label === client.acquisitionSource);
  const input = (key: string, label: string, props: Record<string, unknown> = {}) => <label className="block text-sm">{label}<input className="tf-field mt-2" value={draft?.[key] ?? ""} onChange={(event) => setDraft((d) => d && { ...d, [key]: event.target.value })} {...props} /></label>;
  function save() {
    if (!draft) return;
    const changed: Record<string, string | null> = {};
    const before: Record<string, string> = { taxCode: client.taxCode ?? "", legalName: client.legalName ?? "", shortName: client.shortName ?? "", website: client.website ?? "", address: client.address ?? "", acquisitionSource: client.acquisitionSource ?? "", referredBy: client.referredBy ?? "", parentClientId: client.parent?.id ?? "" };
    for (const [key, text] of Object.entries(draft)) if (text.trim() !== before[key]) changed[key] = text.trim() || null;
    if (!Object.keys(changed).length) { setDraft(null); return; }
    run(() => updateClientIdentityAction({ clientId: client.id, expectedVersion: current(), ...changed }), () => setDraft(null));
  }
  return <div className="space-y-3">
    <dl className="space-y-1.5">
      <Row label="Mã số thuế">{client.taxCode ? <span className="tabular-nums">{client.taxCode}</span> : value(null)}</Row>
      <Row label="Tên pháp lý">{value(client.legalName)}</Row>
      <Row label="Tên gọi khác">{aliases.length ? <ul className="space-y-1">{aliases.map((item) => <li key={item.id} className="flex items-center justify-end gap-1">{item.name}{canEdit && <button type="button" disabled={pending} aria-label={`Bỏ tên gọi khác ${item.name}`} className="rounded p-0.5 text-zinc-400 hover:text-zinc-900" onClick={() => run(() => removeClientAliasAction({ clientId: client.id, aliasId: item.id }))}><X size={14} aria-hidden="true" /></button>}</li>)}</ul> : value(null)}</Row>
      <Row label="Website">{client.website ? <a href={client.website} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{client.website.replace(/^https?:\/\//, "")}</a> : value(null)}</Row>
      <Row label="Địa chỉ">{value(client.address)}</Row>
      <Row label="Nguồn khách">{value([client.acquisitionSource, client.referredBy].filter(Boolean).join(" · ") || null)}</Row>
      <Row label="Công ty mẹ">{client.parent ? <Link href={`/crm/clients/${client.parent.id}`} className="hover:underline">{client.parent.name}</Link> : value(null)}</Row>
    </dl>
    {canEdit && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (alias.trim()) run(() => addClientAliasAction({ clientId: client.id, name: alias }), () => setAlias("")); }}>
      <input aria-label="Tên gọi khác mới" placeholder="Thêm tên gọi khác" maxLength={160} className="tf-field min-w-0 flex-1" value={alias} disabled={pending} onChange={(event) => setAlias(event.target.value)} />
      <button type="submit" disabled={pending || !alias.trim()} className="tf-button-secondary">Thêm</button>
    </form>}
    {canEdit && <button type="button" disabled={pending} className="tf-button-secondary" onClick={begin}>Sửa thông tin công ty</button>}
    <CrmDialog open={!!draft} title="Thông tin công ty" pending={pending} onClose={() => setDraft(null)}>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}><fieldset disabled={pending} className="min-w-0 space-y-4">
        {input("taxCode", "Mã số thuế", { inputMode: "numeric", maxLength: 20, placeholder: "10 số hoặc 10 số-3 số" })}
        {input("legalName", "Tên pháp lý", { maxLength: 300 })}
        {input("shortName", "Tên ngắn", { maxLength: 120 })}
        {input("website", "Website", { maxLength: 200, inputMode: "url" })}
        {input("address", "Địa chỉ", { maxLength: 500 })}
        {activeSources.length ? <label className="block text-sm">Nguồn khách<select className="tf-field mt-2" value={draft?.acquisitionSource ?? ""} onChange={(event) => setDraft((d) => d && { ...d, acquisitionSource: event.target.value })}><option value="">{EMPTY}</option>{activeSources.map((source) => <option key={source.label} value={source.label}>{source.label}</option>)}</select></label>
          : input("acquisitionSource", "Nguồn khách", { maxLength: 80 })}
        {input("referredBy", "Người hoặc đơn vị giới thiệu", { maxLength: 200 })}
        <label className="block text-sm">Công ty mẹ<select className="tf-field mt-2" value={draft?.parentClientId ?? ""} onChange={(event) => setDraft((d) => d && { ...d, parentClientId: event.target.value })}><option value="">Không thuộc tập đoàn</option>{client.parent && !parentOptions.some((option) => option.id === client.parent!.id) && <option value={client.parent.id}>{client.parent.name}</option>}{parentOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
        <Buttons pending={pending} onCancel={() => setDraft(null)} />
      </fieldset></form>
    </CrmDialog>
  </div>;
}

/** Header menu: pinned note. The label itself carries the G-LEGAL warning. */
export function ClientNotesMenuItem({ client }: { client: Pick<ClientIdentity, "id" | "version" | "notes"> }) {
  const { pending, run, current } = useClientAction(client.version);
  const [draft, setDraft] = useState<string | null>(null);
  return <>
    <button type="button" role="menuitem" disabled={pending} className={MENU_ITEM} onClick={() => setDraft(client.notes ?? "")}>{client.notes ? "Sửa ghi chú" : "Thêm ghi chú"}</button>
    <CrmDialog open={draft !== null} title="Ghi chú chung" pending={pending} onClose={() => setDraft(null)}>
      <form onSubmit={(event) => { event.preventDefault(); run(() => updateClientIdentityAction({ clientId: client.id, expectedVersion: current(), notes: draft?.trim() || null }), () => setDraft(null)); }}><fieldset disabled={pending} className="min-w-0 space-y-4">
        <label className="block text-sm">Ghi chú (không ghi dữ liệu cá nhân của người liên hệ)<textarea className="tf-field mt-2 resize-y" rows={6} maxLength={2000} value={draft ?? ""} onChange={(event) => setDraft(event.target.value)} /></label>
        <p className="text-right text-xs tabular-nums text-zinc-500" aria-live="polite">{(draft ?? "").length}/2000</p>
        <Buttons pending={pending} onCancel={() => setDraft(null)} />
      </fieldset></form>
    </CrmDialog>
  </>;
}

export function ClientTagsMenuItem({ clientId, version, selected, tags }: { clientId: string; version: number; selected: { id: string; label: string; active: boolean }[]; tags: { id: string; label: string }[] }) {
  const { pending, run, current } = useClientAction(version);
  const [draft, setDraft] = useState<string[] | null>(null);
  const options = [...selected.filter((tag) => !tags.some((t) => t.id === tag.id)), ...tags];
  return <>
    <button type="button" role="menuitem" disabled={pending} className={MENU_ITEM} onClick={() => setDraft(selected.map((tag) => tag.id))}>Gắn nhãn</button>
    <CrmDialog open={draft !== null} title="Nhãn khách" pending={pending} onClose={() => setDraft(null)}>
      <form onSubmit={(event) => { event.preventDefault(); run(() => setClientTagsAction({ clientId, expectedVersion: current(), tagIds: draft ?? [] }), () => setDraft(null)); }}><fieldset disabled={pending} className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2">{options.map((tag) => { const on = !!draft?.includes(tag.id); return <label key={tag.id} className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm transition-colors duration-150 ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}><input type="checkbox" className="sr-only" checked={on} onChange={(event) => setDraft((d) => event.target.checked ? [...(d ?? []), tag.id] : (d ?? []).filter((id) => id !== tag.id))} />{tag.label}</label>; })}</div>
        <Buttons pending={pending} onCancel={() => setDraft(null)} />
      </fieldset></form>
    </CrmDialog>
  </>;
}

export function ClientArchiveMenuItem({ clientId, version, openOpportunityCount }: { clientId: string; version: number; openOpportunityCount: number }) {
  const { pending, run, current } = useClientAction(version);
  const [reason, setReason] = useState<string | null>(null);
  return <>
    <button type="button" role="menuitem" disabled={pending} className={MENU_ITEM} onClick={() => setReason("")}>Lưu trữ khách</button>
    <CrmDialog open={reason !== null} title="Lưu trữ khách" pending={pending} onClose={() => setReason(null)}>
      <form onSubmit={(event) => { event.preventDefault(); run(() => archiveClientAction({ clientId, expectedVersion: current(), reason: reason?.trim() || null }), () => setReason(null)); }}><fieldset disabled={pending} className="min-w-0 space-y-4">
        {openOpportunityCount > 0 && <p className="rounded-[10px] bg-[#fff7e6] px-3 py-2 text-sm text-[#b86a08]">Còn {openOpportunityCount} Cơ hội đang mở. Cơ hội vẫn giữ nguyên.</p>}
        <label className="block text-sm">Lý do lưu trữ<textarea className="tf-field mt-2 resize-y" rows={3} maxLength={500} value={reason ?? ""} onChange={(event) => setReason(event.target.value)} /></label>
        <Buttons pending={pending} onCancel={() => setReason(null)} label="Lưu trữ" />
      </fieldset></form>
    </CrmDialog>
  </>;
}

export function ClientRestoreButton({ clientId, version }: { clientId: string; version: number }) {
  const { pending, run, current } = useClientAction(version);
  return <button type="button" disabled={pending} className="tf-button-secondary" onClick={() => run(() => restoreClientAction({ clientId, expectedVersion: current() }))}>Khôi phục khách</button>;
}
