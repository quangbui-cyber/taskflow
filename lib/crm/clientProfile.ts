import { clientNameKey } from "../clientCatalog";
import { clientDuplicateKey } from "./clientMerge";

export type Normalized = { ok: true; value: string | null } | { error: string };
export const CLIENT_NOTES_MAX = 2000;
export const CLIENT_PARENT_MAX_LEVELS = 3;
const TAX_CODE = /^\d{10}(?:-\d{3})?$/;
const TAX_CODE_ERROR = "Mã số thuế gồm 10 chữ số hoặc 10 chữ số-3 chữ số.";
const WEBSITE_ERROR = "Website không hợp lệ.";

/** Only whitespace is removed; any other shape is rejected so a wrong code is never silently rewritten. */
export function normalizeTaxCode(raw: string | null | undefined): Normalized {
  const value = (raw ?? "").replace(/\s+/g, "");
  if (!value) return { ok: true, value: null };
  return TAX_CODE.test(value) ? { ok: true, value } : { error: TAX_CODE_ERROR };
}

export function normalizeWebsite(raw: string | null | undefined): Normalized {
  const text = (raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > 200 || /\s/.test(text)) return { error: WEBSITE_ERROR };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { return { error: WEBSITE_ERROR }; }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return { error: WEBSITE_ERROR };
  const value = url.toString().replace(/\/$/, "");
  return value.length <= 200 ? { ok: true, value } : { error: WEBSITE_ERROR };
}

export function validateClientNotes(value: string | null | undefined): string | null {
  return value && value.trim().length > CLIENT_NOTES_MAX ? `Ghi chú tối đa ${CLIENT_NOTES_MAX} ký tự.` : null;
}

/** parents maps every known client id to its current parent id. Levels count from the top company (1). */
export function validateParentChain(input: { clientId: string; parentId: string | null; parents: Map<string, string | null> }): string | null {
  const { clientId, parentId, parents } = input;
  if (parentId === null) return null;
  if (parentId === clientId) return "Khách không thể là công ty mẹ của chính mình.";
  if (!parents.has(parentId)) return "Không tìm thấy công ty mẹ.";
  let parentLevel = 0;
  const seen = new Set<string>();
  for (let cursor: string | null = parentId; cursor !== null; cursor = parents.get(cursor) ?? null) {
    if (cursor === clientId) return "Chọn công ty mẹ này sẽ tạo vòng lặp trong tập đoàn.";
    if (seen.has(cursor)) return "Chọn công ty mẹ này sẽ tạo vòng lặp trong tập đoàn.";
    seen.add(cursor); parentLevel++;
  }
  const children = new Map<string, string[]>();
  for (const [id, parent] of parents) if (parent !== null && id !== clientId) children.set(parent, [...(children.get(parent) ?? []), id]);
  const height = (id: string, guard: Set<string>): number => {
    if (guard.has(id)) return 0;
    guard.add(id);
    return 1 + Math.max(0, ...(children.get(id) ?? []).map((child) => height(child, guard)));
  };
  return parentLevel + height(clientId, new Set()) > CLIENT_PARENT_MAX_LEVELS ? `Tập đoàn tối đa ${CLIENT_PARENT_MAX_LEVELS} cấp.` : null;
}

export type ClientFieldDiff = { field: string; oldValue: unknown; newValue: unknown };
/** Fields missing from `after` are untouched; values are compared structurally. */
export function diffClientFields(before: Record<string, unknown>, after: Record<string, unknown>): ClientFieldDiff[] {
  const out: ClientFieldDiff[] = [];
  for (const [field, newValue] of Object.entries(after)) {
    if (newValue === undefined) continue;
    const oldValue = before[field] ?? null;
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue ?? null)) out.push({ field, oldValue, newValue: newValue ?? null });
  }
  return out;
}

export type MatchCandidate = { id: string; name: string; taxCode: string | null; aliasKeys: string[] };
export type ClientMatch = { by: "TAX_CODE" | "ALIAS" | "NAME" | null; ids: string[] };
/** Import and duplicate detection: tax code, then alias key, then exact normalized name. */
export function matchClient(input: { name: string; taxCode?: string | null }, candidates: MatchCandidate[]): ClientMatch {
  const tax = normalizeTaxCode(input.taxCode);
  if ("ok" in tax && tax.value) {
    const ids = candidates.filter((c) => c.taxCode === tax.value).map((c) => c.id);
    if (ids.length) return { by: "TAX_CODE", ids };
  }
  const alias = clientDuplicateKey(input.name);
  const aliasIds = candidates.filter((c) => c.aliasKeys.includes(alias)).map((c) => c.id);
  if (aliasIds.length) return { by: "ALIAS", ids: aliasIds };
  const name = clientNameKey(input.name);
  const nameIds = candidates.filter((c) => clientNameKey(c.name) === name).map((c) => c.id);
  return nameIds.length ? { by: "NAME", ids: nameIds } : { by: null, ids: [] };
}

export const CLIENT_FIELD_LABELS: Record<string, string> = {
  picAccountId: "PIC", responsibleTeamId: "Team", potentialLevel: "Tiềm năng",
  industry: "Ngành", budgetSeason: "Mùa lập ngân sách", budgetSeasonMonth: "Tháng lập ngân sách", vendorSelection: "Cách chọn nhà cung cấp", valuedMost: "Điều khách coi trọng",
  taxCode: "Mã số thuế", legalName: "Tên pháp lý", shortName: "Tên ngắn", website: "Website", address: "Địa chỉ",
  parentClientId: "Công ty mẹ", acquisitionSource: "Nguồn khách", referredBy: "Người giới thiệu", notes: "Ghi chú",
  archived: "Lưu trữ", tags: "Nhãn", aliases: "Tên gọi khác", competitors: "Agency đang phục vụ",
};

const EMPTY = "Chưa có";
/** History values are stored as raw values or { id, name } references; this renders them in Vietnamese. */
export function describeClientFieldValue(field: string, value: unknown, potentialLabels: Record<string, string> = {}): string {
  if (field === "archived") return value === null || value === undefined ? "Đang dùng" : `Lưu trữ${typeof (value as { reason?: unknown }).reason === "string" ? ` (${(value as { reason: string }).reason})` : ""}`;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return EMPTY;
  if (Array.isArray(value)) return value.map((item) => describeClientFieldValue(field, item, potentialLabels)).join(", ");
  if (typeof value === "object") return typeof (value as { name?: unknown }).name === "string" ? (value as { name: string }).name : EMPTY;
  if (field === "potentialLevel") return Object.hasOwn(potentialLabels, String(value)) ? potentialLabels[String(value)] : String(value);
  if (field === "budgetSeasonMonth") return `Tháng ${value}`;
  return String(value);
}
export function describeClientFieldChange(change: { field: string; oldValue: unknown; newValue: unknown }, potentialLabels: Record<string, string> = {}) {
  const label = Object.hasOwn(CLIENT_FIELD_LABELS, change.field) ? CLIENT_FIELD_LABELS[change.field] : change.field;
  if (change.field === "archived") return { label, text: change.newValue === null ? "Khôi phục khách" : describeClientFieldValue("archived", change.newValue) };
  return { label, text: `${describeClientFieldValue(change.field, change.oldValue, potentialLabels)} → ${describeClientFieldValue(change.field, change.newValue, potentialLabels)}` };
}
