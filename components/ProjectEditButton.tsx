"use client";

import { useActionState, useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateProject, type ActionState } from "@/app/actions/projects";
import RevenueInput from "@/components/RevenueInput";
import ClientSelect, { type ClientOption } from "@/components/ClientSelect";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";

export default function ProjectEditButton({
  project,
  clients,
  accounts,
  canEdit,
}: {
  project: {
    id: string;
    name: string;
    description: string | null;
    revenue: number;
    clientId: string | null;
    clientName: string | null;
    accountId: string | null;
    accountName: string | null;
  };
  clients: ClientOption[];
  accounts: UserPickerOption[];
  canEdit: boolean;
}) {
  const { notify } = useInteraction();
  const [open, setOpen] = useState(false);
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
    {}
  );

  return (
    <>
      {canEdit && (
        <button
          type="button"
          onClick={() => setOpen(true)}
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
              <label className="block sm:col-span-2">
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

              <label className="block">
                <span className="text-xs font-medium text-zinc-500">
                  Account
                </span>
                <UserPicker
                  name="accountId"
                  defaultValue={project.accountId ?? ""}
                  options={accounts}
                  placeholder="— Chưa chọn —"
                  emptyLabel="— Chưa chọn —"
                  ariaLabel="Account"
                  className="mt-1"
                />
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
