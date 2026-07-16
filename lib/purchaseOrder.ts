export type PurchaseOrderDraft = {
  provider: "JABIL";
  poNumber: string;
  poDate: string | null;
  clientName: string;
  name: string;
  description: string;
  revenue: number;
  currency: string;
  itemDescription: string;
  needBy: string | null;
  quantity: number | null;
  unitPrice: number | null;
  contactName: string | null;
  contactEmail: string | null;
  items: PurchaseOrderItem[];
  confidence: "high" | "medium";
  warnings: string[];
};

export type PurchaseOrderItem = {
  line: number;
  description: string;
  notes: string[];
  needBy: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
};

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return value;
  return `${match[2]}/${match[1]}/${match[3]}`;
}

function cleanItemTitle(value: string): string {
  const vietnamese =
    value.split(/\n?Note:/i)[0]?.split("/")[0]?.trim() || value.trim();
  return vietnamese
    .replace(/giá\s+bao\s+gồm\s+VAT\)?/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+-\s+/g, " - ")
    .trim();
}

function extractItems(text: string): PurchaseOrderItem[] {
  const lineSection = text.match(
    /Line\s+Description\s+Need By Qty\s+Unit\s+Price\s+Total\s+([\s\S]*?)(?:\*\*INVOICING|According to Circular)/i
  )?.[1];
  if (!lineSection) return [];

  const itemPattern =
    /(?:^|\n)(\d+)\s+([\s\S]*?)\n(\d{2}\/\d{2}\/\d{4})\s+([\d,.]+)\s+(.+?)\s+([\d,.]+)\s+([\d,.]+)\nAsset Tags:[\s\S]*?Chart of Account:[^\n]+/g;

  return [...lineSection.matchAll(itemPattern)].map((match) => {
    const parts = match[2]
      .split(/\n(?=Note:)/i)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    return {
      line: Number(match[1]),
      description: parts[0] || "Hạng mục theo PO",
      notes: parts.slice(1).map((note) => note.replace(/^Note:\s*/i, "")),
      needBy: formatDate(match[3]),
      quantity: parseMoney(match[4]),
      unit: match[5].replace(/\s+/g, " ").trim(),
      unitPrice: parseMoney(match[6]),
      total: parseMoney(match[7]),
    };
  });
}

function extractClientName(text: string): string {
  const heading = text.match(
    /^(.*?)\s+PURCHASE ORDER/im
  )?.[1];
  return heading?.replace(/\s+/g, " ").trim() || "Jabil";
}

export function parsePurchaseOrder(text: string): PurchaseOrderDraft {
  if (!/\bJabil\b/i.test(text) || !/PURCHASE ORDER/i.test(text)) {
    throw new Error("Hiện tại app chỉ hỗ trợ mẫu PO của Jabil.");
  }

  const poNumber = text.match(/\bC-\d{8,}\b/i)?.[0] ?? "";
  const poDateRaw = text.match(
    new RegExp(`${poNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(\\d{2}\\/\\d{2}\\/\\d{4})`, "i")
  )?.[1];
  const paymentTerms =
    text.match(/\bSTD\s+(?:\d+\s+Days?\s+NET|Advanced Payment)\b/i)?.[0] ??
    null;
  const currency = text.match(/\b(?:VND|USD|EUR)\b/)?.[0] ?? "VND";
  const contactMatch = text.match(
    /(?:^|\n)([^\n]+)\n([A-Z0-9._%+-]+@Jabil\.com)/i
  );
  const contactName = contactMatch?.[1]?.trim() ?? null;
  const contactEmail = contactMatch?.[2]?.trim() ?? null;
  const items = extractItems(text);
  const itemDescription =
    items.map((item) => cleanItemTitle(item.description)).join("; ") ||
    "Hạng mục theo PO";
  const commonNeedBy =
    items.length > 0 &&
    items.every((item) => item.needBy === items[0]?.needBy)
      ? items[0]?.needBy ?? null
      : null;
  const quantity = items.reduce(
    (total, item) => total + (item.quantity ?? 0),
    0
  );
  const unitPrice = items.length === 1 ? items[0]?.unitPrice ?? null : null;
  const summaryTotal = text.match(
    /[\d,.]+\s+Units\s+([\d,.]+)\s+(?:VND|USD|EUR)\b/i
  )?.[1];
  const revenue =
    parseMoney(summaryTotal) ??
    items.reduce((total, item) => total + (item.total ?? 0), 0);
  const clientName = extractClientName(text);
  const itemTitles = items.map((item) => cleanItemTitle(item.description));
  const title =
    itemTitles.length <= 2
      ? itemTitles.join(" & ")
      : `${itemTitles[0]} và ${itemTitles.length - 1} hạng mục`;
  const clientShortName = clientName.split(/\s+/)[0] || "Jabil";
  const warnings: string[] = [];

  if (!poNumber) warnings.push("Không nhận diện được số PO.");
  if (!revenue) warnings.push("Không nhận diện được giá trị PO.");
  if (items.length === 0) {
    warnings.push("Cần kiểm tra lại mô tả và chi tiết hạng mục.");
  }

  const descriptionLines = [
    poNumber ? `PO: ${poNumber}` : null,
    poDateRaw ? `Ngày PO: ${formatDate(poDateRaw)}` : null,
    ...items.map((item) => {
      const details = [
        item.quantity !== null
          ? `${new Intl.NumberFormat("vi-VN").format(item.quantity)}${item.unit ? ` ${item.unit}` : ""}`
          : null,
        item.unitPrice !== null
          ? `đơn giá ${new Intl.NumberFormat("vi-VN").format(item.unitPrice)} ${currency}`
          : null,
        item.total !== null
          ? `thành tiền ${new Intl.NumberFormat("vi-VN").format(item.total)} ${currency}`
          : null,
        item.needBy ? `ngày cần ${item.needBy}` : null,
      ].filter(Boolean);
      const notes =
        item.notes.length > 0 ? `\nGhi chú: ${item.notes.join("; ")}` : "";
      return `Hạng mục ${item.line}: ${item.description}${details.length ? ` (${details.join(", ")})` : ""}${notes}`;
    }),
    paymentTerms ? `Thanh toán: ${paymentTerms}` : null,
    contactName || contactEmail
      ? `Liên hệ: ${[contactName, contactEmail].filter(Boolean).join(" - ")}`
      : null,
  ].filter((line): line is string => Boolean(line));

  return {
    provider: "JABIL",
    poNumber,
    poDate: formatDate(poDateRaw),
    clientName,
    name: `[${clientShortName}] ${title || poNumber || "Dự án từ PO"}`,
    description: descriptionLines.join("\n"),
    revenue,
    currency,
    itemDescription,
    needBy: commonNeedBy,
    quantity: quantity || null,
    unitPrice,
    contactName,
    contactEmail,
    items,
    confidence: warnings.length === 0 ? "high" : "medium",
    warnings,
  };
}
