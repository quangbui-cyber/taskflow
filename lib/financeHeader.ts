import { formatExecutionRange } from "./dates";

/**
 * Thông tin chung ở đầu Báo giá, IC và AC. Thứ tự này cũng là thứ tự in ra file.
 * Mục nào để trống thì không in ra (Excel/PDF), để bản xuất gọn và đẹp.
 */
export const FINANCE_HEADER_FIELDS = [
  { key: "clientName", label: "Khách hàng" },
  { key: "programName", label: "Tên chương trình" },
  { key: "headcount", label: "Số lượng" },
  { key: "location", label: "Địa điểm" },
  { key: "eventTime", label: "Thời gian" },
] as const;

export type FinanceHeaderKey = (typeof FINANCE_HEADER_FIELDS)[number]["key"];

export type FinanceHeader = {
  clientName: string | null;
  programName: string | null;
  /** Ghi tự do để giữ đơn vị, vd "240 khách", "68 tượng". */
  headcount: string | null;
  location: string | null;
  eventStart: Date | null;
  eventEnd: Date | null;
};

export const FINANCE_HEADER_LIMITS = {
  clientName: 200,
  programName: 200,
  headcount: 60,
  location: 200,
} as const;

export type FinanceHeaderRow = {
  key: FinanceHeaderKey;
  label: string;
  value: string;
};

function clean(value: string | null | undefined) {
  const text = value?.normalize("NFC").trim().replace(/\s+/g, " ");
  return text || null;
}

/**
 * Các dòng thông tin chung sẽ in ra file: chỉ giữ mục có nội dung,
 * đúng thứ tự Khách hàng → Tên chương trình → Số lượng → Địa điểm → Thời gian.
 */
export function financeHeaderRows(header: FinanceHeader): FinanceHeaderRow[] {
  const values: Record<FinanceHeaderKey, string | null> = {
    clientName: clean(header.clientName),
    programName: clean(header.programName),
    headcount: clean(header.headcount),
    location: clean(header.location),
    eventTime: formatExecutionRange(header.eventStart, header.eventEnd),
  };
  return FINANCE_HEADER_FIELDS.flatMap(({ key, label }) => {
    const value = values[key];
    return value ? [{ key, label, value }] : [];
  });
}

/** Mục còn trống, để nhắc trong app (không in ra file). */
export function missingFinanceHeaderLabels(header: FinanceHeader): string[] {
  const filled = new Set(financeHeaderRows(header).map((row) => row.key));
  return FINANCE_HEADER_FIELDS.filter(({ key }) => !filled.has(key)).map(
    ({ label }) => label,
  );
}

/** Giá trị điền sẵn khi tạo IC mới: lấy từ thông tin dự án, người dùng sửa được. */
export function defaultFinanceHeader(project: {
  name: string;
  clientName: string | null;
  executionStartAt: Date | null;
  executionEndAt: Date | null;
}): FinanceHeader {
  return {
    clientName: clean(project.clientName),
    programName: clean(project.name),
    headcount: null,
    location: null,
    eventStart: project.executionStartAt,
    eventEnd: project.executionStartAt ? project.executionEndAt : null,
  };
}

/** Đọc thông tin chung từ form (ngày dạng yyyy-MM-dd theo giờ Việt Nam). */
export function readFinanceHeader(
  formData: { get(name: string): unknown },
): FinanceHeader | { error: string } {
  const text = (field: keyof typeof FINANCE_HEADER_LIMITS) =>
    clean(String(formData.get(field) ?? ""));
  const header = {
    clientName: text("clientName"),
    programName: text("programName"),
    headcount: text("headcount"),
    location: text("location"),
  };
  for (const [field, limit] of Object.entries(FINANCE_HEADER_LIMITS)) {
    const value = header[field as keyof typeof FINANCE_HEADER_LIMITS];
    if (value && value.length > limit) {
      const label = FINANCE_HEADER_FIELDS.find((item) => item.key === field)?.label;
      return { error: `"${label}" dài quá ${limit} ký tự.` };
    }
  }

  const date = (field: "eventStart" | "eventEnd") => {
    const raw = String(formData.get(field) ?? "").trim();
    if (!raw) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
    const parsed = new Date(`${raw}T00:00:00+07:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };
  const eventStart = date("eventStart");
  const eventEnd = date("eventEnd");
  if (eventStart === undefined || eventEnd === undefined) {
    return { error: "Thời gian không hợp lệ." };
  }
  if (eventEnd && !eventStart) {
    return { error: "Hãy điền ngày bắt đầu trước khi điền ngày kết thúc." };
  }
  if (eventStart && eventEnd && eventEnd < eventStart) {
    return { error: "Ngày kết thúc phải từ ngày bắt đầu trở đi." };
  }
  return { ...header, eventStart, eventEnd };
}
