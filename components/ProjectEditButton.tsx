"use client";

import { useActionState, useState } from "react";
import { BriefcaseBusiness, Building2, Pencil, X } from "lucide-react";
import { updateProject, type ActionState } from "@/app/actions/projects";
import { PROJECT_STATUSES, formatVND, projectStatusInfo } from "@/lib/types";
import RevenueInput from "@/components/RevenueInput";

type Option = { id: string; name: string };

export default function ProjectEditButton({
  project,
  clients,
  accounts,
  canEdit,
  showRevenue,
}: {
  project: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    revenue: number;
    clientId: string | null;
    clientName: string | null;
    accountId: string | null;
    accountName: string | null;
  };
  clients: Option[];
  accounts: Option[];
  canEdit: boolean;
  showRevenue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await updateProject(prev, formData);
      if (!result.error) setOpen(false);
      return result;
    },
    {}
  );

  const info = projectStatusInfo(project.status);

  return (
    <>
      <div className="flex flex-col items-start gap-1.5 sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`tf-badge ${info.className}`}>
            {info.label}
          </span>
          {showRevenue && (
            <span className="text-sm font-semibold text-zinc-700">
              {formatVND(project.revenue)}
            </span>
          )}
          {canEdit && (
            <button
              onClick={() => setOpen(true)}
              className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
            >
              <Pencil size={14} strokeWidth={1.8} aria-hidden="true" />
              Sửa
            </button>
          )}
        </div>
        {(project.clientName || project.accountName) && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
            {project.clientName && (
              <span className="inline-flex items-center gap-1">
                <Building2 size={13} aria-hidden="true" />
                {project.clientName}
              </span>
            )}
            {project.clientName && project.accountName && " · "}
            {project.accountName && (
              <span className="inline-flex items-center gap-1">
                <BriefcaseBusiness size={13} aria-hidden="true" />
                {project.accountName}
              </span>
            )}
          </span>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
          onClick={() => setOpen(false)}
        >
          <form
            action={formAction}
            onClick={(e) => e.stopPropagation()}
            className="my-auto w-full max-w-lg space-y-4 rounded-[10px] border border-zinc-200 bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Sửa thông tin dự án</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="tf-icon-button !h-9 !min-h-9 !w-9"
                aria-label="Đóng"
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>

            <input type="hidden" name="projectId" value={project.id} />

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Tên project
              </span>
              <input
                name="name"
                type="text"
                required
                defaultValue={project.name}
                className="tf-field mt-1"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-zinc-500">Mô tả</span>
              <textarea
                name="description"
                rows={2}
                defaultValue={project.description ?? ""}
                placeholder="Mô tả ngắn (không bắt buộc)"
                className="tf-field mt-1 resize-none"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Tình trạng
                </span>
                <select
                  name="status"
                  defaultValue={project.status}
                  className="tf-field mt-1"
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Doanh thu (VND)
                </span>
                <RevenueInput
                  name="revenue"
                  defaultValue={project.revenue}
                  placeholder="VD: 500.000.000"
                  className="tf-field mt-1"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Client
                </span>
                <select
                  name="clientId"
                  defaultValue={project.clientId ?? ""}
                  className="tf-field mt-1"
                >
                  <option value="">— Chưa chọn —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Account
                </span>
                <select
                  name="accountId"
                  defaultValue={project.accountId ?? ""}
                  className="tf-field mt-1"
                >
                  <option value="">— Chưa chọn —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {state.error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {state.error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="tf-button-secondary"
              >
                Huỷ
              </button>
              <button
                type="submit"
                disabled={pending}
                className="tf-button-primary"
              >
                {pending ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
