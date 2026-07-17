import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { parsePurchaseOrder } from "@/lib/purchaseOrder";

export async function parsePurchaseOrderPdf(data: Uint8Array) {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText({ first: 5 });
    return parsePurchaseOrder(result.text);
  } finally {
    await parser.destroy();
  }
}
