export const RECOGNITION_CATEGORIES = [
  { key: "KINDNESS", label: "Một điều tử tế" },
  { key: "SUPPORT", label: "Hỗ trợ công việc" },
  { key: "INSPIRATION", label: "Truyền cảm hứng" },
  { key: "CARE", label: "Quan tâm đồng đội" },
] as const;

// Lời chúc sinh nhật đi chung luồng Góc cảm ơn nhưng không chọn được trong
// hộp chủ đề, không trừ sao tuần và không tính vào Ngôi sao tháng.
export const BIRTHDAY_RECOGNITION_CATEGORY = "BIRTHDAY";
export const BIRTHDAY_RECOGNITION_LABEL = "Chúc mừng sinh nhật";

export const RECOGNITION_VISIBILITIES = [
  { key: "COMPANY", label: "Mọi người trong công ty" },
  { key: "PRIVATE", label: "Chỉ người nhận" },
] as const;

export const RECOGNITION_WEEKLY_STAR_LIMIT = 5;
export const RECOGNITION_COMMENT_MAX_LENGTH = 500;

export function recognitionCategoryLabel(key: string) {
  if (key === BIRTHDAY_RECOGNITION_CATEGORY) return BIRTHDAY_RECOGNITION_LABEL;
  return (
    RECOGNITION_CATEGORIES.find((category) => category.key === key)?.label ??
    RECOGNITION_CATEGORIES[0].label
  );
}

export function recognitionMonthRange(monthKey?: string) {
  const currentMonth = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date());
  const key = /^\d{4}-\d{2}$/.test(monthKey ?? "") ? monthKey! : currentMonth;
  const [year, month] = key.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1) - 7 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month, 1) - 7 * 60 * 60 * 1000);
  return { key, start, end };
}

export function recognitionWeekRange(now = new Date()) {
  const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const daysSinceMonday = (vietnamNow.getUTCDay() + 6) % 7;
  const start = new Date(
    Date.UTC(
      vietnamNow.getUTCFullYear(),
      vietnamNow.getUTCMonth(),
      vietnamNow.getUTCDate() - daysSinceMonday
    ) -
      7 * 60 * 60 * 1000
  );
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export function recognitionMonthOptions(count = 6) {
  const vietnamNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(
      Date.UTC(vietnamNow.getUTCFullYear(), vietnamNow.getUTCMonth() - index, 1)
    );
    return {
      key: `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`,
      label: `Tháng ${value.getUTCMonth() + 1}/${value.getUTCFullYear()}`,
    };
  });
}
