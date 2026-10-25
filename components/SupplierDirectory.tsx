"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Copy, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import {
  createSupplier,
  deleteSupplier,
  updateSupplier,
  type SupplierState,
} from "@/app/actions/suppliers";
import { useInteraction } from "@/components/InteractionProvider";
import { SUPPLIER_KINDS, type SupplierKind } from "@/lib/financePolicy";
import {
  findSameBankAccount,
  findSameTaxCode,
  findSimilarSuppliers,
  searchKey,
} from "@/lib/supplierMatch";

export type SupplierItem = {
  id: string;
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
  updatedAt: string;
  updatedByName: string | null;
};

type KindFilter = "ALL" | SupplierKind;

const KIND_LABEL: Record<SupplierKind, string> = {
  COMPANY: "Công ty",
  PERSON: "Cá nhân",
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

/** Một nhà cung cấp đã có, hiện trong khung gợi ý kèm nút mở ra sửa. */
function ExistingSupplierHint({
  supplier,
  note,
  onOpen,
}: {
  supplier: SupplierItem;
  note?: string;
  onOpen: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
      <span className="min-w-0 flex-[1_1_200px]">
        <span className="font-medium text-zinc-900">{supplier.name}</span>
        {supplier.shortName && (
          <span className="ml-1.5 tf-badge bg-brand-50 text-brand-800">
            {supplier.shortName}
          </span>
        )}
        <span className="block text-xs text-zinc-500">
          {note ??
            (supplier.bankAccount
              ? `${supplier.bankName ?? ""} · ${supplier.bankAccount}`
              : "Chưa có số tài khoản")}
        </span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
      >
        Mở NCC này
      </button>
    </li>
  );
}

function SupplierForm({
  supplier,
  others,
  onOpenExisting,
  onClose,
}: {
  supplier: SupplierItem | null;
  /** Danh bạ hiện có, để báo khi tên/số tài khoản/MST đã có. */
  others: SupplierItem[];
  onOpenExisting: (supplier: SupplierItem) => void;
  onClose: () => void;
}) {
  const { notify } = useInteraction();
  const [kind, setKind] = useState<SupplierKind>(supplier?.kind ?? "COMPANY");
  const [name, setName] = useState(supplier?.name ?? "");
  const [shortName, setShortName] = useState(supplier?.shortName ?? "");
  const [taxCode, setTaxCode] = useState(supplier?.taxCode ?? "");
  const [bankAccount, setBankAccount] = useState(supplier?.bankAccount ?? "");

  const nameMatches = useMemo(() => {
    const byName = findSimilarSuppliers(name, others, { excludeId: supplier?.id });
    const byShort = findSimilarSuppliers(shortName, others, { excludeId: supplier?.id })
      .filter((match) => match.exact);
    const seen = new Set<string>();
    return [...byShort, ...byName].filter((match) => {
      if (seen.has(match.supplier.id)) return false;
      seen.add(match.supplier.id);
      return true;
    });
  }, [name, shortName, others, supplier?.id]);
  const exactNameMatch = nameMatches.some((match) => match.exact);
  const sameAccount = useMemo(
    () => findSameBankAccount(bankAccount, others, supplier?.id),
    [bankAccount, others, supplier?.id],
  );
  const sameTaxCode = useMemo(
    () => findSameTaxCode(taxCode, others, supplier?.id),
    [taxCode, others, supplier?.id],
  );
  const [state, formAction, pending] = useActionState<SupplierState, FormData>(
    async (prev, formData) => {
      const result = supplier
        ? await updateSupplier(prev, formData)
        : await createSupplier(prev, formData);
      if (result.error) {
        notify({ message: result.error, tone: "error" });
      } else {
        notify({ message: result.success ?? "Đã lưu.", tone: "success" });
        onClose();
      }
      return result;
    },
    {},
  );

  return (
    <div
      className="tf-overlay-enter fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
      onClick={onClose}
    >
      <form
        action={formAction}
        onClick={(event) => event.stopPropagation()}
        className="tf-modal-enter my-auto w-full max-w-xl space-y-4 rounded-[10px] border border-zinc-200 bg-white p-6 shadow-xl"
        aria-labelledby="supplier-form-title"
      >
        <div className="flex items-center justify-between">
          <h2 id="supplier-form-title" className="text-lg font-semibold">
            {supplier ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="tf-icon-button !h-9 !min-h-9 !w-9"
            aria-label="Đóng"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        {supplier && <input type="hidden" name="id" value={supplier.id} />}
        <input type="hidden" name="kind" value={kind} />

        <div
          className="inline-flex rounded-[7px] bg-zinc-100/80 p-0.5"
          role="group"
          aria-label="Loại nhà cung cấp"
        >
          {SUPPLIER_KINDS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={kind === item.key}
              onClick={() => setKind(item.key)}
              className={`rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                kind === item.key
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="tf-label">
              {kind === "COMPANY" ? "Tên công ty" : "Họ tên"} (bắt buộc)
            </span>
            <input
              name="name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="off"
              aria-describedby="supplier-name-matches"
              placeholder={
                kind === "COMPANY"
                  ? "VD: Công ty TNHH In ấn Tân Hoàng Việt"
                  : "VD: Võ Phạm Trọng Huy"
              }
              className="tf-field"
            />
          </label>
          <div id="supplier-name-matches" aria-live="polite" className="sm:col-span-2 empty:hidden">
            {nameMatches.length > 0 && (
              <div
                className={`-mt-1 rounded-[8px] border px-3 py-2 text-sm ${
                  exactNameMatch
                    ? "border-amber-200 bg-amber-50"
                    : "border-zinc-200 bg-zinc-50"
                }`}
              >
                <p
                  className={`text-xs font-semibold ${
                    exactNameMatch ? "text-amber-800" : "text-zinc-600"
                  }`}
                >
                  {exactNameMatch
                    ? "Tên này đã có trong danh bạ. Hãy mở nhà cung cấp đó thay vì thêm mới."
                    : "Có thể nhà cung cấp này đã có:"}
                </p>
                <ul className="divide-y divide-zinc-200/70">
                  {nameMatches.map(({ supplier: match }) => (
                    <ExistingSupplierHint
                      key={match.id}
                      supplier={match}
                      onOpen={() => onOpenExisting(match)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
          <label className="block">
            <span className="tf-label">Tên gọi tắt</span>
            <input
              name="shortName"
              maxLength={60}
              value={shortName}
              onChange={(event) => setShortName(event.target.value)}
              autoComplete="off"
              placeholder="VD: TÂN HOÀNG VIỆT"
              className="tf-field"
            />
            <span className="mt-1 block text-xs text-zinc-500">
              Tên ghi ở cột SUP trong file IC/AC.
            </span>
          </label>
          <label className="block">
            <span className="tf-label">
              {kind === "COMPANY" ? "Mã số thuế (bắt buộc)" : "MST / CCCD"}
            </span>
            <input
              name="taxCode"
              required={kind === "COMPANY"}
              inputMode="numeric"
              maxLength={20}
              value={taxCode}
              onChange={(event) => setTaxCode(event.target.value)}
              autoComplete="off"
              aria-describedby="supplier-tax-matches"
              className="tf-field"
            />
            <span id="supplier-tax-matches" aria-live="polite">
              {sameTaxCode.length > 0 && (
                <span className="mt-1 block text-xs font-medium text-amber-800">
                  Mã số thuế này đã có ở {sameTaxCode.map((item) => item.name).join(", ")}.
                </span>
              )}
            </span>
          </label>
          <label className="block">
            <span className="tf-label">Số điện thoại</span>
            <input
              name="phone"
              type="tel"
              maxLength={30}
              defaultValue={supplier?.phone ?? ""}
              className="tf-field"
            />
          </label>
          <label className="block">
            <span className="tf-label">Email</span>
            <input
              name="email"
              type="email"
              maxLength={120}
              defaultValue={supplier?.email ?? ""}
              className="tf-field"
            />
          </label>
        </div>

        <fieldset className="space-y-3 border-t border-zinc-100 pt-4">
          <legend className="text-sm font-semibold text-zinc-900">
            Thông tin chuyển khoản
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="tf-label">Số tài khoản (bắt buộc)</span>
              <input
                name="bankAccount"
                required
                inputMode="numeric"
                maxLength={40}
                value={bankAccount}
                onChange={(event) => setBankAccount(event.target.value)}
                autoComplete="off"
                aria-describedby="supplier-account-matches"
                className="tf-field"
              />
            </label>
            <label className="block">
              <span className="tf-label">Ngân hàng (bắt buộc)</span>
              <input
                name="bankName"
                required
                maxLength={120}
                defaultValue={supplier?.bankName ?? ""}
                placeholder="VD: ACB, Techcombank"
                className="tf-field"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="tf-label">Chủ tài khoản</span>
              <input
                name="accountHolder"
                maxLength={200}
                defaultValue={supplier?.accountHolder ?? ""}
                placeholder="Để trống nếu trùng tên ở trên"
                className="tf-field"
              />
            </label>
          </div>
          <div id="supplier-account-matches" aria-live="polite" className="empty:hidden">
            {sameAccount.length > 0 && (
              <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <p className="text-xs font-semibold text-amber-800">
                  Số tài khoản này đã có trong danh bạ. Kiểm tra trước khi lưu để tránh trùng nhà cung cấp.
                </p>
                <ul className="divide-y divide-amber-200/70">
                  {sameAccount.map((match) => (
                    <ExistingSupplierHint
                      key={match.id}
                      supplier={match}
                      note={`${match.bankName ?? ""} · ${match.bankAccount} · ${match.accountHolder ?? match.name}`}
                      onOpen={() => onOpenExisting(match)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </fieldset>

        <label className="block">
          <span className="tf-label">Ghi chú</span>
          <textarea
            name="note"
            rows={2}
            maxLength={1000}
            defaultValue={supplier?.note ?? ""}
            placeholder="Mặt hàng cung cấp, người liên hệ…"
            className="tf-field resize-none"
          />
        </label>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="tf-button-secondary">
            Huỷ
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="tf-button-primary"
          >
            {pending && <span className="tf-spinner" aria-hidden="true" />}
            {pending ? "Đang lưu..." : supplier ? "Lưu thay đổi" : "Thêm nhà cung cấp"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SupplierRow({
  supplier,
  canManage,
  canDelete,
  onEdit,
}: {
  supplier: SupplierItem;
  canManage: boolean;
  canDelete: boolean;
  onEdit: () => void;
}) {
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const holder = supplier.accountHolder ?? supplier.name;

  async function copyAccount() {
    if (!supplier.bankAccount) return;
    try {
      await navigator.clipboard.writeText(supplier.bankAccount);
      notify({ message: `Đã sao chép số tài khoản ${supplier.bankAccount}.`, tone: "success" });
    } catch {
      notify({ message: "Trình duyệt không cho sao chép. Hãy chọn và sao chép thủ công.", tone: "error" });
    }
  }

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-[1_1_260px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-950">{supplier.name}</span>
            {supplier.shortName && (
              <span className="tf-badge bg-brand-50 text-brand-800">
                {supplier.shortName}
              </span>
            )}
            <span className="tf-badge bg-zinc-100 text-zinc-600">
              {KIND_LABEL[supplier.kind]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {supplier.taxCode && <span>MST: {supplier.taxCode}</span>}
            {supplier.phone && <span>ĐT: {supplier.phone}</span>}
            {supplier.email && <span>{supplier.email}</span>}
          </div>
          {supplier.note && (
            <p className="mt-1 text-xs text-zinc-500">{supplier.note}</p>
          )}
        </div>

        <div className="min-w-0 flex-[1_1_240px] text-sm">
          {supplier.bankAccount ? (
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <div className="font-medium tabular-nums text-zinc-900">
                  {supplier.bankAccount}
                </div>
                <div className="text-xs text-zinc-500">
                  {supplier.bankName} · {holder}
                </div>
              </div>
              <button
                type="button"
                onClick={copyAccount}
                className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0"
                aria-label={`Sao chép số tài khoản của ${supplier.name}`}
                title="Sao chép số tài khoản"
              >
                <Copy size={14} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <span className="text-xs text-amber-700">Chưa có số tài khoản</span>
          )}
        </div>

        {(canManage || canDelete) && (
          <div className="flex shrink-0 gap-1">
            {canManage && (
              <button
                type="button"
                onClick={onEdit}
                className="tf-icon-button !h-8 !min-h-8 !w-8"
                aria-label={`Sửa ${supplier.name}`}
                title="Sửa"
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (!confirm(`Xoá nhà cung cấp "${supplier.name}"?`)) return;
                  startTransition(async () => {
                    const result = await deleteSupplier(supplier.id);
                    notify({
                      message: result.error ?? result.success ?? "Đã xoá.",
                      tone: result.error ? "error" : "success",
                    });
                  });
                }}
                className="tf-icon-button !h-8 !min-h-8 !w-8 !border-transparent hover:!border-red-100 hover:!bg-red-50 hover:!text-red-500"
                aria-label={`Xoá ${supplier.name}`}
                title="Xoá"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Cập nhật {formatDate(supplier.updatedAt)}
        {supplier.updatedByName ? ` · ${supplier.updatedByName}` : ""}
      </p>
    </li>
  );
}

export default function SupplierDirectory({
  suppliers,
  canManage,
  canDelete,
}: {
  suppliers: SupplierItem[];
  canManage: boolean;
  canDelete: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  // null = đóng form; "new" = thêm mới; còn lại là nhà cung cấp đang sửa.
  const [editing, setEditing] = useState<SupplierItem | "new" | null>(null);

  const visible = useMemo(() => {
    const needle = searchKey(query.trim());
    const digits = query.replace(/[\s.-]/g, "");
    return suppliers.filter((supplier) => {
      if (kindFilter !== "ALL" && supplier.kind !== kindFilter) return false;
      if (!needle) return true;
      const haystack = searchKey(
        [
          supplier.name,
          supplier.shortName,
          supplier.accountHolder,
          supplier.bankName,
          supplier.note,
        ]
          .filter(Boolean)
          .join(" "),
      );
      return (
        haystack.includes(needle) ||
        Boolean(digits && supplier.bankAccount?.includes(digits)) ||
        Boolean(digits && supplier.taxCode?.includes(digits))
      );
    });
  }, [kindFilter, query, suppliers]);

  const counts = {
    ALL: suppliers.length,
    COMPANY: suppliers.filter((supplier) => supplier.kind === "COMPANY").length,
    PERSON: suppliers.filter((supplier) => supplier.kind === "PERSON").length,
  };

  return (
    <section className="tf-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 px-5 py-3">
        <label className="relative min-w-0 flex-[1_1_240px]">
          <span className="sr-only">Tìm nhà cung cấp</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên, tên gọi tắt, số tài khoản, MST"
            className="tf-field !pl-9"
          />
        </label>
        <div
          className="tf-scroll-tabs flex items-center gap-0.5 rounded-[7px] bg-zinc-100/80 p-0.5"
          role="group"
          aria-label="Lọc theo loại"
        >
          {(
            [
              { key: "ALL", label: "Tất cả" },
              ...SUPPLIER_KINDS,
            ] as { key: KindFilter; label: string }[]
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={kindFilter === item.key}
              onClick={() => setKindFilter(item.key)}
              className={`shrink-0 rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors ${
                kindFilter === item.key
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {item.label}
              <span className="ml-1.5 text-xs text-zinc-400">{counts[item.key]}</span>
            </button>
          ))}
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="tf-button-primary"
          >
            <Plus size={16} aria-hidden="true" />
            Thêm nhà cung cấp
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-zinc-500">
          {suppliers.length === 0
            ? canManage
              ? "Chưa có nhà cung cấp nào. Bấm “Thêm nhà cung cấp” để bắt đầu."
              : "Chưa có nhà cung cấp nào."
            : "Không tìm thấy nhà cung cấp phù hợp."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {visible.map((supplier) => (
            <SupplierRow
              key={supplier.id}
              supplier={supplier}
              canManage={canManage}
              canDelete={canDelete}
              onEdit={() => setEditing(supplier)}
            />
          ))}
        </ul>
      )}

      {editing && (
        <SupplierForm
          key={editing === "new" ? "new" : editing.id}
          supplier={editing === "new" ? null : editing}
          others={suppliers}
          onOpenExisting={(match) => {
            if (
              editing === "new" &&
              !confirm(`Bỏ thông tin đang nhập và mở "${match.name}"?`)
            ) {
              return;
            }
            setEditing(match);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
