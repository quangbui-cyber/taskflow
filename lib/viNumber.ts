// Đọc và hiển thị số kiểu Việt Nam: "1.234.567,5" ↔ 1234567.5.

/**
 * Đọc số người dùng gõ. Dấu chấm là phân cách hàng nghìn, dấu phẩy là phần lẻ.
 * Trả về null khi để trống, NaN khi gõ không phải số.
 */
export function parseViNumber(raw: string): number | null {
  const text = raw.replace(/\s/g, "");
  if (!text) return null;
  if (!/^[0-9.,]+$/.test(text)) return Number.NaN;
  const commaCount = (text.match(/,/g) ?? []).length;
  if (commaCount > 1) return Number.NaN;
  const [whole, fraction = ""] = text.split(",");
  const digits = whole.replace(/\./g, "");
  if (!digits && !fraction) return Number.NaN;
  return Number(`${digits || "0"}.${fraction || "0"}`);
}

/** Hiển thị số: tối đa `decimals` chữ số lẻ, bỏ số 0 thừa. */
export function formatViNumber(value: number | null, decimals = 2) {
  if (value === null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value);
}
