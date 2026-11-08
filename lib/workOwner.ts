export type WorkOwnerKind = "PROJECT" | "OPPORTUNITY" | "CLIENT";
export type WorkOwner = { kind: WorkOwnerKind; id: string };
export type OwnerColumns = { projectId: string | null; opportunityId: string | null; clientId: string | null };

export function ownerOrNull(row: OwnerColumns): WorkOwner | null {
  const owners: WorkOwner[] = [];
  if (row.projectId) owners.push({ kind: "PROJECT", id: row.projectId });
  if (row.opportunityId) owners.push({ kind: "OPPORTUNITY", id: row.opportunityId });
  if (row.clientId) owners.push({ kind: "CLIENT", id: row.clientId });
  if (owners.length > 1) throw new Error("Bản ghi không có đúng một nơi sở hữu.");
  return owners[0] ?? null;
}
export function ownerOf(row: OwnerColumns): WorkOwner {
  const owner = ownerOrNull(row);
  if (!owner) throw new Error("Bản ghi không có đúng một nơi sở hữu.");
  return owner;
}
export function ownerWhere(owner: WorkOwner): { projectId: string } | { opportunityId: string } | { clientId: string } {
  switch (owner.kind) {
    case "PROJECT": return { projectId: owner.id };
    case "OPPORTUNITY": return { opportunityId: owner.id };
    case "CLIENT": return { clientId: owner.id };
  }
}
export function ownerData(owner: WorkOwner): OwnerColumns {
  return { projectId: null, opportunityId: null, clientId: null, ...ownerWhere(owner) };
}
export function ownerHref(owner: WorkOwner, taskId?: string): string {
  const prefix = owner.kind === "PROJECT" ? "/projects" : owner.kind === "OPPORTUNITY" ? "/crm/opportunities" : "/crm/clients";
  return `${prefix}/${encodeURIComponent(owner.id)}${taskId ? `?task=${encodeURIComponent(taskId)}` : ""}`;
}
export function ownerRevalidatePaths(owner: WorkOwner): string[] {
  return owner.kind === "PROJECT" ? [ownerHref(owner), "/tasks"] : [ownerHref(owner), "/crm", "/tasks"];
}
export function ownerNotificationFields(owner: WorkOwner): { projectId?: string; opportunityId?: string; clientId?: string } {
  return ownerWhere(owner);
}
export function parseOwnerInput(kind: unknown, id: unknown): WorkOwner | null {
  if (kind !== "PROJECT" && kind !== "OPPORTUNITY" && kind !== "CLIENT") return null;
  if (typeof id !== "string" || !id.trim() || id.length > 64) return null;
  return { kind, id };
}
