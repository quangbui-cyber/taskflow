"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { applyImportRunAction, resolveImportRowAction } from "@/app/actions/crmImport";
import CrmDialog from "./CrmDialog";
import { IMPORT_STATUSES } from "@/lib/crm/importLabels";

export type ImportReviewRow = { id: string; sheet: string; rowNumber: number; status: string; raw: Record<string, string>; proposed: Record<string, unknown>; legacyOutcome: string | null };
type Choice = { id: string; name: string };
type Props = { runId: string; rows: ImportReviewRow[]; clients: Choice[]; accounts: Choice[]; programs: { code: string; label: string }[]; reasons: { id: string; label: string; group: string }[]; currentStatus: string; legacyLabel: string; originalLabel: string };
const text = (v: unknown) => typeof v === "string" ? v : "";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function dateInput(v: unknown) { const value = text(v); if (!value) return ""; const d = new Date(value); return Number.isFinite(d.getTime()) ? new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10) : ""; }
const vnDate = (value: string) => value ? `${value}T00:00:00+07:00` : null;
function periodLabel(value: unknown) { const p = object(value); return p.kind === "MONTH" ? `Tháng ${p.month}/${p.year}` : p.kind === "QUARTER" ? `Quý ${p.quarter}/${p.year}` : p.kind === "DATE" ? new Date(text(p.date)).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : text(p.raw) || "Chưa có"; }

export function CrmTrackerUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/crm/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.runId) { setError(result.error ?? "Không chạy thử được file."); return; }
      router.push(`/crm/import?run=${encodeURIComponent(result.runId)}`); router.refresh();
    } catch { setError("Mất kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <div><form onSubmit={upload} className="flex flex-wrap items-end gap-3"><label className="text-sm">File tracker Excel<input type="file" name="file" accept=".xlsx" required disabled={busy} className="tf-field mt-2 w-full max-w-xs text-sm" /></label><button disabled={busy} className="tf-button-secondary">{busy ? "Đang chạy thử…" : "Chạy thử"}</button></form>{error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}</div>;
}

function RowEditor({ row, accounts, programs, reasons, pending, onSave, onClose }: { row: ImportReviewRow; accounts: Choice[]; programs: Props["programs"]; reasons: Props["reasons"]; pending: boolean; onSave: (patch: Record<string, unknown>) => void; onClose: () => void }) {
  const p = row.proposed;
  const period = object(p.period);
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const kind = String(form.get("periodKind"));
    const year = Number(form.get("year"));
    const mappedPeriod = kind === "DATE" ? { kind, date: vnDate(String(form.get("periodDate"))) } : kind === "MONTH" ? { kind, year, month: Number(form.get("month")) } : kind === "QUARTER" ? { kind, year, quarter: Number(form.get("quarter")) } : null;
    onSave({ clientName: form.get("clientName"), picAccountId: form.get("picAccountId"), programTypeCode: form.get("programTypeCode") || null, reasonId: form.get("reasonId") || null, period: mappedPeriod, briefReceivedAt: vnDate(String(form.get("briefReceivedAt"))), occurredAt: vnDate(String(form.get("occurredAt"))) });
  }
  return <form onSubmit={save} className="mt-4 space-y-3 rounded-[14px] bg-zinc-50 p-4"><fieldset disabled={pending} className="grid gap-3 sm:grid-cols-2">
    <label className="text-xs">Tên khách<input name="clientName" defaultValue={text(p.clientName)} required maxLength={160} className="tf-field mt-1" /></label>
    <label className="text-xs">PIC<select name="picAccountId" defaultValue={text(p.picAccountId)} required className="tf-field mt-1"><option value="">Chọn PIC</option>{accounts.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
    <label className="text-xs">Loại chương trình<select name="programTypeCode" defaultValue={text(p.programTypeCode)} className="tf-field mt-1"><option value="">Chọn loại chương trình</option>{programs.map((a) => <option value={a.code} key={a.code}>{a.label}</option>)}</select></label>
    <label className="text-xs">Lý do<select name="reasonId" defaultValue={text(p.reasonId)} className="tf-field mt-1"><option value="">Chưa rõ</option>{reasons.map((a) => <option value={a.id} key={a.id}>{a.label}</option>)}</select></label>
    <label className="text-xs">Kiểu thời gian<select name="periodKind" defaultValue={text(period.kind) === "TEXT" ? "" : text(period.kind)} className="tf-field mt-1"><option value="">Chưa có</option><option value="DATE">Ngày</option><option value="MONTH">Tháng</option><option value="QUARTER">Quý</option></select></label>
    <label className="text-xs">Năm<input name="year" type="number" min={1900} max={2200} defaultValue={Number(period.year) || ""} className="tf-field mt-1" /></label>
    <label className="text-xs">Tháng<input name="month" type="number" min={1} max={12} defaultValue={Number(period.month) || ""} className="tf-field mt-1" /></label>
    <label className="text-xs">Quý<input name="quarter" type="number" min={1} max={4} defaultValue={Number(period.quarter) || ""} className="tf-field mt-1" /></label>
    <label className="text-xs">Ngày dự kiến<input name="periodDate" type="date" defaultValue={dateInput(period.date)} className="tf-field mt-1" /></label>
    <label className="text-xs">Ngày nhận Brief<input name="briefReceivedAt" type="date" defaultValue={dateInput(p.briefReceivedAt)} className="tf-field mt-1" /></label>
    <label className="text-xs">Ngày điểm chạm<input name="occurredAt" type="date" defaultValue={dateInput(p.occurredAt)} className="tf-field mt-1" /></label>
  </fieldset><div className="flex gap-2"><button type="submit" disabled={pending} className="tf-button-secondary">Lưu ánh xạ</button><button type="button" disabled={pending} onClick={onClose} className="tf-button-secondary">Hủy sửa</button></div></form>;
}

export default function CrmImportReview({ runId, rows, clients, accounts, programs, reasons, currentStatus, legacyLabel, originalLabel }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<ImportReviewRow | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<{ rowId: string; label: string; error: string }[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});
  function resolve(row: ImportReviewRow, action: "MATCH" | "CREATE_NEW" | "EDIT" | "SKIP", patch?: Record<string, unknown>) {
    setError(""); setMessage("");
    startTransition(async () => {
      try {
        const result = await resolveImportRowAction({ rowId: row.id, action, matchedClientId: matches[row.id] ?? text(row.proposed.matchedClientId), proposedPatch: patch });
        if (result.error) { setError(result.error); return; }
        setMessage(result.success ?? "Đã lưu."); setEditing(null); setSkipping(null); setRowErrors((value) => value.filter((e) => e.rowId !== row.id)); router.refresh();
      } catch { setError("Mất kết nối. Vui lòng thử lại."); }
    });
  }
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-4"><nav aria-label="Lọc dòng nhập" className="flex flex-wrap gap-2">{[["", "Tất cả"], ...["DUPLICATE", "UNCLEAR", "TEXT_DATE", "MISSING_PIC", "CONFIRMED"].map((s) => [s, IMPORT_STATUSES[s]])].map(([key, label]) => <Link key={key} href={`/crm/import?${new URLSearchParams({ run: runId, ...(key ? { status: key } : {}) })}`} aria-current={currentStatus === key ? "page" : undefined} className={`rounded-full px-3 py-2 text-xs ${currentStatus === key ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-100"}`}>{label}</Link>)}</nav>
    <button className="tf-button-primary" disabled={pending} onClick={() => { setError(""); setMessage(""); startTransition(async () => { try { const result = await applyImportRunAction(runId); if (result.error) { setError(result.error); return; } setMessage(result.success ?? "Đã nhập."); setRowErrors(result.errors ?? []); router.refresh(); } catch { setError("Mất kết nối. Vui lòng thử lại."); } }); }}>{pending ? "Đang xử lý…" : "Nhập các dòng đã xác nhận"}</button></div>
    {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{rowErrors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-700">{rowErrors.map((e) => <li key={e.rowId}>{e.label}: {e.error}</li>)}</ul>}
    <div className="tf-panel max-w-full overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Rà dữ liệu nhập</caption><thead><tr>{["Sheet và dòng", originalLabel, "Ánh xạ đề xuất", "Trạng thái", "Thao tác"].map((label) => <th scope="col" key={label} className="px-4 py-3 text-xs font-semibold text-zinc-500">{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{rows.map((row) => {
      const p = row.proposed; const applied = !!p.applied; const disabled = pending || applied || row.status === "SKIPPED";
      const selected = matches[row.id] ?? text(p.matchedClientId); const selectedClient = clients.find((c) => c.id === selected);
      return <tr key={row.id} className="align-top"><th scope="row" className="whitespace-nowrap px-4 py-4 font-medium">{row.sheet} · dòng {row.rowNumber}</th>
        <td className="min-w-60 max-w-sm px-4 py-4"><dl className="space-y-2 font-mono text-xs">{Object.entries(row.raw).map(([key, value]) => <div key={key}><dt className="text-zinc-500">{key}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl></td>
        <td className="min-w-72 px-4 py-4"><div className="space-y-2"><p className="font-medium">{text(p.clientName) || "Chưa có tên khách"}</p><p className="text-xs text-zinc-500">PIC: {accounts.find((a) => a.id === p.picAccountId)?.name ?? "Chưa giao"}</p>{p.programTypeCode ? <p className="text-xs">{programs.find((a) => a.code === p.programTypeCode)?.label ?? text(p.programTypeCode)}</p> : null}{p.period ? <p className="text-xs">Thời gian: {periodLabel(p.period)}</p> : null}{row.legacyOutcome !== null && <div className="space-y-1"><span className="rounded-full bg-[#fff7e6] px-2 py-1 text-xs text-[#b86a08]">{legacyLabel}</span><p className="whitespace-pre-wrap break-words font-mono text-xs">{originalLabel}: {row.legacyOutcome}</p></div>}</div>
          {editing === row.id && <RowEditor row={row} accounts={accounts} programs={programs} reasons={reasons} pending={pending} onClose={() => setEditing(null)} onSave={(patch) => resolve(row, "EDIT", patch)} />}</td>
        <td className="px-4 py-4"><span className={`inline-block whitespace-nowrap rounded-full px-2 py-1 text-xs ${applied || row.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700" : row.status === "SKIPPED" || row.status === "OK" ? "bg-zinc-100 text-zinc-600" : "bg-[#fff7e6] text-[#b86a08]"}`}>{applied ? "Đã nhập" : IMPORT_STATUSES[row.status] ?? row.status}</span></td>
        <td className="min-w-48 px-4 py-4"><div className="flex flex-col items-start gap-2">{!applied && row.status !== "SKIPPED" && <>
          {row.status === "DUPLICATE" && <><label className="w-full text-xs">Khách hiện có<select className="tf-field mt-1 w-full" value={selected} disabled={pending} onChange={(event) => setMatches({ ...matches, [row.id]: event.target.value })}><option value="">Chọn khách</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="tf-button-secondary text-xs" disabled={disabled || !selected} onClick={() => resolve(row, "MATCH")}>Ghép với {selectedClient?.name ?? "khách"}</button><button className="tf-button-secondary text-xs" disabled={disabled} onClick={() => resolve(row, "CREATE_NEW")}>Tạo khách mới</button></>}
          <button className="tf-button-secondary text-xs" disabled={disabled} onClick={() => { setEditing(row.id); setError(""); }}>Sửa</button><button className="tf-button-danger text-xs" disabled={disabled} onClick={() => { setSkipping(row); setError(""); }}>Bỏ dòng</button>
        </>}</div></td></tr>;
    })}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-zinc-500">Không có dòng phù hợp.</p>}</div>
    <CrmDialog open={!!skipping} title={skipping ? `Bỏ dòng ${skipping.sheet} ${skipping.rowNumber} khỏi lượt nhập này?` : "Bỏ dòng"} pending={pending} onClose={() => setSkipping(null)}><div className="flex justify-end gap-3"><button className="tf-button-secondary" disabled={pending} onClick={() => setSkipping(null)}>Hủy</button><button className="tf-button-danger" disabled={pending} onClick={() => { if (skipping) resolve(skipping, "SKIP"); }}>Bỏ dòng</button></div>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}</CrmDialog>
  </div>;
}
