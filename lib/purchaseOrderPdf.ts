import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { parsePurchaseOrder } from "@/lib/purchaseOrder";

export async function parsePurchaseOrderPdf(data: Uint8Array) {
  // pdf-parse transfers/detaches the ArrayBuffer it receives. Parse a copy so
  // callers can still reuse the original bytes (for example, to store the PO).
  const parserData = Uint8Array.from(data);
  const parser = new PDFParse({ data: parserData });
  try {
    const result = await parser.getText({ first: 5 });
    return parsePurchaseOrder(result.text);
  } finally {
    await parser.destroy();
  }
}
