"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { searchKey } from "@/lib/supplierMatch";
import type { SupplierOption } from "@/components/SupplierQuickForm";

const MAX_OPTIONS = 8;

export function supplierLabel(supplier: SupplierOption) {
  return supplier.shortName ? `${supplier.shortName} · ${supplier.name}` : supplier.name;
}

type Option =
  | { type: "supplier"; supplier: SupplierOption }
  | { type: "clear" }
  | { type: "create"; text: string };

/**
 * Ô chọn nhà cung cấp gõ được: tìm theo tên gọi tắt, tên đầy đủ hoặc MST (không phân biệt
 * hoa thường, có dấu hay không). Không có thì đề xuất "Tạo NCC mới" ngay tại dòng.
 */
export default function SupplierPicker({
  value,
  suppliers,
  onChange,
  onCreate,
  fileName,
  disabled,
  className = "",
}: {
  value: string | null;
  suppliers: SupplierOption[];
  onChange: (supplierId: string | null) => void;
  /** Có thì hiện "Tạo NCC mới"; nhận chữ đang gõ. */
  onCreate?: (text: string) => void;
  /** Tên NCC ghi trong file Excel khi chưa khớp danh bạ (gợi ý ô trống). */
  fileName?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; bottom: number } | null>(null);

  const selected = value ? suppliers.find((supplier) => supplier.id === value) ?? null : null;

  const options = useMemo<Option[]>(() => {
    const key = searchKey(query);
    const matches = suppliers.filter((supplier) => {
      if (!key) return true;
      return [supplier.shortName, supplier.name, supplier.taxCode].some(
        (text) => text && searchKey(text).includes(key),
      );
    });
    // Trùng hẳn tên gọi tắt / tên xếp trước.
    matches.sort((a, b) => {
      const exact = (supplier: SupplierOption) =>
        [supplier.shortName, supplier.name].some((text) => text && searchKey(text) === key) ? 0 : 1;
      return exact(a) - exact(b);
    });
    const list: Option[] = matches.slice(0, MAX_OPTIONS).map((supplier) => ({ type: "supplier", supplier }));
    const typed = query.trim();
    const hasExact = matches.some((supplier) =>
      [supplier.shortName, supplier.name].some((text) => text && searchKey(text) === key),
    );
    if (onCreate && typed && !hasExact) list.push({ type: "create", text: typed });
    if (value && !typed) list.push({ type: "clear" });
    return list;
  }, [query, suppliers, onCreate, value]);

  function measure() {
    const box = inputRef.current?.getBoundingClientRect();
    if (box) setRect({ left: box.left, top: box.top, width: box.width, bottom: box.bottom });
  }

  // Danh sách nổi trên cùng (ra ngoài khung bảng có thanh cuộn); cuộn hay đổi cỡ thì đặt lại.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  function openList() {
    if (disabled) return;
    measure();
    // Dòng chưa có NCC mà file có ghi tên: gõ sẵn tên đó để thấy gợi ý / "Tạo NCC mới" ngay.
    setQuery(!selected && fileName ? fileName : "");
    setActive(0);
    setOpen(true);
  }

  function choose(option: Option) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    if (option.type === "supplier") onChange(option.supplier.id);
    else if (option.type === "clear") onChange(null);
    else onCreate?.(option.text);
  }

  const shown = open ? query : selected ? supplierLabel(selected) : "";
  const placeholder = fileName ? `Chọn NCC (file ghi: ${fileName})` : "— Chọn nhà cung cấp —";
  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0;
  const placeAbove = rect ? spaceBelow < 280 && rect.top > spaceBelow : false;

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Nhà cung cấp"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        title={selected ? supplierLabel(selected) : fileName ? `File ghi: ${fileName}` : undefined}
        placeholder={placeholder}
        value={shown}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          if (!open) openList();
        }}
        onKeyDown={(event) => {
          if (!open) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(options.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (options[active]) choose(options[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className={`${className} ${!selected && fileName && !open ? "placeholder:text-amber-700" : ""}`}
      />
      {open &&
        rect &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-label="Nhà cung cấp"
            // Giữ focus ở ô gõ khi bấm vào danh sách.
            onMouseDown={(event) => event.preventDefault()}
            style={{
              position: "fixed",
              left: rect.left,
              width: Math.max(rect.width, 300),
              ...(placeAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
            }}
            className="z-50 max-h-72 overflow-y-auto rounded-[8px] border border-zinc-200 bg-white py-1 text-sm shadow-xl"
          >
            {options.length === 0 && (
              <li className="px-3 py-2 text-zinc-500">
                {suppliers.length ? "Không tìm thấy nhà cung cấp." : "Danh bạ chưa có nhà cung cấp."}
              </li>
            )}
            {options.map((option, index) => (
              <li
                key={option.type === "supplier" ? option.supplier.id : option.type}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 ${
                  index === active ? "bg-zinc-100" : ""
                } ${option.type === "create" ? "mt-1 border-t border-zinc-100 font-semibold text-brand-800" : ""}`}
              >
                {option.type === "supplier" && (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      {option.supplier.shortName && <b className="font-semibold">{option.supplier.shortName} · </b>}
                      {option.supplier.name}
                    </span>
                    {option.supplier.taxCode && (
                      <span className="shrink-0 text-xs tabular-nums text-zinc-500">MST {option.supplier.taxCode}</span>
                    )}
                  </>
                )}
                {option.type === "create" && (
                  <>
                    <Plus size={14} aria-hidden="true" />
                    Tạo NCC mới “{option.text}”
                  </>
                )}
                {option.type === "clear" && (
                  <>
                    <X size={14} aria-hidden="true" className="text-zinc-500" />
                    <span className="text-zinc-600">Bỏ chọn nhà cung cấp</span>
                  </>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
