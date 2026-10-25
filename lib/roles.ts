// Vai trò tài khoản. Thứ tự này dùng cho ô chọn vai trò và bộ lọc danh sách.
export const USER_ROLES = ["ADMIN", "ACCOUNT", "ACCOUNTANT", "USER"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  ACCOUNT: "Account",
  ACCOUNTANT: "Kế toán",
  USER: "User",
};

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

/** Chỉ Admin và Account được gắn hồ sơ Account (Team kinh doanh). */
export function canHoldAccountProfile(role: string) {
  return role === "ADMIN" || role === "ACCOUNT";
}
