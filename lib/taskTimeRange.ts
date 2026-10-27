function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function validTaskTimeRange(
  startDate: Date | null,
  dueDate: Date | null
) {
  if (!startDate) return true;
  return Boolean(
    dueDate &&
      vietnamDateKey(startDate) === vietnamDateKey(dueDate) &&
      startDate.getTime() < dueDate.getTime()
  );
}
