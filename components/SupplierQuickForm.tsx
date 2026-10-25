"use client";

import { createSupplier } from "@/app/actions/suppliers";
import { SUPPLIER_KINDS, type SupplierKind } from "@/lib/financePolicy";

/** Nhà cung cấp dùng trong bảng IC (đủ để tìm theo tên, tên gọi tắt, MST). */
export type SupplierOption = {
  id: string;
  name: string;
  shortName: string | null;
  taxCode: string | null;
  bankAccount: string | null;
};

export type SupplierDraft = {
  kind: SupplierKind;
  name: string;
  shortName: string;
  taxCode: string;
  phone: string;
  email: string;
  bankAccount: string;
  bankName: string;
  accountHolder: string;
};

export function emptySupplierDraft(shortName = ""): SupplierDraft {
  return {
    kind: "COMPANY",
    name: "",
    shortName,
    taxCode: "",
    phone: "",
    email: "",
    bankAccount: "",
    bankName: "",
    accountHolder: "",
  };
}

/** Kiểm tra nhanh trên trình duyệt (máy chủ kiểm tra lại đầy đủ khi lưu). */
export function supplierDraftError(draft: SupplierDraft): string | null {
  if (!draft.name.trim()) return draft.kind === "COMPANY" ? "Nhập tên công ty." : "Nhập họ tên.";
  if (draft.kind === "COMPANY" && !draft.taxCode.trim()) return "Công ty cần có mã số thuế.";
  if (!draft.bankAccount.trim() || !draft.bankName.trim()) {
    return "Cần nhập số tài khoản và ngân hàng để chuyển khoản.";
  }
  return null;
}

/** Lưu nhà cung cấp mới vào danh bạ chung; trả về NCC vừa tạo hoặc câu báo lỗi. */
export async function saveSupplierDraft(
  draft: SupplierDraft,
): Promise<{ supplier: SupplierOption } | { error: string }> {
  const local = supplierDraftError(draft);
  if (local) return { error: local };
  const formData = new FormData();
  for (const [key, value] of Object.entries(draft)) formData.append(key, value);
  const result = await createSupplier({}, formData);
  if (result.error || !result.savedId) return { error: result.error ?? "Không lưu được nhà cung cấp." };
  const clean = (value: string) => value.trim().replace(/\s+/g, " ") || null;
  return {
    supplier: {
      id: result.savedId,
      name: clean(draft.name) ?? draft.name,
      shortName: clean(draft.shortName),
      taxCode: clean(draft.taxCode),
      bankAccount: draft.bankAccount.replace(/[\s.-]/g, "") || null,
    },
  };
}

const FIELD = "tf-field !min-h-10 !py-2 text-sm";

/** Các ô thông tin nhà cung cấp; dùng chung cho tạo nhanh tại dòng và thêm cả loạt từ file. */
export function SupplierFields({
  draft,
  onChange,
  disabled,
  idPrefix,
}: {
  draft: SupplierDraft;
  onChange: (draft: SupplierDraft) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const set = (patch: Partial<SupplierDraft>) => onChange({ ...draft, ...patch });
  const company = draft.kind === "COMPANY";
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Loại nhà cung cấp" className="inline-flex rounded-[8px] border border-zinc-200 bg-zinc-50 p-0.5">
        {SUPPLIER_KINDS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={draft.kind === item.key}
            disabled={disabled}
            onClick={() => set({ kind: item.key })}
            className={`rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
              draft.kind === item.key ? "bg-white text-brand-800 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2" htmlFor={`${idPrefix}-name`}>
          <span className="tf-label">{company ? "Tên công ty" : "Họ tên"} (bắt buộc)</span>
          <input
            id={`${idPrefix}-name`}
            value={draft.name}
            disabled={disabled}
            maxLength={200}
            autoComplete="off"
            placeholder={company ? "VD: Công ty TNHH In ấn Tân Hoàng Việt" : "VD: Võ Phạm Trọng Huy"}
            onChange={(event) => set({ name: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="tf-label">Tên gọi tắt (cột SUP)</span>
          <input
            value={draft.shortName}
            disabled={disabled}
            maxLength={60}
            autoComplete="off"
            placeholder="VD: TÂN HOÀNG VIỆT"
            onChange={(event) => set({ shortName: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="tf-label">{company ? "Mã số thuế (bắt buộc)" : "MST / CCCD"}</span>
          <input
            value={draft.taxCode}
            disabled={disabled}
            inputMode="numeric"
            maxLength={20}
            autoComplete="off"
            onChange={(event) => set({ taxCode: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="tf-label">Số điện thoại</span>
          <input
            value={draft.phone}
            disabled={disabled}
            inputMode="tel"
            maxLength={30}
            autoComplete="off"
            onChange={(event) => set({ phone: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="tf-label">Email</span>
          <input
            value={draft.email}
            disabled={disabled}
            type="email"
            maxLength={120}
            autoComplete="off"
            onChange={(event) => set({ email: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="tf-label">Số tài khoản (bắt buộc)</span>
          <input
            value={draft.bankAccount}
            disabled={disabled}
            inputMode="numeric"
            maxLength={40}
            autoComplete="off"
            onChange={(event) => set({ bankAccount: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="tf-label">Ngân hàng (bắt buộc)</span>
          <input
            value={draft.bankName}
            disabled={disabled}
            maxLength={120}
            autoComplete="off"
            placeholder="VD: ACB, Techcombank"
            onChange={(event) => set({ bankName: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="tf-label">Chủ tài khoản</span>
          <input
            value={draft.accountHolder}
            disabled={disabled}
            maxLength={200}
            autoComplete="off"
            placeholder="Để trống nếu trùng tên ở trên"
            onChange={(event) => set({ accountHolder: event.target.value })}
            className={FIELD}
          />
        </label>
      </div>
    </div>
  );
}
