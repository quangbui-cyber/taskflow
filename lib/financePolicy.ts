import { type ProjectCategory } from "./types";

/** Người được chọn làm người duyệt IC/AC của dự án. */
export const FINANCE_APPROVER_ROLES = ["ADMIN", "ACCOUNT"] as const;

export function canBeFinanceApprover(role: string) {
  return (FINANCE_APPROVER_ROLES as readonly string[]).includes(role);
}

/** Đặt người duyệt IC/AC: Admin hoặc Account (vẫn cần quyền sửa dự án). */
export function canSetFinanceApprovers(role: string) {
  return role === "ADMIN" || role === "ACCOUNT";
}

type ExistingApprovers = {
  icApproverId: string | null;
  acApproverId: string | null;
};

export type FinanceApprovers = ExistingApprovers;

/**
 * Đọc người duyệt IC/AC từ form sửa dự án.
 * Form không gửi hai ô này (người không có quyền) thì giữ nguyên giá trị cũ.
 * Dự án Nội bộ không có phần tài chính nên luôn xoá người duyệt.
 */
export function readFinanceApprovers(
  formData: FormData,
  role: string,
  category: ProjectCategory,
  existing: ExistingApprovers,
): FinanceApprovers | { error: string } {
  if (category === "INTERNAL") {
    return { icApproverId: null, acApproverId: null };
  }
  const rawIc = formData.get("icApproverId");
  const rawAc = formData.get("acApproverId");
  if (rawIc === null && rawAc === null) return existing;
  if (!canSetFinanceApprovers(role)) {
    return { error: "Chỉ Admin hoặc Account được chọn người duyệt IC/AC." };
  }
  return {
    icApproverId:
      rawIc === null ? existing.icApproverId : String(rawIc).trim() || null,
    acApproverId:
      rawAc === null ? existing.acApproverId : String(rawAc).trim() || null,
  };
}

// ---- Danh bạ nhà cung cấp ----

/** Mọi người xem được danh bạ; thêm/sửa: Admin, Account, Kế toán. */
export function canManageSuppliers(role: string) {
  return role === "ADMIN" || role === "ACCOUNT" || role === "ACCOUNTANT";
}

/** Xoá nhà cung cấp: Admin hoặc Kế toán. */
export function canDeleteSuppliers(role: string) {
  return role === "ADMIN" || role === "ACCOUNTANT";
}

export const SUPPLIER_KINDS = [
  { key: "COMPANY", label: "Công ty" },
  { key: "PERSON", label: "Cá nhân" },
] as const;

export type SupplierKind = (typeof SUPPLIER_KINDS)[number]["key"];

export type SupplierInput = {
  name: string;
  shortName: string | null;
  kind: SupplierKind;
  taxCode: string | null;
  phone: string | null;
  email: string | null;
  bankAccount: string | null;
  bankName: string | null;
  accountHolder: string | null;
  note: string | null;
};

const LIMITS = {
  name: 200,
  shortName: 60,
  taxCode: 20,
  phone: 30,
  email: 120,
  bankAccount: 40,
  bankName: 120,
  accountHolder: 200,
  note: 1000,
} as const;

const FIELD_LABELS: Record<keyof typeof LIMITS, string> = {
  name: "Tên",
  shortName: "Tên gọi tắt",
  taxCode: "Mã số thuế",
  phone: "Số điện thoại",
  email: "Email",
  bankAccount: "Số tài khoản",
  bankName: "Ngân hàng",
  accountHolder: "Chủ tài khoản",
  note: "Ghi chú",
};

/** Gộp khoảng trắng thừa, chuẩn hoá Unicode để so trùng tên ổn định. */
export function normalizeSupplierText(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Khoá so trùng tên/tên gọi tắt, không phân biệt hoa thường. */
export function supplierKey(value: string) {
  return normalizeSupplierText(value).toLocaleLowerCase("vi");
}

function optionalText(formData: FormData, field: keyof typeof LIMITS) {
  const raw = formData.get(field);
  if (raw === null) return null;
  const value = normalizeSupplierText(String(raw));
  return value || null;
}

/** Đọc và kiểm tra thông tin nhà cung cấp từ form. */
export function readSupplierInput(
  formData: FormData,
): SupplierInput | { error: string } {
  const name = optionalText(formData, "name");
  if (!name) return { error: "Tên nhà cung cấp không được để trống." };

  const rawKind = String(formData.get("kind") ?? "COMPANY");
  const kind = SUPPLIER_KINDS.some((item) => item.key === rawKind)
    ? (rawKind as SupplierKind)
    : null;
  if (!kind) return { error: "Loại nhà cung cấp không hợp lệ." };

  const input: SupplierInput = {
    name,
    shortName: optionalText(formData, "shortName"),
    kind,
    taxCode: optionalText(formData, "taxCode"),
    phone: optionalText(formData, "phone"),
    email: optionalText(formData, "email")?.toLowerCase() ?? null,
    // Số tài khoản lưu liền, bỏ khoảng trắng và dấu chấm/gạch người dùng gõ cho dễ đọc.
    bankAccount: optionalText(formData, "bankAccount")?.replace(/[\s.-]/g, "") || null,
    bankName: optionalText(formData, "bankName"),
    accountHolder: optionalText(formData, "accountHolder"),
    note: optionalText(formData, "note"),
  };

  for (const [field, limit] of Object.entries(LIMITS)) {
    const value = input[field as keyof typeof LIMITS];
    if (value && value.length > limit) {
      return { error: `Thông tin "${FIELD_LABELS[field as keyof typeof LIMITS]}" dài quá ${limit} ký tự.` };
    }
  }
  if (input.bankAccount && !/^[0-9A-Za-z]+$/.test(input.bankAccount)) {
    return { error: "Số tài khoản chỉ gồm chữ số (và chữ cái nếu ngân hàng có)." };
  }
  // MST doanh nghiệp 10 số (chi nhánh thêm "-xxx"); cá nhân dùng số CCCD 12 số.
  if (input.taxCode && !/^([0-9]{10}(-[0-9]{3})?|[0-9]{12})$/.test(input.taxCode)) {
    return { error: "Mã số thuế gồm 10 số (chi nhánh thêm \"-\" và 3 số) hoặc 12 số CCCD." };
  }
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return { error: "Email không hợp lệ." };
  }
  if (input.bankAccount && !input.bankName) {
    return { error: "Có số tài khoản thì cần ghi tên ngân hàng." };
  }
  return input;
}
