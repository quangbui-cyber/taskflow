import type { TierValue } from "./settingsSchema";

export const PERSONA_TIERS = ["S", "A", "B", "C", "UNRATED"] as const;
export const PERSONA_FIELDS = ["budgetSeason", "budgetSeasonMonth", "vendorSelection", "valuedMost"] as const;
export type PersonaField = typeof PERSONA_FIELDS[number];
export type PersonaDepth = Record<TierValue, PersonaField[] | null>;
export type PersonaValues = Partial<{ budgetSeason: string | null; budgetSeasonMonth: number | null; vendorSelection: string | null; valuedMost: string | null }>;
export const PERSONA_FIELD_LABELS: Record<PersonaField, string> = {
  budgetSeason: "Mùa lập ngân sách", budgetSeasonMonth: "Tháng lập ngân sách",
  vendorSelection: "Cách chọn nhà cung cấp", valuedMost: "Điều khách coi trọng",
};

export function emptyPersonaDepth(): PersonaDepth {
  return { S: null, A: null, B: null, C: null, UNRATED: null };
}

export function parsePersonaDepth(value: unknown): PersonaDepth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = value as Record<string, unknown>;
  if (Object.keys(rows).length !== PERSONA_TIERS.length || PERSONA_TIERS.some(tier => !Object.hasOwn(rows, tier))) return null;
  const result = emptyPersonaDepth();
  for (const tier of PERSONA_TIERS) {
    const row = rows[tier];
    if (row === null) continue;
    if (!Array.isArray(row) || row.length > PERSONA_FIELDS.length || new Set(row).size !== row.length || row.some(field => !PERSONA_FIELDS.includes(field))) return null;
    result[tier] = PERSONA_FIELDS.filter(field => row.includes(field));
  }
  return result;
}

export function personaDepthConfigured(value: PersonaDepth): boolean {
  return PERSONA_TIERS.every(tier => value[tier] !== null);
}

export function assessPersonaDepth(policy: PersonaDepth, tier: TierValue, values: PersonaValues) {
  const expected = policy[tier];
  const missing = (expected ?? []).filter(field => {
    if (field === "budgetSeasonMonth") return !Number.isInteger(values[field]) || values[field]! < 1 || values[field]! > 12;
    return !values[field]?.trim();
  });
  const status = expected === null ? "NOT_CONFIGURED" : !expected.length ? "NO_REQUIREMENTS" : missing.length ? "INCOMPLETE" : "COMPLETE";
  return { status, expected: expected ?? [], missing };
}
