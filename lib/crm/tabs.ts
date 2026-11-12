export type CrmQuery = Record<string, string | string[] | undefined>;

export function resolveCrmTab<T extends string>(raw: unknown, keys: readonly T[], fallback: T): T {
  return typeof raw === "string" && (keys as readonly string[]).includes(raw) ? raw as T : fallback;
}
/** Tab links keep every other query (for example `task`); the default tab omits `tab`. */
export function crmTabHref(base: string, query: CrmQuery, tab: string, fallback: string): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "tab" || value === undefined) continue;
    if (typeof value === "string") next.append(key, value);
    else for (const item of value) next.append(key, item);
  }
  if (tab !== fallback) next.set("tab", tab);
  const text = next.toString();
  return text ? `${base}?${text}` : base;
}
