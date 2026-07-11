export type CommentDTO = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
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
  followers: { id: string; name: string }[];
};

export type MemberDTO = {
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
};

export const STATUSES = [
  { key: "TODO", label: "Cần làm" },
  { key: "IN_PROGRESS", label: "Đang làm" },
  { key: "DONE", label: "Hoàn thành" },
] as const;

export const PROJECT_STATUSES = [
  { key: "BIDDING", label: "Bidding", className: "bg-amber-100 text-amber-700" },
  { key: "ON_PROCESS", label: "On Process", className: "bg-blue-100 text-blue-700" },
  { key: "PENDING", label: "Pending", className: "bg-violet-100 text-violet-700" },
  { key: "DONE", label: "Done", className: "bg-emerald-100 text-emerald-700" },
  { key: "CANCEL", label: "Cancel", className: "bg-zinc-200 text-zinc-700" },
  { key: "FAIL", label: "Fail", className: "bg-red-100 text-red-700" },
] as const;

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

export function formatVND(amount: number) {
  //   = khoảng trắng không ngắt dòng — tránh ký hiệu ₫ rơi xuống dòng dưới
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

export const PRIORITIES = [
  { key: "LOW", label: "Thấp", className: "bg-zinc-100 text-zinc-600" },
  { key: "MEDIUM", label: "Trung bình", className: "bg-amber-100 text-amber-700" },
  { key: "HIGH", label: "Cao", className: "bg-red-100 text-red-700" },
] as const;
