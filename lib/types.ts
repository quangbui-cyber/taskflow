export type CommentDTO = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
};

export type TaskDTO = {
  id: string;
  title: string;
  description: string | null;
  result: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  order: number;
  assigneeId: string | null;
  comments: CommentDTO[];
  followers: { id: string; name: string; avatarUrl: string | null }[];
};

export type MemberDTO = {
  userId: string;
  role: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null };
};

export const STATUSES = [
  { key: "TODO", label: "Cần làm" },
  { key: "IN_PROGRESS", label: "Đang làm" },
  { key: "DONE", label: "Hoàn thành" },
] as const;

export const PROJECT_STATUSES = [
  { key: "BIDDING", label: "Bidding", color: "#f59e0b", className: "bg-amber-100 text-amber-700" },
  { key: "ON_PROCESS", label: "On Process", color: "#2563eb", className: "bg-blue-100 text-blue-700" },
  { key: "DONE", label: "Done", color: "#10b981", className: "bg-emerald-100 text-emerald-700" },
  { key: "FAIL", label: "Fail", color: "#ef4444", className: "bg-red-100 text-red-700" },
  { key: "PENDING", label: "Pending", color: "#8b5cf6", className: "bg-violet-100 text-violet-700" },
  { key: "CANCEL", label: "Cancel", color: "#71717a", className: "bg-zinc-200 text-zinc-700" },
] as const;

// Bảng màu 6 loại hình đã qua validator dataviz (phân biệt được với người
// mù màu, đủ tương phản trên nền trắng) — đừng đổi tuỳ tiện từng màu lẻ.
export const PROJECT_TYPES = [
  { key: "TEAMBUILDING", label: "Teambuilding", color: "#0d9488", className: "bg-teal-100 text-teal-700" },
  { key: "MICE", label: "MICE", color: "#4f46e5", className: "bg-indigo-100 text-indigo-700" },
  { key: "ACTIVATION", label: "Activation", color: "#ea580c", className: "bg-orange-100 text-orange-700" },
  { key: "EVENT", label: "Event", color: "#db2777", className: "bg-pink-100 text-pink-700" },
  { key: "PUR", label: "Pur", color: "#65a30d", className: "bg-lime-100 text-lime-700" },
  { key: "OTHER", label: "Other", color: "#0891b2", className: "bg-cyan-100 text-cyan-700" },
] as const;

export function projectTypeInfo(key: string) {
  return (
    PROJECT_TYPES.find((t) => t.key === key) ??
    PROJECT_TYPES[PROJECT_TYPES.length - 1]
  );
}

export const ARCHIVED_PROJECT_STATUS_KEYS = [
  "DONE",
  "CANCEL",
  "PENDING",
  "FAIL",
] as const;

export function isArchivedProjectStatus(key: string) {
  return ARCHIVED_PROJECT_STATUS_KEYS.some((status) => status === key);
}

export function projectStatusInfo(key: string) {
  return (
    PROJECT_STATUSES.find((s) => s.key === key) ?? PROJECT_STATUSES[0]
  );
}

export function projectStatusColor(key: string) {
  return projectStatusInfo(key).color;
}

export function formatVND(amount: number) {
  //   = khoảng trắng không ngắt dòng — tránh ký hiệu ₫ rơi xuống dòng dưới
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

export const PRIORITIES = [
  { key: "LOW", label: "Thấp", className: "bg-emerald-50 text-emerald-700" },
  { key: "MEDIUM", label: "Trung bình", className: "bg-orange-50 text-orange-700" },
  { key: "HIGH", label: "Cao", className: "bg-red-100 text-red-700" },
] as const;
