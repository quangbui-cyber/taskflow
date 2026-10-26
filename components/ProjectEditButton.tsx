"use client";

import { useActionState, useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateProject, type ActionState } from "@/app/actions/projects";
import RevenueInput from "@/components/RevenueInput";
import ProjectResponsibilitySelect from "@/components/ProjectResponsibilitySelect";
import { responsibilityValue, type ProjectResponsibility, type ResponsibilityOptions } from "@/lib/projectResponsibility";
import ClientSelect, { type ClientOption } from "@/components/ClientSelect";
import ProjectAccountSelect, { preventMissingProjectAccount, type ProjectAccountOption } from "@/components/ProjectAccountSelect";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import {
  PROJECT_CATEGORIES,
  PROJECT_TYPES,
  type ProjectCategory,
} from "@/lib/types";

export default function ProjectEditButton({
  project,
  clients,
  accounts,
  responsibilityOptions,
  approverOptions,
  canEdit,
  canEditRevenue,
  canEditApprovers,
}: {
  project: ProjectResponsibility & {
    id: string;
    name: string;
    description: string | null;
    type: string;
    category: ProjectCategory;
    hasPurchaseOrder: boolean;
    executionStartAt: string | null; // yyyy-MM-dd theo giờ VN
    executionEndAt: string | null;
    revenue: number | null;
    clientId: string | null;
    clientName: string | null;
    accountId: string | null;
    accountName: string | null;
    icApproverId: string | null;
    acApproverId: string | null;
  };
  clients: ClientOption[];
  accounts: ProjectAccountOption[];
  responsibilityOptions: ResponsibilityOptions;
  approverOptions: UserPickerOption[];
  canEdit: boolean;
  canEditRevenue: boolean;
  canEditApprovers: boolean;
}) {
  const { notify } = useInteraction();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(project.category);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await updateProject(prev, formData);
      if (result.error) {
        notify({ message: result.error, tone: "error" });
      } else {
        notify({ message: "Đã lưu thông tin dự án.", tone: "success" });
        setOpen(false);
      }
      return result;
    },
    {},
  );

  return (
    <>
      {canEdit && (
        <button
          type="button"
          onClick={() => {
            setCategory(project.category);
            setOpen(true);
          }}
          className="tf-button-secondary !min-h-9 !px-3 !py-1.5 text-sm"
        >
          <Pencil size={15} strokeWidth={1.8} aria-hidden="true" />
          Sửa
        </button>
      )}

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-zinc-950/35 p-4 backdrop-blur-[2px] sm:p-8"
          onClick={() => setOpen(false)}
        >
          <form
            action={formAction}
            onSubmit={(event) => {
              if (preventMissingProjectAccount(event)) {
                notify({ message: "Dự án Khách hàng bắt buộc chọn Account phụ trách.", tone: "error" });
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="tf-modal-enter my-auto w-full max-w-lg space-y-4 rounded-[10px] border border-zinc-200 bg-white p-6 shadow-xl"
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
                Mục đích dự án
              </span>
              <select
                name="category"
                value={category}
                disabled={project.hasPurchaseOrder}
                onChange={(event) =>
                  setCategory(event.target.value as ProjectCategory)
                }
                className="tf-field mt-1"
              >
                {PROJECT_CATEGORIES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              {category === "INTERNAL" && (
                <span className="mt-1 block text-xs text-zinc-500">
                  {project.category === "CLIENT"
                    ? "Chuyển sang Nội bộ sẽ xoá Client, Account và doanh thu của dự án."
                    : "Dự án nội bộ không dùng Client, Account hoặc doanh thu."}
                </span>
              )}
            </label>

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
              {category === "INTERNAL" && (
                <div className="sm:col-span-2">
                  <ProjectResponsibilitySelect
                    {...responsibilityOptions}
                    defaultValue={responsibilityValue(project)}
                    disabled={pending}
                  />
                </div>
              )}
              {category === "CLIENT" && (
                <label className="block">
                  <span className="text-xs font-medium text-zinc-500">
                    Loại hình
                  </span>
                  <select
                    name="type"
                    defaultValue={project.type}
                    className="tf-field mt-1"
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {category === "CLIENT" && canEditRevenue && (
                <label className="block">
                  <span className="text-xs font-medium text-zinc-500">
                    Doanh thu (VND)
                  </span>
                  <RevenueInput
                    name="revenue"
                    defaultValue={project.revenue ?? 0}
                    placeholder="VD: 500.000.000"
                    className="tf-field mt-1"
                  />
                </label>
              )}

              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Ngày thực hiện
                </span>
                <input
                  name="executionStartAt"
                  type="date"
                  defaultValue={project.executionStartAt ?? ""}
                  className="tf-field mt-1"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Đến ngày (nếu chạy nhiều ngày)
                </span>
                <input
                  name="executionEndAt"
                  type="date"
                  defaultValue={project.executionEndAt ?? ""}
                  className="tf-field mt-1"
                />
              </label>

              {category === "CLIENT" && (
                <div className="block">
                  <span className="text-xs font-medium text-zinc-500">
                    Client
                  </span>
                  <ClientSelect
                    clients={clients}
                    defaultValue={project.clientId ?? ""}
                    className="mt-1"
                  />
                </div>
              )}

              {category === "CLIENT" && (
                <ProjectAccountSelect
                  accounts={accounts}
                  defaultValue={project.accountId ?? ""}
                  disabled={pending}
                />
              )}
            </div>

            {category === "CLIENT" && canEditApprovers && (
              <fieldset className="space-y-3 border-t border-zinc-100 pt-4">
                <legend className="text-sm font-semibold text-zinc-900">
                  Duyệt tài chính
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <span className="text-xs font-medium text-zinc-500">
                      Người duyệt IC
                    </span>
                    <UserPicker
                      name="icApproverId"
                      options={approverOptions}
                      defaultValue={project.icApproverId ?? ""}
                      emptyLabel="Chưa chọn"
                      placeholder="Chưa chọn"
                      ariaLabel="Người duyệt IC"
                      disabled={pending}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <span className="text-xs font-medium text-zinc-500">
                      Người duyệt AC
                    </span>
                    <UserPicker
                      name="acApproverId"
                      options={approverOptions}
                      defaultValue={project.acApproverId ?? ""}
                      emptyLabel="Chưa chọn"
                      placeholder="Chưa chọn"
                      ariaLabel="Người duyệt AC"
                      disabled={pending}
                      className="mt-1"
                    />
                  </div>
                </div>
              </fieldset>
            )}

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
                aria-busy={pending}
              >
                {pending && <span className="tf-spinner" aria-hidden="true" />}
                {pending ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
