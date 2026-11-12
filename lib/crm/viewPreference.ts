/** crm51: per-user view choice for list pages. The URL wins; the cookie only fills in a missing `view`. */
export const CRM_VIEWS = { clients: ["map", "cards", "table"], opportunities: ["board", "timeline", "list"] } as const;
export type CrmViewPage = keyof typeof CRM_VIEWS;
export type CrmView<P extends CrmViewPage> = typeof CRM_VIEWS[P][number];
export const crmViewCookieName = (page: CrmViewPage) => `tf_crm_view_${page}`;
export function isCrmView<P extends CrmViewPage>(page: P, value: unknown): value is CrmView<P> {
  return typeof value === "string" && (CRM_VIEWS[page] as readonly string[]).includes(value);
}
/** Cookie value is `userId:view`, so a shared browser never applies another person's choice. */
export function crmViewCookieValue(userId: string, view: string): string { return `${userId}:${view}`; }
export function resolveCrmView<P extends CrmViewPage>(page: P, param: unknown, cookie: string | undefined, userId: string): CrmView<P> {
  if (isCrmView(page, param)) return param;
  if (cookie) {
    const index = cookie.lastIndexOf(":");
    const view = cookie.slice(index + 1);
    if (index > 0 && cookie.slice(0, index) === userId && isCrmView(page, view)) return view;
  }
  return CRM_VIEWS[page][0];
}
