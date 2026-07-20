"use client";

import { useActionState, useRef, useState } from "react";
import { createProject, type ActionState } from "@/app/actions/projects";
import RevenueInput from "@/components/RevenueInput";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Plus,
  Upload,
} from "lucide-react";
import ClientSelect, { type ClientOption } from "@/components/ClientSelect";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import { useActionFeedback } from "@/components/InteractionProvider";
import { PROJECT_TYPES } from "@/lib/types";
import type { PurchaseOrderDraft } from "@/lib/purchaseOrder";

type ImportResult = {
  draft: PurchaseOrderDraft;
  fileName: string;
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function matchClientId(clientName: string, clients: ClientOption[]) {
  const importedName = normalizeName(clientName);
  return (
    clients.find((client) => {
      const candidate = normalizeName(client.name);
      return (
        candidate === importedName ||
        importedName.includes(candidate) ||
        candidate.includes(importedName)
      );
    })?.id ?? ""
  );
}

export default function NewProjectForm({
  clients,
  accounts,
}: {
  clients: ClientOption[];
  accounts: UserPickerOption[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    createProject,
    {}
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [draftVersion, setDraftVersion] = useState(0);
  useActionFeedback(state);

  async function importPurchaseOrder(file: File) {
    setImporting(true);
    setImportError("");

    const body = new FormData();
    body.append("file", file);

    try {
      const response = await fetch("/api/projects/import-po", {
        method: "POST",
        body,
      });
      const result = (await response.json()) as ImportResult & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error || "Không thể đọc PO.");
      }
      setImportResult(result);
      setDraftVersion((version) => version + 1);
    } catch (error) {
      setImportResult(null);
      setImportError(
        error instanceof Error ? error.message : "Không thể đọc PO."
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setImporting(false);
    }
  }

  const importedClientId = importResult
    ? matchClientId(importResult.draft.clientName, clients)
    : "";

  return (
    <form
      action={formAction}
      className="tf-panel space-y-4 p-5 sm:p-6"
    >
      <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-sm ring-1 ring-zinc-200">
              <FileText size={19} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-900">
                PO dự án
              </h2>
              <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                Tải PO Jabil để tự điền Client, nội dung và giá trị dự án.
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            name="projectFile"
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPurchaseOrder(file);
            }}
          />
          <button
            type="button"
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            className="tf-button-secondary shrink-0"
          >
            {importing ? (
              <span className="tf-spinner" aria-hidden="true" />
            ) : (
              <Upload size={16} aria-hidden="true" />
            )}
            {importing ? "Đang đọc PO..." : "Nhập PO PDF"}
          </button>
        </div>

        {importResult && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
            <CheckCircle2
              size={17}
              className="mt-0.5 shrink-0 text-emerald-600"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-medium">
                Đã đọc PO {importResult.draft.poNumber}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-emerald-700">
                {importResult.fileName} ·{" "}
                {new Intl.NumberFormat("vi-VN").format(
                  importResult.draft.revenue
                )}{" "}
                {importResult.draft.currency}
              </p>
              {!importedClientId && (
                <p className="mt-1 text-xs text-amber-700">
                  Chưa tìm thấy Client tương ứng. Vui lòng chọn Client thủ công.
                </p>
              )}
              {importResult.draft.warnings.map((warning) => (
                <p key={warning} className="mt-1 text-xs text-amber-700">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}

        {importError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertCircle
              size={17}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <p>{importError}</p>
          </div>
        )}
      </section>

      {importResult?.draft.provider === "JABIL" && (
        <input type="hidden" name="projectSource" value="JABIL_PO" />
      )}

      <label className="block" htmlFor="project-name">
        <span className="tf-label">Tên dự án</span>
        <input
          key={`name-${draftVersion}`}
          id="project-name"
          name="name"
          type="text"
          required
          autoComplete="off"
          placeholder="Ví dụ: Website bán hàng"
          defaultValue={importResult?.draft.name ?? ""}
          className="tf-field"
        />
      </label>
      <label className="block" htmlFor="project-description">
        <span className="tf-label">Mô tả</span>
        <textarea
          key={`description-${draftVersion}`}
          id="project-description"
          name="description"
          rows={importResult ? 6 : 2}
          placeholder="Phạm vi hoặc mục tiêu chính (không bắt buộc)"
          defaultValue={importResult?.draft.description ?? ""}
          className="tf-field resize-none"
        />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Tình trạng ban đầu</span>
          <span className="tf-field mt-1 flex items-center bg-zinc-50 text-zinc-600">
            {importResult?.draft.provider === "JABIL"
              ? "On Process"
              : "Bidding"}
          </span>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Loại hình</span>
          <select name="type" defaultValue="OTHER" className="tf-field mt-1">
            {PROJECT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <div className="block">
          <span className="text-xs font-medium text-zinc-500">Client</span>
          <ClientSelect
            key={`client-${draftVersion}`}
            clients={clients}
            defaultValue={importedClientId}
            className="mt-1"
          />
        </div>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500">Account</span>
          <UserPicker
            name="accountId"
            options={accounts}
            placeholder="— Chưa chọn —"
            emptyLabel="— Chưa chọn —"
            ariaLabel="Account"
            className="mt-1"
          />
        </label>
      </div>

      <fieldset>
        <legend className="tf-label mb-2">Thời gian thực hiện</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">Bắt đầu</span>
            <input
              name="executionStartAt"
              type="date"
              className="tf-field mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">
              Kết thúc <span className="font-normal text-zinc-400">(nếu nhiều ngày)</span>
            </span>
            <input name="executionEndAt" type="date" className="tf-field mt-1" />
          </label>
        </div>
      </fieldset>

      <label className="block max-w-full sm:max-w-[calc(50%_-_0.375rem)]">
        <span className="tf-label">Doanh thu (VND)</span>
        <RevenueInput
          key={`revenue-${draftVersion}`}
          name="revenue"
          defaultValue={importResult?.draft.revenue}
          placeholder="VD: 500.000.000"
          className="tf-field"
        />
      </label>
      {clients.length === 0 && accounts.length === 0 && (
        <p className="text-xs text-zinc-400">
          Chưa có Client/Account nào. Admin có thể thêm trong Cài đặt.
        </p>
      )}
      {state.error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="tf-button-primary"
        aria-busy={pending}
      >
        {pending ? (
          <span className="tf-spinner" aria-hidden="true" />
        ) : (
          <Plus size={16} aria-hidden="true" />
        )}
        {pending ? "Đang tạo..." : "Tạo dự án"}
      </button>
    </form>
  );
}
