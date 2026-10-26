import { type ProjectCategory } from "./types";

export function canCreateProjects(role: string) {
  return (
    role === "ADMIN" ||
    role === "ACCOUNT" ||
    role === "ACCOUNTANT" ||
    role === "USER"
  );
}

/** Xem doanh thu, giá bán, lợi nhuận. Kế toán xem được để đối chiếu khi chi. */
export function canViewRevenue(role: string) {
  return role === "ADMIN" || role === "ACCOUNT" || role === "ACCOUNTANT";
}

type BusinessFields = {
  category: ProjectCategory;
  revenue: number;
  clientId: string | null;
  accountId: string | null;
};

type ExistingProject = BusinessFields & { purchaseOrderNumber: string | null };

/** Financial fields must stay protected even when a user owns a project. */
export function readProjectBusinessFields(
  formData: FormData,
  role: string,
  existing?: ExistingProject,
): BusinessFields | { error: string } {
  const category = String(
    formData.get("category") ?? existing?.category ?? "CLIENT",
  );
  if (category !== "CLIENT" && category !== "INTERNAL") {
    return { error: "Mục đích dự án không hợp lệ." };
  }
  const financialAccess = canViewRevenue(role);
  const rawRevenue = formData.get("revenue");
  if (!financialAccess && rawRevenue !== null) {
    return { error: "Bạn không có quyền sửa doanh thu." };
  }
  if (String(formData.get("projectSource") ?? "") === "JABIL_PO") {
    if (!financialAccess || category === "INTERNAL") {
      return {
        error: "Chỉ Admin hoặc Account được nhập PO cho dự án khách hàng.",
      };
    }
  }
  if (category === "INTERNAL") {
    if (existing?.purchaseOrderNumber) {
      return { error: "Dự án có PO cần giữ mục đích Khách hàng." };
    }
    if (
      !financialAccess &&
      existing &&
      existing.category !== category &&
      existing.revenue !== 0
    ) {
      return {
        error:
          "Liên hệ Admin hoặc Account để chuyển dự án có doanh thu sang Nội bộ.",
      };
    }
    return { category, revenue: 0, clientId: null, accountId: null };
  }

  const cleaned = String(rawRevenue ?? existing?.revenue ?? "").replace(
    /[.,\s₫đ]/gi,
    "",
  );
  const revenue = financialAccess ? Number(cleaned) : (existing?.revenue ?? 0);
  if (!Number.isFinite(revenue) || revenue < 0) {
    return { error: "Doanh thu không hợp lệ." };
  }
  const accountId = String(formData.get("accountId") ?? existing?.accountId ?? "").trim();
  if (!accountId) {
    return { error: "Dự án Khách hàng bắt buộc chọn Account phụ trách." };
  }
  return {
    category,
    revenue,
    clientId:
      String(formData.get("clientId") ?? existing?.clientId ?? "").trim() ||
      null,
    accountId,
  };
}
