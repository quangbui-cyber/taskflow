"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CatalogState } from "@/app/actions/catalog";

type Item = { id: string; name: string; projectCount: number };

export default function CatalogManager({
  title,
  hint,
  items,
  createAction,
  deleteAction,
  placeholder,
  countLabel = "project",
}: {
  title: string;
  hint: string;
  items: Item[];
  createAction: (prev: CatalogState, formData: FormData) => Promise<CatalogState>;
  deleteAction: (id: string) => Promise<void>;
  placeholder: string;
  countLabel?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<CatalogState, FormData>(
    createAction,
    {}
  );

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="tf-panel overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-100">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-xs text-zinc-400 mt-0.5">{hint}</p>
      </div>

      <form ref={formRef} action={formAction} className="p-4 flex gap-2">
        <input
          name="name"
          type="text"
          required
          placeholder={placeholder}
          className="tf-field flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="tf-button-primary"
        >
          <Plus size={16} aria-hidden="true" />
          Thêm
        </button>
      </form>
      {state.error && (
        <p className="px-4 -mt-2 pb-2 text-xs text-red-600">{state.error}</p>
      )}

      <ul className="divide-y divide-zinc-50">
        {items.length === 0 && (
          <li className="px-5 py-3 text-sm text-zinc-400">Chưa có mục nào.</li>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            className="px-5 py-2.5 flex items-center gap-3 text-sm"
          >
            <span className="flex-1 font-medium truncate">{item.name}</span>
            <span className="text-xs text-zinc-400 shrink-0">
              {item.projectCount} {countLabel}
            </span>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Xoá "${item.name}"? Các project đang gắn sẽ bỏ trống mục này (không bị xoá project).`
                  )
                ) {
                  deleteAction(item.id);
                }
              }}
              className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 !border-transparent hover:!border-red-100 hover:!bg-red-50 hover:!text-red-500"
              title="Xoá"
              aria-label={`Xoá ${item.name}`}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
