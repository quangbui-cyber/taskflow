"use client";

import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { findSimilarSuppliers, searchKey } from "@/lib/supplierMatch";
import SupplierPicker, { supplierLabel } from "@/components/SupplierPicker";
import {
  SupplierFields,
  emptySupplierDraft,
  saveSupplierDraft,
  type SupplierDraft,
  type SupplierOption,
} from "@/components/SupplierQuickForm";

function Modal({
  labelledBy,
  onClose,
  wide,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="tf-overlay-enter fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === "Escape" && onClose()}
        className={`tf-modal-enter my-auto w-full space-y-4 rounded-[10px] border border-zinc-200 bg-white p-6 shadow-xl ${
          wide ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function SimilarWarning({
  draft,
  suppliers,
  onUse,
}: {
  draft: SupplierDraft;
  suppliers: SupplierOption[];
  onUse: (supplier: SupplierOption) => void;
}) {
  const seen = new Set<string>();
  const matches = [draft.name, draft.shortName]
    .filter((text) => text.trim())
    .flatMap((text) => findSimilarSuppliers(text, suppliers, { limit: 3 }))
    .filter((match) => (seen.has(match.supplier.id) ? false : (seen.add(match.supplier.id), true)))
    .slice(0, 3);
  if (!matches.length) return null;
  return (
    <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" aria-live="polite">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle size={15} aria-hidden="true" />
        Có thể đã có trong danh bạ:
      </p>
      <ul className="mt-1 space-y-1">
        {matches.map(({ supplier, exact }) => (
          <li key={supplier.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              {supplierLabel(supplier)}
              {exact && <b> (trùng tên)</b>}
            </span>
            <button type="button" onClick={() => onUse(supplier)} className="shrink-0 font-semibold text-brand-800 hover:underline">
              Dùng NCC này
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Cách 1: tạo nhà cung cấp mới ngay từ một dòng chi phí, rồi chọn luôn cho dòng đó. */
export function SupplierCreateDialog({
  initialText,
  suppliers,
  sameFileLines,
  onClose,
  onDone,
}: {
  initialText: string;
  suppliers: SupplierOption[];
  /** Số dòng khác cũng ghi cùng tên NCC trong file (để gán luôn). */
  sameFileLines: number;
  onClose: () => void;
  /** created = NCC mới vừa lưu (để thêm vào danh sách); null khi chọn NCC có sẵn. */
  onDone: (supplier: SupplierOption, options: { created: boolean; assignSameFile: boolean }) => void;
}) {
  const [draft, setDraft] = useState<SupplierDraft>(() => emptySupplierDraft(initialText.trim()));
  const [assignSameFile, setAssignSameFile] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    const result = await saveSupplierDraft(draft);
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onDone(result.supplier, { created: true, assignSameFile });
  }

  return (
    <Modal labelledBy="supplier-create-title" onClose={() => !saving && onClose()}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="supplier-create-title" className="text-lg font-semibold">Tạo nhà cung cấp</h2>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Đóng">
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <SupplierFields draft={draft} onChange={setDraft} disabled={saving} idPrefix="supplier-create" />
      <SimilarWarning
        draft={draft}
        suppliers={suppliers}
        onUse={(supplier) => onDone(supplier, { created: false, assignSameFile })}
      />
      {sameFileLines > 0 && (
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand-700"
            checked={assignSameFile}
            disabled={saving}
            onChange={(event) => setAssignSameFile(event.target.checked)}
          />
          Gán luôn cho {sameFileLines} dòng khác cũng ghi “{initialText.trim()}” trong file
        </label>
      )}
      {error && (
        <p role="alert" className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={saving} className="tf-button-secondary">
          Huỷ
        </button>
        <button type="button" onClick={save} disabled={saving} aria-busy={saving} className="tf-button-primary">
          {saving ? <span className="tf-spinner" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
          Tạo và chọn
        </button>
      </div>
    </Modal>
  );
}

export type FileSupplierGroup = { fileName: string; lineCount: number };

type Row = {
  fileName: string;
  lineCount: number;
  mode: "create" | "existing";
  existingId: string | null;
  draft: SupplierDraft;
  error: string;
  /** Đã lưu xong (để bấm lại không tạo trùng). */
  savedId: string | null;
};

/**
 * Cách 2: các tên NCC ghi trong file Excel mà danh bạ chưa có. Mỗi tên: tạo NCC mới hoặc chọn
 * NCC có sẵn, rồi gán cho mọi dòng chi phí ghi tên đó.
 */
export function ImportedSuppliersDialog({
  groups,
  suppliers,
  canCreate,
  onClose,
  onCreated,
  onDone,
}: {
  groups: FileSupplierGroup[];
  suppliers: SupplierOption[];
  canCreate: boolean;
  onClose: () => void;
  /** NCC vừa lưu vào danh bạ (báo ngay cả khi các dòng khác còn lỗi). */
  onCreated: (created: SupplierOption[]) => void;
  /** Tên trong file (đã chuẩn hoá) → id NCC để gán. */
  onDone: (assignments: Map<string, string>) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    groups.map((group) => {
      // Tên gần giống NCC có sẵn (vd "HUY" ↔ "Võ Phạm Trọng Huy") thì gợi ý dùng NCC đó.
      const suggestion = findSimilarSuppliers(group.fileName, suppliers, { limit: 1 })[0]?.supplier ?? null;
      return {
        ...group,
        mode: suggestion || !canCreate ? "existing" : "create",
        existingId: suggestion?.id ?? null,
        draft: emptySupplierDraft(group.fileName),
        error: "",
        savedId: null,
      };
    }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const ready = rows.filter((row) => (row.mode === "existing" ? row.existingId : true));
  const lineTotal = ready.reduce((sum, row) => sum + row.lineCount, 0);
  const createCount = rows.filter((row) => row.mode === "create" && !row.savedId).length;

  async function save() {
    setSaving(true);
    setError("");
    const created: SupplierOption[] = [];
    const next = [...rows];
    let failed = false;
    for (let index = 0; index < next.length; index += 1) {
      const row = next[index];
      if (row.mode !== "create" || row.savedId) continue;
      const result = await saveSupplierDraft(row.draft);
      if ("error" in result) {
        next[index] = { ...row, error: result.error };
        failed = true;
      } else {
        created.push(result.supplier);
        next[index] = { ...row, error: "", savedId: result.supplier.id };
      }
    }
    setRows(next);
    setSaving(false);
    const assignments = new Map<string, string>();
    for (const row of next) {
      const id = row.mode === "create" ? row.savedId : row.existingId;
      if (id) assignments.set(searchKey(row.fileName), id);
    }
    if (created.length) onCreated(created);
    if (failed) {
      setError("Một số NCC chưa lưu được — sửa chỗ báo đỏ rồi bấm lại. NCC đã lưu sẽ không bị tạo trùng.");
      return;
    }
    onDone(assignments);
  }

  return (
    <Modal labelledBy="imported-suppliers-title" onClose={() => !saving && onClose()} wide>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="imported-suppliers-title" className="text-lg font-semibold">Thêm nhà cung cấp từ file</h2>
        </div>
        <button type="button" onClick={onClose} disabled={saving} className="tf-icon-button !h-9 !min-h-9 !w-9" aria-label="Đóng">
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <section
            key={row.fileName}
            aria-label={`Nhà cung cấp ${row.fileName}`}
            className={`rounded-[8px] border p-4 ${row.error ? "border-red-300" : "border-zinc-200"}`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <span className="text-base font-bold">{row.fileName}</span>
                <span className="ml-2 text-sm text-zinc-500">{row.lineCount} dòng chi phí</span>
                {row.savedId && <span className="ml-2 text-sm font-medium text-emerald-700">Đã lưu</span>}
              </div>
              <div role="radiogroup" aria-label={`Cách xử lý ${row.fileName}`} className="inline-flex rounded-[8px] border border-zinc-200 bg-zinc-50 p-0.5">
                {(canCreate ? (["create", "existing"] as const) : (["existing"] as const)).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={row.mode === mode}
                    disabled={saving || Boolean(row.savedId)}
                    onClick={() => update(index, { mode, error: "" })}
                    className={`rounded-[6px] px-3 py-1.5 text-sm font-medium ${
                      row.mode === mode ? "bg-white text-brand-800 shadow-sm" : "text-zinc-600 hover:text-zinc-900"
                    }`}
                  >
                    {mode === "create" ? "Tạo NCC mới" : "Dùng NCC có sẵn"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3">
              {row.mode === "existing" ? (
                <div className="max-w-md">
                  <SupplierPicker
                    value={row.existingId}
                    suppliers={suppliers}
                    onChange={(id) => update(index, { existingId: id })}
                    fileName={row.existingId ? null : row.fileName}
                    disabled={saving}
                    className="tf-field !min-h-10 !py-2 text-sm"
                  />
                </div>
              ) : (
                <SupplierFields
                  draft={row.draft}
                  onChange={(draft) => update(index, { draft, error: "" })}
                  disabled={saving || Boolean(row.savedId)}
                  idPrefix={`imported-supplier-${index}`}
                />
              )}
            </div>
            {row.error && (
              <p role="alert" className="mt-2 text-sm font-medium text-red-700">
                {row.error}
              </p>
            )}
          </section>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-[8px] bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-zinc-600">
          {createCount > 0 ? `Sẽ tạo ${createCount} NCC mới · ` : ""}gán cho {lineTotal} dòng chi phí
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="tf-button-secondary">
            Để sau
          </button>
          <button type="button" onClick={save} disabled={saving || lineTotal === 0} aria-busy={saving} className="tf-button-primary">
            {saving ? <span className="tf-spinner" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            Lưu và gán vào {lineTotal} dòng
          </button>
        </div>
      </div>
    </Modal>
  );
}
