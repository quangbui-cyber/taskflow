import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { crmAllowed } from "@/lib/crm/access";
import { loadCrmActor } from "@/lib/crm/actor";
import { crmCan } from "@/lib/crm/policy";

/** crm51: duplicate merge moved to Admin → CRM → Dữ liệu; same permission as before, 404 for others. */
export default async function DuplicateClientsPage() {
  const user = await requireUser();
  if (!(await crmAllowed(user))) notFound();
  const actor = await loadCrmActor(user);
  if (!crmCan(actor, "MERGE_CLIENT")) notFound();
  redirect("/admin/crm-data?tab=duplicates");
}
