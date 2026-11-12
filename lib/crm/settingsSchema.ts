export type TierKey = "S" | "A" | "B" | "C";
export type TierValue = TierKey | "UNRATED";
export type CadenceWeeks = Record<TierValue, number>;
export type PotentialLevel = { key: string; label: string };
export type RevenueBand = { key: string; label: string; minPercentile: number };
export type TierMatrix = { revenueBands: RevenueBand[]; cells: Record<string, Record<string, TierKey>> };
export type ReminderOffsets = Record<string, number[]>;
export type ReviewPriorityKey = "APPOINTMENT" | "PLAN_CLOSE" | "ESCALATED" | "TIER";
export const DEFAULT_CADENCE_WEEKS: CadenceWeeks = { S: 2, A: 4, B: 8, C: 13, UNRATED: 4 };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const safeKey = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
export function parseCadenceWeeks(value: unknown): CadenceWeeks | null {
  if (!record(value)) return null;
  const result = {} as CadenceWeeks;
  for (const key of Object.keys(DEFAULT_CADENCE_WEEKS) as TierValue[]) {
    const n = value[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 104) return null;
    result[key] = n;
  }
  return result;
}
export function parsePotentialScale(value: unknown): PotentialLevel[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: PotentialLevel[] = [];
  for (const row of value) {
    if (!record(row) || !safeKey(row.key) || typeof row.label !== "string" || !row.label.trim() || row.label.length > 200 || result.some(({ key }) => key === row.key)) return null;
    result.push({ key: row.key, label: row.label.trim() });
  }
  return result;
}
export function parseTierMatrix(value: unknown): TierMatrix | null {
  if (!record(value) || !Array.isArray(value.revenueBands) || !record(value.cells) || value.revenueBands.length > 100) return null;
  const revenueBands: RevenueBand[] = [];
  const cells: TierMatrix["cells"] = {};
  for (const band of value.revenueBands) {
    if (!record(band) || !safeKey(band.key) || typeof band.label !== "string" || !band.label.trim() || typeof band.minPercentile !== "number" || !Number.isFinite(band.minPercentile) || band.minPercentile < 0 || band.minPercentile > 100 || revenueBands.some((b) => b.key === band.key || b.minPercentile === band.minPercentile)) return null;
    revenueBands.push({ key: band.key, label: band.label.trim(), minPercentile: band.minPercentile });
  }
  for (const [band, row] of Object.entries(value.cells)) {
    if (!safeKey(band) || !revenueBands.some(({ key }) => key === band) || !record(row)) return null;
    cells[band] = {};
    for (const [level, tier] of Object.entries(row)) {
      if (!safeKey(level) || !["S", "A", "B", "C"].includes(String(tier))) return null;
      cells[band][level] = tier as TierKey;
    }
  }
  return { revenueBands, cells };
}
export function parseReminderOffsets(value: unknown): ReminderOffsets | null {
  if (!record(value)) return null;
  const result: ReminderOffsets = {};
  for (const [key, offsets] of Object.entries(value)) {
    if (!safeKey(key) || !Array.isArray(offsets) || offsets.length > 365 || offsets.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) return null;
    result[key] = [...new Set<number>(offsets)].sort((a, b) => b - a);
  }
  return result;
}
export function parseReviewPriority(value: unknown): ReviewPriorityKey[] | null {
  const keys = ["APPOINTMENT", "PLAN_CLOSE", "ESCALATED", "TIER"];
  return Array.isArray(value) && value.length === 4 && new Set(value).size === 4 && value.every((v) => keys.includes(v)) ? [...value] : null;
}
export function isTierConfigured(matrix: TierMatrix | null, scale: PotentialLevel[]): boolean {
  return !!matrix && scale.length > 0 && matrix.revenueBands.length > 0 && matrix.revenueBands.some((band) => band.minPercentile === 0) && matrix.revenueBands.every((band) => scale.every((level) => !!matrix.cells[band.key]?.[level.key]));
}

/** crm50: Admin catalogs for industry and acquisition source. Items are disabled, never silently dropped. */
export type ClientCatalogItem = { label: string; active: boolean };
export const CLIENT_CATALOG_LABEL_MAX = 80;
export const catalogLabelKey = (label: string) => label.normalize("NFKC").trim().replace(/s+/g, " ").toLocaleLowerCase("vi");
export function parseClientCatalog(value: unknown): ClientCatalogItem[] | null {
  if (!Array.isArray(value) || value.length > 200) return null;
  const result: ClientCatalogItem[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!record(row) || typeof row.label !== "string" || typeof row.active !== "boolean") return null;
    const label = row.label.normalize("NFKC").trim().replace(/s+/g, " ");
    if (!label || label.length > CLIENT_CATALOG_LABEL_MAX || seen.has(catalogLabelKey(label))) return null;
    seen.add(catalogLabelKey(label));
    result.push({ label, active: row.active });
  }
  return result;
}
