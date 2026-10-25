// So khớp nhà cung cấp đang nhập với danh bạ để báo "có thể đã có".
// Chạy ngay trên trình duyệt với danh sách đã tải sẵn, không gọi thêm máy chủ.

export type MatchableSupplier = {
  id: string;
  name: string;
  shortName: string | null;
  bankAccount: string | null;
  taxCode: string | null;
};

/** Bỏ dấu, viết thường, gộp khoảng trắng: "Tân  Hoàng Việt" → "tan hoang viet". */
export function searchKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Phần chung của tên công ty, bỏ đi để "Cty TNHH Tân Hoàng Việt" vẫn khớp
// "CÔNG TY TNHH IN ẤN TÂN HOÀNG VIỆT".
const COMMON_WORDS = new Set([
  "cong", "ty", "cty", "tnhh", "co", "phan", "cp", "mtv", "mot", "thanh", "vien",
  "dv", "tm", "sx", "dich", "vu", "thuong", "mai", "san", "xuat", "va",
  "company", "co.", "ltd", "jsc", "group",
]);

function coreWords(value: string) {
  return searchKey(value)
    .split(" ")
    .filter((word) => word && !COMMON_WORDS.has(word));
}

function containsAll(haystack: string[], needle: string[]) {
  return needle.length > 0 && needle.every((word) => haystack.includes(word));
}

export type SupplierNameMatch<T extends MatchableSupplier> = {
  supplier: T;
  /** Trùng hẳn tên hoặc tên gọi tắt (lưu sẽ bị chặn). */
  exact: boolean;
};

/**
 * Nhà cung cấp có tên gần giống tên đang nhập. Trùng hẳn xếp trước.
 * Cần ít nhất 2 ký tự có nghĩa mới gợi ý, để không hiện cả danh bạ.
 */
export function findSimilarSuppliers<T extends MatchableSupplier>(
  typed: string,
  suppliers: T[],
  options: { excludeId?: string; limit?: number } = {},
): SupplierNameMatch<T>[] {
  const typedKey = searchKey(typed);
  if (typedKey.replace(/ /g, "").length < 2) return [];
  const typedCore = coreWords(typed);
  const limit = options.limit ?? 5;

  const matches: SupplierNameMatch<T>[] = [];
  for (const supplier of suppliers) {
    if (supplier.id === options.excludeId) continue;
    const names = [supplier.name, supplier.shortName].filter(
      (name): name is string => Boolean(name),
    );
    const exact = names.some((name) => searchKey(name) === typedKey);
    const similar =
      exact ||
      names.some((name) => {
        const key = searchKey(name);
        const core = coreWords(name);
        return (
          key.includes(typedKey) ||
          typedKey.includes(key) ||
          containsAll(core, typedCore) ||
          containsAll(typedCore, core)
        );
      });
    if (similar) matches.push({ supplier, exact });
  }
  return matches
    .sort((a, b) => Number(b.exact) - Number(a.exact))
    .slice(0, limit);
}

/** Chỉ giữ chữ và số: "0551 000.329-796" → "0551000329796". */
export function accountDigits(value: string | null | undefined) {
  return (value ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/** Nhà cung cấp khác đã dùng cùng số tài khoản. */
export function findSameBankAccount<T extends MatchableSupplier>(
  account: string,
  suppliers: T[],
  excludeId?: string,
): T[] {
  const typed = accountDigits(account);
  if (typed.length < 6) return [];
  return suppliers.filter(
    (supplier) =>
      supplier.id !== excludeId && accountDigits(supplier.bankAccount) === typed,
  );
}

/** Nhà cung cấp khác đã dùng cùng mã số thuế. */
export function findSameTaxCode<T extends MatchableSupplier>(
  taxCode: string,
  suppliers: T[],
  excludeId?: string,
): T[] {
  const typed = taxCode.replace(/\s/g, "");
  if (typed.length < 10) return [];
  return suppliers.filter(
    (supplier) =>
      supplier.id !== excludeId && supplier.taxCode?.replace(/\s/g, "") === typed,
  );
}
