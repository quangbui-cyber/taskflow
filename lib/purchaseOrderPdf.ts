import { parsePurchaseOrder } from "@/lib/purchaseOrder";
import { extractText, getDocumentProxy } from "unpdf";

export async function parsePurchaseOrderPdf(data: Uint8Array) {
  // Parse a copy so callers can still reuse the original bytes (for example,
  // to store the PO) even if the PDF runtime transfers the ArrayBuffer.
  const parserData = Uint8Array.from(data);
  const document = await getDocumentProxy(parserData);
  try {
    const result = await extractText(document);
    return parsePurchaseOrder(result.text.slice(0, 5).join("\n\n"));
  } finally {
    await document.cleanup();
  }
}
