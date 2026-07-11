/** Số ngày từ hôm nay đến hạn chót (âm = đã quá ngày) — tính theo ngày lịch */
export function daysUntil(dueDate: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

/** Deadline chỉ có ngày (00:00) thì coi như hết ngày đó; nếu có giờ thì lấy đúng thời điểm */
export function deadline(dueDate: Date): Date {
  const d = new Date(dueDate);
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  return d;
}

/** Deadline có kèm giờ cụ thể (khác 00:00) hay không */
export function hasTime(dueDate: Date): boolean {
  const d = new Date(dueDate);
  return d.getHours() !== 0 || d.getMinutes() !== 0;
}

/** Hiển thị giờ theo kiểu Việt Nam, chỉ giờ không phút, ví dụ 9h, 16h */
export function formatHour(dueDate: Date): string {
  return `${new Date(dueDate).getHours()}h`;
}

export function isOverdue(dueDate: Date): boolean {
  return Date.now() > deadline(dueDate).getTime();
}

export function formatDue(dueDate: Date): string {
  const d = new Date(dueDate);
  const dateStr = d.toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "numeric",
  });
  const timeStr = hasTime(d) ? " " + formatHour(d) : "";
  const label = `${dateStr}${timeStr}`;

  if (isOverdue(d)) {
    const days = daysUntil(d);
    if (days < 0) return `${label} — quá hạn ${-days} ngày`;
    return `${label} — đã quá giờ`;
  }
  const days = daysUntil(d);
  if (days === 0) return `${label} — hôm nay`;
  if (days === 1) return `${label} — ngày mai`;
  if (days <= 7) return `${label} — còn ${days} ngày`;
  return label;
}
