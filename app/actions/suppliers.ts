"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  canDeleteSuppliers,
  canManageSuppliers,
  readSupplierInput,
  supplierKeys,
  type SupplierInput,
} from "@/lib/financePolicy";

export type SupplierState = { error?: string; success?: string; savedId?: string };

/**
 * Báo trùng sớm với thông báo dễ hiểu. Chặn thật nằm ở ràng buộc unique của
 * nameKey/shortNameKey trong database (an toàn cả khi hai người lưu cùng lúc).
 */
async function duplicateError(input: SupplierInput, excludeId?: string) {
  const keys = supplierKeys(input);
  const sameName = await prisma.supplier.findFirst({
    where: {
      nameKey: keys.nameKey,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (sameName) return `Đã có nhà cung cấp tên "${input.name}".`;
  if (keys.shortNameKey) {
    const sameShort = await prisma.supplier.findFirst({
      where: {
        shortNameKey: keys.shortNameKey,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { name: true },
    });
    if (sameShort) {
      return `Tên gọi tắt "${input.shortName}" đang dùng cho ${sameShort.name}.`;
    }
  }
  return null;
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function createSupplier(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const user = await requireUser();
  if (!canManageSuppliers(user.role)) {
    return { error: "Bạn không có quyền thêm nhà cung cấp." };
  }
  const input = readSupplierInput(formData);
  if ("error" in input) return input;
  const duplicate = await duplicateError(input);
  if (duplicate) return { error: duplicate };

  try {
    const supplier = await prisma.supplier.create({
      data: {
        ...input,
        ...supplierKeys(input),
        createdById: user.id,
        updatedById: user.id,
      },
      select: { id: true },
    });
    revalidatePath("/suppliers");
    return { success: `Đã thêm ${input.name}.`, savedId: supplier.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "Tên hoặc tên gọi tắt vừa được người khác dùng. Hãy kiểm tra lại." };
    }
    throw error;
  }
}

export async function updateSupplier(
  _prev: SupplierState,
  formData: FormData,
): Promise<SupplierState> {
  const user = await requireUser();
  if (!canManageSuppliers(user.role)) {
    return { error: "Bạn không có quyền sửa nhà cung cấp." };
  }
  const id = String(formData.get("id") ?? "");
  const existing = await prisma.supplier.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) return { error: "Nhà cung cấp không còn tồn tại." };
  const input = readSupplierInput(formData);
  if ("error" in input) return input;
  const duplicate = await duplicateError(input, id);
  if (duplicate) return { error: duplicate };

  try {
    await prisma.supplier.update({
      where: { id },
      data: { ...input, ...supplierKeys(input), updatedById: user.id },
    });
    revalidatePath("/suppliers");
    return { success: `Đã lưu ${input.name}.`, savedId: id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { error: "Tên hoặc tên gọi tắt vừa được người khác dùng. Hãy kiểm tra lại." };
    }
    throw error;
  }
}

export async function deleteSupplier(id: string): Promise<SupplierState> {
  const user = await requireUser();
  if (!canDeleteSuppliers(user.role)) {
    return { error: "Chỉ Admin hoặc Kế toán được xoá nhà cung cấp." };
  }
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!supplier) return { error: "Nhà cung cấp không còn tồn tại." };
  await prisma.supplier.delete({ where: { id } });
  revalidatePath("/suppliers");
  return { success: `Đã xoá ${supplier.name}.` };
}
