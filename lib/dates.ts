// Việt Nam luôn ở UTC+7, không có giờ mùa hè — dùng offset cố định để đọc
// "giờ Việt Nam" mà không phụ thuộc múi giờ cấu hình trên server (quan trọng
// vì một số nền tảng deploy như Vercel không cho đặt biến môi trường TZ).
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Dịch thời điểm sang "giờ Việt Nam" rồi đọc bằng các hàm getUTC* */
function toVN(date: Date): Date {
  return new Date(date.getTime() + VN_OFFSET_MS);
}

/** Số ngày từ hôm nay đến hạn chót (âm = đã quá ngày) — tính theo ngày lịch, giờ VN */
export function daysUntil(dueDate: Date): number {
  const today = toVN(new Date());
  const due = toVN(dueDate);
  const todayMidnight = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  const dueMidnight = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate()
  );
  return Math.round((dueMidnight - todayMidnight) / 86400000);
}

/** Deadline chỉ có ngày (00:00 giờ VN) thì coi như hết ngày đó; nếu có giờ thì lấy đúng thời điểm */
export function deadline(dueDate: Date): Date {
  const vn = toVN(dueDate);
  if (vn.getUTCHours() === 0 && vn.getUTCMinutes() === 0 && vn.getUTCSeconds() === 0) {
    const endOfDayVN = Date.UTC(
      vn.getUTCFullYear(),
      vn.getUTCMonth(),
      vn.getUTCDate(),
      23,
      59,
      59,
      999
    );
    return new Date(endOfDayVN - VN_OFFSET_MS);
  }
  return dueDate;
}

/** Deadline có kèm giờ cụ thể (khác 00:00 giờ VN) hay không */
export function hasTime(dueDate: Date): boolean {
  const vn = toVN(dueDate);
  return vn.getUTCHours() !== 0 || vn.getUTCMinutes() !== 0;
}

/** Hiển thị giờ Việt Nam theo giờ:phút, ví dụ 09:00, 16:30 */
export function formatHour(dueDate: Date): string {
  const vn = toVN(dueDate);
  const hour = String(vn.getUTCHours()).padStart(2, "0");
  const minute = String(vn.getUTCMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function isOverdue(dueDate: Date): boolean {
  return Date.now() > deadline(dueDate).getTime();
}

export function formatDue(dueDate: Date): string {
  const vn = toVN(dueDate);
  const dateStr = `${vn.getUTCDate()}/${vn.getUTCMonth() + 1}`;
  const timeStr = hasTime(dueDate) ? " " + formatHour(dueDate) : "";
  const label = `${dateStr}${timeStr}`;

  if (isOverdue(dueDate)) {
    const days = daysUntil(dueDate);
    if (days < 0) return `${label} — quá hạn ${-days} ngày`;
    return `${label} — đã quá giờ`;
  }
  const days = daysUntil(dueDate);
  if (days === 0) return `${label} — hôm nay`;
  if (days === 1) return `${label} — ngày mai`;
  if (days <= 7) return `${label} — còn ${days} ngày`;
  return label;
}
