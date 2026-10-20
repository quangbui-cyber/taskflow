export const KIND_LABELS: Record<string, string> = {
  IC: "Dự toán IC",
  ACTUAL_COST_APPROVAL: "Duyệt toàn bộ Bảng AC",
  AC_REVISION: "Sửa chi phí AC",
  ADVANCE: "Đề nghị tạm ứng",
  VENDOR_PAYMENT: "Đề nghị thanh toán NCC",
  REIMBURSEMENT: "Hoàn tạm ứng",
  CLOSE: "Đóng tài chính",
  REOPEN: "Mở lại tài chính",
  CANCEL: "Hủy hồ sơ",
};

export const KIND_INFO: Record<string, { label: string; tone: "info" | "warning" | "success" | "neutral" }> = {
  IC: { label: "Dự toán IC", tone: "info" },
  ACTUAL_COST_APPROVAL: { label: "Duyệt toàn bộ Bảng AC", tone: "info" },
  ADVANCE: { label: "Đề nghị tạm ứng (ĐNTU)", tone: "info" },
  VENDOR_PAYMENT: { label: "Đề nghị thanh toán (ĐNTT)", tone: "warning" },
  REIMBURSEMENT: { label: "Hoàn tạm ứng (ĐNHTU)", tone: "success" },
  AC_REVISION: { label: "Sửa chi phí AC", tone: "warning" },
  CLOSE: { label: "Đóng tài chính", tone: "neutral" },
  REOPEN: { label: "Mở lại tài chính", tone: "neutral" },
  CANCEL: { label: "Hủy hồ sơ", tone: "neutral" }
};

export const STATE_LABELS: Record<string, string> = {
  DRAFT: "Nháp",
  SUBMITTED: "Chờ duyệt",
  APPROVED: "Đã duyệt",
  RETURNED: "Đã trả",
  REJECTED: "Từ chối",
  WITHDRAWN: "Đã rút",
  CANCELLED: "Đã hủy",
};

export const STATE_TONES: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  APPROVED: "success",
  RETURNED: "warning",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
  CANCELLED: "neutral",
};

export const STATE_INFO: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Bản nháp", tone: "neutral" },
  SUBMITTED: { label: "Đang chờ duyệt", tone: "info" },
  APPROVED: { label: "Đã phê duyệt", tone: "success" },
  RETURNED: { label: "Đã trả để sửa", tone: "warning" },
  REJECTED: { label: "Từ chối", tone: "danger" },
  WITHDRAWN: { label: "Đã rút", tone: "neutral" },
  CANCELLED: { label: "Đã hủy", tone: "neutral" }
};

export const ACTION_LABELS: Record<string, string> = {
  APPROVE: "Duyệt",
  RETURN: "Trả hồ sơ",
  REJECT: "Từ chối",
  WITHDRAW: "Rút hồ sơ",
  SUBMIT: "Gửi duyệt",
  DECIDE: "Ghi quyết định",
  TRANSFER: "Chuyển giao",
  CASH: "Xác nhận tiền thực tế",
  CONFIGURE: "Phân công",
  ADD_PO: "Thêm PO",
  ADD_BRIEF: "Thêm Brief",
  SAVE_QUOTATION: "Lưu phiên bản báo giá",
  SAVE_IC: "Lưu IC nháp",
  BENEFICIARY: "Cập nhật người thụ hưởng",
  EXPENSE: "Ghi chi phí AC",
  EXPENSE_EVIDENCE: "Bổ sung chứng từ",
  REVISE_EXPENSE: "Trình bản sửa chi phí",
  CREATE_REQUEST: "Lập hồ sơ",
};

export const ROLE_LABELS: Record<string, string> = {
  MANAGER: "Quản lý",
  ACCOUNTANT: "Kế toán",
  CEO: "CEO",
  AC_DD: "Phó Giám đốc (Duyệt AC)",
};

export function recipientDisplayName(
  key: string,
  usersMap: Map<string, string>,
  beneficiaries: { id: string; name: string }[]
): string {
  if (key.startsWith("USER:")) {
    return usersMap.get(key.slice(5)) ?? "Nhân viên";
  }
  return beneficiaries.find(b => b.id === key.slice(7))?.name ?? "NCC";
}
