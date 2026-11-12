import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";

/** crm51: tracker import moved to Admin → CRM → Dữ liệu. Permitted users are redirected; others get 404 like flag-off. */
export default async function CrmImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "REVIEW_IMPORT")) notFound();
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ["run", "status", "page"]) { const value = params[key]; if (typeof value === "string" && value.length <= 64) query.set(key, value); }
  redirect(query.size ? `/admin/crm-data?${query}` : "/admin/crm-data");
}
