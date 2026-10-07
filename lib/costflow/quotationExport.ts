import "server-only";
import { loadFinance } from "./service";
import { projectQuotation } from "./quotationProjection";

export async function getQuotationExport(projectId: string, quotationId: string, actor: { id: string; role: string }) {
  const finance = await loadFinance(projectId, actor);
  if (!finance?.fullAccess) return null;
  const quotation = finance.data.quotations?.find(q => q.id === quotationId);
  return quotation ? { project: finance.project.name, quotation, customerQuotation: projectQuotation(quotation) } : null;
}
