"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown, Plus } from "lucide-react";
import { saveCrmSettingAction, saveReasonAction, saveProgramTypeAction, saveClientTagAction, saveCompetitorAction } from "@/app/actions/crmSettings";
import { useInteraction } from "@/components/InteractionProvider";
import { parseCadenceWeeks, parsePotentialScale, parseTierMatrix, parseReminderOffsets, parseReviewPriority, type TierKey, type TierValue } from "@/lib/crm/settingsSchema";
import type { CrmSettings as Settings, CrmSettingKey } from "@/lib/crm/settings";
import type { PrepilotSection } from "@/lib/crm/prepilot";
import { TIER_LABELS, REVIEW_REASON_LABELS, REASON_GROUP_LABELS } from "@/lib/crm/labels";
import { emptyPersonaDepth, parsePersonaDepth, personaDepthConfigured, PERSONA_FIELDS, PERSONA_FIELD_LABELS, PERSONA_TIERS, type PersonaField } from "@/lib/crm/personaDepth";

export type CrmChange = { id: string; key: string; createdAt: string; userName: string; oldValue: unknown; newValue: unknown };
type Reason = { id: string; group: string; label: string; requiresNote: boolean; active: boolean; order: number };
type Program = { code: string; label: string; color: string; active: boolean; order: number };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const field = "tf-field min-w-0";
const SAVE_FAILED = "Không lưu được cấu hình. Vui lòng thử lại.";
const HISTORY_LABELS: Record<string, string> = {
  ...TIER_LABELS, ...REVIEW_REASON_LABELS, ...REASON_GROUP_LABELS,
  TIER: "Hạng khách", key: "Mã", label: "Tên", name: "Tên", code: "Mã", color: "Màu",
  active: "Đang dùng", requiresNote: "Bắt buộc ghi chú", group: "Nhóm",
  revenueBands: "Dải doanh thu", minPercentile: "Phân vị từ", cells: "Ghép hạng",
  mode: "Nguồn báo cáo", pilotTeamIds: "Team pilot", plannedCutoverDate: "Ngày chuyển thống nhất",
  PROJECT_OFFICIAL: "Project", OPPORTUNITY_OFFICIAL: "Cơ hội",
  ...PERSONA_FIELD_LABELS,
};
const historyLabel = (key: string, names: Record<string, string>) =>
  Object.hasOwn(names, key) ? names[key] : Object.hasOwn(HISTORY_LABELS, key) ? HISTORY_LABELS[key] : key;
const describe = (value: unknown, names: Record<string, string> = {}): string => {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.map((item) => describe(item, names)).join(", ") : "—";
  if (typeof value === "object") return Object.entries(value)
    .filter(([key]) => !["id", "createdAt", "updatedAt", "order"].includes(key))
    .map(([key, item]) => `${historyLabel(key, names)}: ${describe(item, names)}`).join(" · ");
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return historyLabel(String(value), names);
};

export function CrmHistory({ changes, names = {} }: { changes: CrmChange[]; names?: Record<string, string> }) {
  return <details className="mt-4 text-sm">
    <summary className="cursor-pointer text-zinc-500">Lịch sử thay đổi</summary>
    <ul className="mt-3 space-y-3">{changes.slice(0, 20).map((change) => <li key={change.id}>
      <p className="text-zinc-500">{new Date(change.createdAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · {change.userName}</p>
      <p className="break-words">{describe(change.oldValue, names)} → {describe(change.newValue, names)}</p>
    </li>)}</ul>
  </details>;
}
export function CrmConfigurationBadge() {
  return <span className="rounded-full bg-[#fff7e6] px-2 py-1 text-xs font-normal text-[#b86a08]">Chưa cấu hình</span>;
}

function Section({ title, children, changes, warning }: { title: string; children: ReactNode; changes: CrmChange[]; warning?: boolean }) {
  return <section className="tf-panel p-5">
    <h2 className="mb-4 flex flex-wrap items-center gap-3 text-base font-semibold">{title}{warning && <CrmConfigurationBadge />}</h2>
    {children}
    <CrmHistory changes={changes} />
  </section>;
}
function Save({ label, dirty, pending, onClick }: { label: string; dirty: boolean; pending: boolean; onClick: () => void }) {
  return <button type="button" className={`${dirty ? "tf-button-primary" : "tf-button-secondary"} mt-4`} disabled={!dirty || pending} onClick={onClick}>{label}</button>;
}

export default function CrmSettings({ initial, reasons, programTypes, changes, notConfigured, clientTags = [], competitors = [] }: {
  initial: Settings; reasons: Reason[]; programTypes: Program[]; changes: CrmChange[];
  clientTags?: { id: string; label: string; active: boolean; order: number }[]; competitors?: { id: string; name: string; active: boolean }[];
  notConfigured: Pick<Record<PrepilotSection, boolean>, "TIER" | "REASONS">;
}) {
  const [value, setValue] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const history = (prefix: string) => changes.filter((c) => c.key.startsWith(prefix)).slice(0, 20);
  const config = (s: Settings, key: CrmSettingKey) => {
    switch (key) {
      case "tier.cadenceWeeks": return s.cadenceWeeks;
      case "tier.potentialScale": return s.potentialScale;
      case "tier.matrix": return s.tierMatrix;
      case "reminder.offsets": return s.reminderOffsets;
      case "review.priority": return s.reviewPriority;
      case "pipeline.mode": return s.pipelineMode;
      case "persona.depth": return s.personaDepth;
      case "client.industries": return s.industries;
      case "client.sources": return s.sources;
    }
  };
  function save(key: CrmSettingKey) {
    startTransition(async () => {
      try {
        const result = await saveCrmSettingAction(key, config(value, key), baseline.versions[key]);
        if ("error" in result && result.error) { notify({ message: result.error, tone: "error" }); return; }
        setBaseline((current) => {
          const next = { ...current, versions: { ...current.versions, [key]: current.versions[key] + 1 } };
          if (key === "tier.cadenceWeeks") next.cadenceWeeks = parseCadenceWeeks(value.cadenceWeeks)!;
          if (key === "tier.potentialScale") next.potentialScale = parsePotentialScale(value.potentialScale)!;
          if (key === "tier.matrix") next.tierMatrix = parseTierMatrix(value.tierMatrix)!;
          if (key === "reminder.offsets") next.reminderOffsets = parseReminderOffsets(value.reminderOffsets)!;
          if (key === "review.priority") next.reviewPriority = parseReviewPriority(value.reviewPriority)!;
          if (key === "persona.depth") next.personaDepth = parsePersonaDepth(value.personaDepth)!;
          return next;
        });
        setValue((current) => ({
          ...current,
          ...(key === "tier.potentialScale" ? { potentialScale: parsePotentialScale(value.potentialScale)! } : {}),
          ...(key === "tier.matrix" ? { tierMatrix: parseTierMatrix(value.tierMatrix)! } : {}),
          ...(key === "reminder.offsets" ? { reminderOffsets: parseReminderOffsets(value.reminderOffsets)! } : {}),
        }));
        notify({ message: "Đã lưu cấu hình.", tone: "success" }); router.refresh();
      } catch {
        notify({ message: SAVE_FAILED, tone: "error" });
      }
    });
  }
  const dirty = (key: CrmSettingKey) => !same(config(value, key), config(baseline, key));
  const updateCadence = (tier: TierValue, weeks: number) => setValue((v) => ({ ...v, cadenceWeeks: { ...v.cadenceWeeks, [tier]: weeks } }));
  const movePriority = (index: number, delta: number) => {
    const next = [...value.reviewPriority];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setValue({ ...value, reviewPriority: next });
  };
  return <div className="space-y-6"><fieldset disabled={pending} className="min-w-0 space-y-6">
    <Section title="Hạng khách" changes={history("tier.")} warning={notConfigured.TIER}>
      <table className="w-full text-left text-sm"><thead><tr><th className="py-2 font-semibold">Hạng</th><th className="font-semibold">Chu kỳ nhắc (tuần)</th></tr></thead>
        <tbody>{(["S", "A", "B", "C", "UNRATED"] as TierValue[]).map((tier) => <tr key={tier}><td className="py-2">{TIER_LABELS[tier]}</td><td><input aria-label={`Chu kỳ ${TIER_LABELS[tier]}`} type="number" min={1} max={104} className={`${field} !w-24`} value={value.cadenceWeeks[tier]} onChange={(e) => updateCadence(tier, Number(e.target.value))} /></td></tr>)}</tbody>
      </table>
      <Save label="Lưu chu kỳ hạng" dirty={dirty("tier.cadenceWeeks")} pending={pending} onClick={() => save("tier.cadenceWeeks")} />
      <h3 className="mb-3 mt-6 font-semibold">Thang tiềm năng</h3>
      <div className="space-y-2">{value.potentialScale.map((level, index) => <div key={index} className="flex gap-2">
        <input aria-label={`Mã tiềm năng ${index + 1}`} className={`${field} !w-28`} value={level.key} onChange={(e) => setValue({ ...value, potentialScale: value.potentialScale.map((l, i) => i === index ? { ...l, key: e.target.value } : l) })} />
        <input aria-label={`Tên tiềm năng ${index + 1}`} className={`${field} flex-1`} value={level.label} onChange={(e) => setValue({ ...value, potentialScale: value.potentialScale.map((l, i) => i === index ? { ...l, label: e.target.value } : l) })} />
      </div>)}</div>
      <button type="button" className="tf-button-secondary mt-3" onClick={() => setValue({ ...value, potentialScale: [...value.potentialScale, { key: `level_${value.potentialScale.length + 1}`, label: "" }] })}><Plus size={14} />Thêm mức</button>
      <Save label="Lưu thang tiềm năng" dirty={dirty("tier.potentialScale")} pending={pending} onClick={() => save("tier.potentialScale")} />
      <h3 className="mb-3 mt-6 font-semibold">Bảng ghép hạng</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="font-semibold">Dải doanh thu</th><th className="font-semibold">Phân vị từ</th>{value.potentialScale.map((level) => <th key={level.key} className="font-semibold">{level.label}</th>)}</tr></thead>
        <tbody>{value.tierMatrix.revenueBands.map((band, index) => <tr key={band.key}>
          <td className="py-2"><input aria-label={`Tên dải doanh thu ${index + 1}`} className={field} value={band.label} onChange={(e) => setValue({ ...value, tierMatrix: { ...value.tierMatrix, revenueBands: value.tierMatrix.revenueBands.map((b, i) => i === index ? { ...b, label: e.target.value } : b) } })} /></td>
          <td><input aria-label={`Phân vị dải ${index + 1}`} className={`${field} !w-24`} type="number" min={0} max={100} value={band.minPercentile} onChange={(e) => setValue({ ...value, tierMatrix: { ...value.tierMatrix, revenueBands: value.tierMatrix.revenueBands.map((b, i) => i === index ? { ...b, minPercentile: Number(e.target.value) } : b) } })} /></td>
          {value.potentialScale.map((level) => <td key={level.key}><select aria-label={`${band.label} · ${level.label}`} className={field} value={value.tierMatrix.cells[band.key]?.[level.key] ?? ""} onChange={(e) => setValue({ ...value, tierMatrix: { ...value.tierMatrix, cells: { ...value.tierMatrix.cells, [band.key]: { ...value.tierMatrix.cells[band.key], [level.key]: e.target.value as TierKey } } } })}><option value="" disabled>Chọn hạng</option>{["S", "A", "B", "C"].map((t) => <option key={t}>{t}</option>)}</select></td>)}
        </tr>)}</tbody></table></div>
      <button type="button" className="tf-button-secondary mt-3" onClick={() => setValue({ ...value, tierMatrix: { ...value.tierMatrix, revenueBands: [...value.tierMatrix.revenueBands, { key: `band_${value.tierMatrix.revenueBands.length + 1}`, label: "", minPercentile: 0 }] } })}>Thêm dải doanh thu</button>
      <Save label="Lưu bảng ghép hạng" dirty={dirty("tier.matrix")} pending={pending} onClick={() => save("tier.matrix")} />
    </Section>
    <Section title="Độ sâu persona theo hạng" changes={history("persona.depth")} warning={!personaDepthConfigured(baseline.personaDepth)}>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
        {PERSONA_TIERS.map(tier => <fieldset key={tier} className="min-w-0 space-y-3">
          <legend className="mb-3 text-sm font-semibold">{tier === "UNRATED" ? TIER_LABELS[tier] : `Hạng ${tier}`}</legend>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" aria-label={`Thiết lập ${TIER_LABELS[tier]}`} checked={value.personaDepth[tier] !== null} onChange={event => setValue(current => ({ ...current, personaDepth: { ...current.personaDepth, [tier]: event.target.checked ? [] : null } }))} />Thiết lập yêu cầu</label>
          {value.personaDepth[tier] !== null && <div className="space-y-2">
            {PERSONA_FIELDS.map(name => <label key={name} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" aria-label={`${PERSONA_FIELD_LABELS[name]} — ${TIER_LABELS[tier]}`} checked={value.personaDepth[tier]!.includes(name)} onChange={event => setValue(current => {
              const selected = new Set<PersonaField>(current.personaDepth[tier] ?? []);
              if (event.target.checked) selected.add(name); else selected.delete(name);
              return { ...current, personaDepth: { ...current.personaDepth, [tier]: PERSONA_FIELDS.filter(field => selected.has(field)) } };
            })} />{PERSONA_FIELD_LABELS[name]}</label>)}
            {!value.personaDepth[tier]!.length && <p className="text-sm text-zinc-500">Không yêu cầu bổ sung</p>}
          </div>}
        </fieldset>)}
      </div>
      <Save label="Lưu độ sâu persona" dirty={dirty("persona.depth")} pending={pending} onClick={() => save("persona.depth")} />
      {PERSONA_TIERS.some(tier => value.personaDepth[tier] !== null) && <button type="button" className="tf-button-secondary ml-3 mt-4" onClick={() => setValue(current => ({ ...current, personaDepth: emptyPersonaDepth() }))}>Thiết lập sau</button>}
    </Section>
    <Section title="Mốc nhắc trước sự kiện" changes={history("reminder.")}>
      <div className="space-y-4">{programTypes.map((program) => <div key={program.code} className="flex flex-wrap items-center gap-2">
        <span className="w-40 text-sm">{program.label}</span>
        {(value.reminderOffsets[program.code] ?? []).map((days, index) => <label key={index} className="flex items-center gap-2 text-sm"><input aria-label={`${program.label} mốc ${index + 1}`} type="number" min={1} max={365} className={`${field} !w-20`} value={days} onChange={(e) => setValue({ ...value, reminderOffsets: { ...value.reminderOffsets, [program.code]: value.reminderOffsets[program.code].map((d, i) => i === index ? Number(e.target.value) : d) } })} />ngày<button aria-label={`Bỏ mốc ${days} ngày của ${program.label}`} type="button" onClick={() => setValue({ ...value, reminderOffsets: { ...value.reminderOffsets, [program.code]: value.reminderOffsets[program.code].filter((_, i) => i !== index) } })}>×</button></label>)}
        <button type="button" className="tf-button-secondary" onClick={() => setValue({ ...value, reminderOffsets: { ...value.reminderOffsets, [program.code]: [...(value.reminderOffsets[program.code] ?? []), 30] } })}>Thêm mốc</button>
      </div>)}</div>
      <Save label="Lưu mốc nhắc" dirty={dirty("reminder.offsets")} pending={pending} onClick={() => save("reminder.offsets")} />
    </Section>
  </fieldset>
    <ReasonEditor initial={reasons} changes={history("reason.")} warning={notConfigured.REASONS} />
    <ProgramEditor initial={programTypes} changes={history("programType.")} />
    <fieldset disabled={pending} className="min-w-0">
      <Section title="Ưu tiên trong review" changes={history("review.")}>
        <ol className="space-y-3">{value.reviewPriority.map((key, index) => <li key={key} className="flex items-center gap-3"><span className="flex-1">{index + 1}. {key === "TIER" ? "Hạng khách" : REVIEW_REASON_LABELS[key]}</span>
          <button type="button" disabled={index === 0} aria-label={`Đưa ${key === "TIER" ? "Hạng khách" : REVIEW_REASON_LABELS[key]} lên`} onClick={() => movePriority(index, -1)}><ChevronUp size={18} /></button>
          <button type="button" disabled={index === value.reviewPriority.length - 1} aria-label={`Đưa ${key === "TIER" ? "Hạng khách" : REVIEW_REASON_LABELS[key]} xuống`} onClick={() => movePriority(index, 1)}><ChevronDown size={18} /></button>
        </li>)}</ol>
        <Save label="Lưu thứ tự ưu tiên" dirty={dirty("review.priority")} pending={pending} onClick={() => save("review.priority")} />
      </Section>
    </fieldset>
    <ClientCatalogEditor title="Ngành" settingKey="client.industries" initial={initial.industries} version={initial.versions["client.industries"]} changes={history("client.industries")} addLabel="Thêm ngành" />
    <ClientCatalogEditor title="Nguồn khách" settingKey="client.sources" initial={initial.sources} version={initial.versions["client.sources"]} changes={history("client.sources")} addLabel="Thêm nguồn" />
    <ClientTagEditor initial={clientTags} changes={history("clientTag.")} />
    <CompetitorEditor initial={competitors} changes={history("competitor.")} />
    <section className="tf-panel p-5"><h2 className="mb-4 text-base font-semibold">Nhập dữ liệu tracker</h2><Link href="/admin/crm-data" className="tf-button-secondary">Mở dữ liệu CRM</Link></section>
  </div>;
}

function ReasonEditor({ initial, changes, warning }: { initial: Reason[]; changes: CrmChange[]; warning: boolean }) {
  const [rows, setRows] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const update = (index: number, patch: Partial<Reason>) => setRows(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  function save() {
    startTransition(async () => {
      try {
        for (const row of rows) {
          if (same(row, baseline.find((r) => r.id === row.id))) continue;
          const result = await saveReasonAction({ ...row, id: row.id.startsWith("new-") ? undefined : row.id });
          if (!("id" in result) || !result.id) { notify({ message: result.error ?? SAVE_FAILED, tone: "error" }); return; }
          const saved = { ...row, id: result.id, label: row.label.trim() };
          setRows((current) => current.map((r) => r.id === row.id ? saved : r));
          setBaseline((current) => [...current.filter((r) => r.id !== row.id), saved]);
        }
        notify({ message: "Đã lưu cấu hình.", tone: "success" });
      } catch {
        notify({ message: SAVE_FAILED, tone: "error" });
      } finally {
        router.refresh();
      }
    });
  }
  return <Section title="Lý do kết thúc" changes={changes} warning={warning}><fieldset disabled={pending} className="min-w-0">
    {(["LOST", "CANCELLED", "DECLINED"] as const).map((group) => <div key={group} className="mb-5 space-y-3">
      <h3 className="font-semibold">{REASON_GROUP_LABELS[group]}</h3>
      {rows.map((row, index) => row.group === group && <div key={row.id} className="flex flex-wrap items-center gap-3">
        <input aria-label={`Lý do ${index + 1}`} className={`${field} flex-1`} value={row.label} onChange={(e) => update(index, { label: e.target.value })} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.requiresNote} onChange={(e) => update(index, { requiresNote: e.target.checked })} />Bắt buộc ghi chú</label>
        <button type="button" className="tf-button-secondary" onClick={() => { if (!row.active || window.confirm(`Ẩn ${row.label} khỏi danh sách chọn? Dữ liệu đã ghi vẫn giữ nguyên.`)) update(index, { active: !row.active }); }}>{row.active ? "Ẩn" : "Hiện"}</button>
      </div>)}
      <button type="button" className="tf-button-secondary" onClick={() => setRows([...rows, { id: `new-${crypto.randomUUID()}`, group, label: "", requiresNote: false, active: true, order: rows.filter((r) => r.group === group).length }])}>Thêm lý do</button>
    </div>)}
    <Save label="Lưu lý do kết thúc" dirty={rows.some((row) => !same(row, baseline.find((r) => r.id === row.id)))} pending={pending} onClick={save} />
  </fieldset>
  </Section>;
}

function ProgramEditor({ initial, changes }: { initial: Program[]; changes: CrmChange[] }) {
  const [rows, setRows] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const update = (index: number, patch: Partial<Program>) => setRows(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  function save() {
    startTransition(async () => {
      try {
        if (new Set(rows.map((row) => row.code)).size !== rows.length) {
          notify({ message: "Mã loại chương trình đã tồn tại.", tone: "error" });
          return;
        }
        for (const [index, row] of rows.entries()) {
          if (same(row, baseline[index])) continue;
          const result = await saveProgramTypeAction(row);
          if ("error" in result && result.error) { notify({ message: result.error, tone: "error" }); return; }
          const saved = { ...row, label: row.label.trim() };
          setRows((current) => current.map((r, i) => i === index ? saved : r));
          setBaseline((current) => { const next = [...current]; next[index] = saved; return next; });
        }
        notify({ message: "Đã lưu cấu hình.", tone: "success" });
      } catch {
        notify({ message: SAVE_FAILED, tone: "error" });
      } finally {
        router.refresh();
      }
    });
  }
  return <Section title="Loại chương trình" changes={changes}><fieldset disabled={pending} className="min-w-0">
    <div className="space-y-3">{rows.map((row, index) => <div key={index} className="flex flex-wrap items-center gap-3">
      <input aria-label={`Mã chương trình ${index + 1}`} className={`${field} !w-32`} value={row.code} readOnly={!!baseline[index]} onChange={(e) => update(index, { code: e.target.value.toUpperCase() })} />
      <input aria-label={`Tên chương trình ${index + 1}`} className={`${field} flex-1`} value={row.label} onChange={(e) => update(index, { label: e.target.value })} />
      <input aria-label={`Màu ${row.label}`} type="color" value={row.color} onChange={(e) => update(index, { color: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.active} onChange={(e) => update(index, { active: e.target.checked })} />Đang dùng</label>
    </div>)}</div>
    <button type="button" className="tf-button-secondary mt-3" onClick={() => setRows([...rows, { code: "", label: "", color: "#71717a", active: true, order: rows.length }])}>Thêm loại chương trình</button>
    <Save label="Lưu loại chương trình" dirty={!same(rows, baseline)} pending={pending} onClick={save} />
  </fieldset>
  </Section>;
}


type CatalogItem = { label: string; active: boolean };
/** crm50: industry and source catalogs live in CrmSetting with CAS and history; used items are disabled, not deleted. */
export function ClientCatalogEditor({ title, settingKey, initial, version, changes, addLabel }: { title: string; settingKey: "client.industries" | "client.sources"; initial: CatalogItem[]; version: number; changes: CrmChange[]; addLabel: string }) {
  const [rows, setRows] = useState(initial);
  const [baseline, setBaseline] = useState({ rows: initial, version });
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const dirty = !same(rows, baseline.rows);
  function save() {
    startTransition(async () => {
      try {
        const value = rows.map((row) => ({ label: row.label.trim(), active: row.active }));
        const result = await saveCrmSettingAction(settingKey, value, baseline.version);
        if ("error" in result && result.error) { notify({ message: result.error, tone: "error" }); return; }
        setRows(value); setBaseline({ rows: value, version: baseline.version + 1 });
        notify({ message: "Đã lưu cấu hình.", tone: "success" }); router.refresh();
      } catch { notify({ message: SAVE_FAILED, tone: "error" }); }
    });
  }
  return <Section title={title} changes={changes}><fieldset disabled={pending} className="min-w-0">
    {rows.length ? <div className="space-y-3">{rows.map((row, index) => <div key={index} className="flex flex-wrap items-center gap-3">
      <input aria-label={`${title} ${index + 1}`} maxLength={80} className={`${field} flex-1`} value={row.label} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, label: e.target.value } : r))} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.active} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, active: e.target.checked } : r))} />Đang dùng</label>
      <button type="button" className="tf-button-secondary" aria-label={`Xóa ${row.label || `mục ${index + 1}`}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}>Xóa</button>
    </div>)}</div> : <p className="text-sm text-zinc-500">Chưa có mục nào. Bấm “{addLabel}” để tạo danh mục.</p>}
    <button type="button" className="tf-button-secondary mt-3" onClick={() => setRows([...rows, { label: "", active: true }])}><Plus size={14} />{addLabel}</button>
    <Save label={`Lưu ${title.toLocaleLowerCase("vi")}`} dirty={dirty} pending={pending} onClick={save} />
  </fieldset></Section>;
}

type TagRow = { id: string; label: string; active: boolean; order: number };
export function ClientTagEditor({ initial, changes }: { initial: TagRow[]; changes: CrmChange[] }) {
  const [rows, setRows] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const update = (index: number, patch: Partial<TagRow>) => setRows(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  function save() {
    startTransition(async () => {
      try {
        for (const [index, row] of rows.entries()) {
          if (same(row, baseline.find((r) => r.id === row.id))) continue;
          const result = await saveClientTagAction({ id: row.id.startsWith("new-") ? undefined : row.id, label: row.label, active: row.active, order: index });
          if (!("id" in result) || !result.id) { notify({ message: ("error" in result && result.error) || SAVE_FAILED, tone: "error" }); return; }
          const saved = { ...row, id: result.id, label: row.label.trim(), order: index };
          setRows((current) => current.map((r) => r.id === row.id ? saved : r));
          setBaseline((current) => [...current.filter((r) => r.id !== row.id), saved]);
        }
        notify({ message: "Đã lưu cấu hình.", tone: "success" });
      } catch { notify({ message: SAVE_FAILED, tone: "error" }); }
      finally { router.refresh(); }
    });
  }
  return <Section title="Nhãn khách" changes={changes}><fieldset disabled={pending} className="min-w-0">
    {rows.length ? <div className="space-y-3">{rows.map((row, index) => <div key={row.id} className="flex flex-wrap items-center gap-3">
      <input aria-label={`Nhãn ${index + 1}`} maxLength={60} className={`${field} flex-1`} value={row.label} onChange={(e) => update(index, { label: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.active} onChange={(e) => update(index, { active: e.target.checked })} />Đang dùng</label>
    </div>)}</div> : <p className="text-sm text-zinc-500">Chưa có nhãn. Bấm “Thêm nhãn” để tạo danh mục.</p>}
    <button type="button" className="tf-button-secondary mt-3" onClick={() => setRows([...rows, { id: `new-${crypto.randomUUID()}`, label: "", active: true, order: rows.length }])}><Plus size={14} />Thêm nhãn</button>
    <Save label="Lưu nhãn khách" dirty={rows.some((row) => !same(row, baseline.find((r) => r.id === row.id)))} pending={pending} onClick={save} />
  </fieldset></Section>;
}

type AgencyRow = { id: string; name: string; active: boolean };
export function CompetitorEditor({ initial, changes }: { initial: AgencyRow[]; changes: CrmChange[] }) {
  const [rows, setRows] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const update = (index: number, patch: Partial<AgencyRow>) => setRows(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
  function save() {
    startTransition(async () => {
      try {
        for (const row of rows) {
          if (same(row, baseline.find((r) => r.id === row.id))) continue;
          const result = await saveCompetitorAction({ id: row.id.startsWith("new-") ? undefined : row.id, name: row.name, active: row.active });
          if (!("id" in result) || !result.id) { notify({ message: ("error" in result && result.error) || SAVE_FAILED, tone: "error" }); return; }
          const saved = { ...row, id: result.id, name: row.name.trim() };
          setRows((current) => current.map((r) => r.id === row.id ? saved : r));
          setBaseline((current) => [...current.filter((r) => r.id !== row.id), saved]);
        }
        notify({ message: "Đã lưu cấu hình.", tone: "success" });
      } catch { notify({ message: SAVE_FAILED, tone: "error" }); }
      finally { router.refresh(); }
    });
  }
  return <Section title="Agency và đối thủ" changes={changes}><fieldset disabled={pending} className="min-w-0">
    {rows.length ? <div className="space-y-3">{rows.map((row, index) => <div key={row.id} className="flex flex-wrap items-center gap-3">
      <input aria-label={`Agency ${index + 1}`} maxLength={120} className={`${field} flex-1`} value={row.name} onChange={(e) => update(index, { name: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.active} onChange={(e) => update(index, { active: e.target.checked })} />Đang dùng</label>
    </div>)}</div> : <p className="text-sm text-zinc-500">Chưa có agency. Bấm “Thêm agency” để tạo danh mục.</p>}
    <button type="button" className="tf-button-secondary mt-3" onClick={() => setRows([...rows, { id: `new-${crypto.randomUUID()}`, name: "", active: true }])}><Plus size={14} />Thêm agency</button>
    <Save label="Lưu agency" dirty={rows.some((row) => !same(row, baseline.find((r) => r.id === row.id)))} pending={pending} onClick={save} />
  </fieldset></Section>;
}
