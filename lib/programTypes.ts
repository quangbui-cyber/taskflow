import type { Prisma, PrismaClient } from "@prisma/client";
import { projectTypeInfo } from "./types";
export const LEGACY_PROGRAM_CODES = ["TEAMBUILDING", "MICE", "ACTIVATION", "EVENT", "PUR", "OTHER"];
export function loadProgramTypes(db: PrismaClient | Prisma.TransactionClient, { activeOnly = false }: { activeOnly?: boolean } = {}) {
  return db.programType.findMany({ where: activeOnly ? { active: true } : {}, orderBy: [{ order: "asc" }, { label: "asc" }] });
}
type Program = { code: string; label: string; color: string; active: boolean };
export function programTypeDisplay(types: Program[], code: string) {
  const type = types.find((t) => t.code === code);
  const legacy = LEGACY_PROGRAM_CODES.includes(code) ? projectTypeInfo(code) : null;
  return { code, label: type?.label ?? legacy?.label ?? code, color: type?.color ?? legacy?.color ?? "#71717a", className: legacy?.className ?? "bg-zinc-100 text-zinc-700" };
}
export function isActiveProgramType(types: Program[], code: string): boolean { return types.some((t) => t.code === code && t.active); }
