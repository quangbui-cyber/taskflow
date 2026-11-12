/** crm53: constants shared by the client hub server code and its client components; no imports on purpose. */
export const VENDOR_STATUSES = [
  { key: "NOT_REGISTERED", label: "Chưa đăng ký" }, { key: "IN_PROGRESS", label: "Đang đăng ký" },
  { key: "REGISTERED", label: "Đã đăng ký" }, { key: "EXPIRED", label: "Hết hạn" },
] as const;
export type VendorStatus = typeof VENDOR_STATUSES[number]["key"];
export const PLAYBOOK_TEXT_MAX = 1000;
export const QUOTES_MAX = 20;
export const PLAYBOOK_SECTIONS = {
  PROCUREMENT: { label: "Mua hàng và chọn nhà cung cấp", fields: ["vendorStatus", "vendorRegisteredUntil", "frameworkContractUntil", "quotesRequired", "approvalFlow"] },
  PAYMENT: { label: "Thanh toán và hóa đơn", fields: ["paymentTermsText", "paymentPractice", "invoiceNotes"] },
  BRAND: { label: "Thương hiệu và đề xuất", fields: ["brandGuidelineUrl", "brandDos", "brandDonts"] },
  EXECUTION: { label: "Lưu ý triển khai", fields: ["executionNotes"] },
} as const;
export type PlaybookSection = keyof typeof PLAYBOOK_SECTIONS;
export type PlaybookField = typeof PLAYBOOK_SECTIONS[PlaybookSection]["fields"][number];
export const PLAYBOOK_FIELD_LABELS: Record<PlaybookField, string> = {
  vendorStatus: "Tình trạng NCC", vendorRegisteredUntil: "Đăng ký NCC đến", frameworkContractUntil: "Hợp đồng nguyên tắc đến", quotesRequired: "Số báo giá yêu cầu", approvalFlow: "Người duyệt cuối",
  paymentTermsText: "Điều khoản thanh toán", paymentPractice: "Thực tế thanh toán", invoiceNotes: "Lưu ý hóa đơn",
  brandGuidelineUrl: "Brand guideline", brandDos: "Nên", brandDonts: "Tránh", executionNotes: "Lưu ý triển khai",
};
export const CASE_STUDY_OPTIONS = [
  { key: "ALLOWED", label: "Được dùng" }, { key: "NOT_ASKED", label: "Chưa xin" }, { key: "DENIED", label: "Không được dùng" },
] as const;
export type CaseStudy = typeof CASE_STUDY_OPTIONS[number]["key"];
export const FEEDBACK_NOTE_MAX = 1000;
