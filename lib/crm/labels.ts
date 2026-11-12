export const OPPORTUNITY_STAGES = [
  { key: "CARE", label: "Chăm sóc", className: "bg-zinc-100 text-zinc-700" },
  { key: "BRIEF", label: "Brief", className: "bg-sky-50 text-sky-700" },
  { key: "BIDDING", label: "Bidding", className: "bg-amber-100 text-amber-700" },
] as const;
export const OPPORTUNITY_OUTCOMES = [
  { key: "WON", label: "Thắng", className: "bg-emerald-100 text-emerald-700" },
  { key: "LOST_COMPETITIVE", label: "Thua cạnh tranh", className: "bg-red-100 text-red-700" },
  { key: "CUSTOMER_CANCELLED", label: "Khách hủy", className: "bg-zinc-200 text-zinc-700" },
  { key: "CS_DECLINED", label: "CS không tham gia", className: "bg-zinc-100 text-zinc-500" },
  { key: "LEGACY_UNCLASSIFIED", label: "Chưa rõ kết quả", className: "bg-zinc-100 text-zinc-500" },
] as const;
export const OPPORTUNITY_SOURCES = [
  { key: "REPEAT", label: "Khách cũ mua lại" }, { key: "REFERRAL", label: "Giới thiệu" }, { key: "INBOUND", label: "Khách chủ động liên hệ" }, { key: "INDUSTRY_EVENT", label: "Sự kiện ngành" }, { key: "OTHER", label: "Khác" },
] as const;
export const TOUCHPOINT_KINDS = [
  { key: "CALL", label: "Gọi" }, { key: "MEETING", label: "Gặp" }, { key: "MESSAGE", label: "Email/Zalo" }, { key: "GIFT", label: "Gửi quà" }, { key: "CASE", label: "Gửi case" },
] as const;
export const OUTCOME_LEVELS = [
  { key: 1, label: "Đã thử liên hệ" }, { key: 2, label: "Có phản hồi thực chất" }, { key: 3, label: "Có cuộc hẹn" }, { key: 4, label: "Có nhu cầu xác nhận" },
] as const;
export const EVENT_SOURCES = [
  { key: "CLIENT_CONFIRMED", label: "Khách xác nhận" }, { key: "HISTORY", label: "Suy từ lịch sử" }, { key: "INDUSTRY_SEASON", label: "Mùa vụ ngành" },
] as const;
export const TIER_ORDER = ["S", "A", "UNRATED", "B", "C"] as const;
export const TIER_LABELS = { S: "Hạng S", A: "Hạng A", B: "Hạng B", C: "Hạng C", UNRATED: "Chưa xếp hạng" };
export const REVIEW_REASON_LABELS = { APPOINTMENT: "Lịch khách hẹn", PLAN_CLOSE: "Kỳ chốt kế hoạch", EVENT_REMINDER: "Mốc trước sự kiện", VERIFY_MONTH: "Xác minh tháng", CADENCE: "Nhắc định kỳ", POST_PROJECT: "Sau dự án", NEXT_STEP: "Việc tiếp theo", WAIT: "Chờ khách", ESCALATED: "Đã nhờ AD/AM", CAMPAIGN: "Chiến dịch" };
export const REASON_GROUP_LABELS = { LOST: "Thua cạnh tranh", CANCELLED: "Khách hủy", DECLINED: "CS không tham gia" };
