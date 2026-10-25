"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import {
  createClient,
  deleteClient,
  updateClient,
  type CatalogState,
} from "@/app/actions/catalog";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";

type ClientItem = {
  id: string;
  name: string;
  projectCount: number;
};

function ClientRow({ client }: { client: ClientItem }) {
  const { notify } = useInteraction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  function resetEditor() {
    setEditing(false);
    setName(client.name);
    setMessage("");
  }

  return (
    <li className="px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {client.name}
        </span>
        <span className="shrink-0 text-xs text-zinc-400">
          {client.projectCount} project
        </span>
        <button
          type="button"
          onClick={() => {
            setEditing((value) => !value);
            setMessage("");
          }}
          className="tf-icon-button !h-8 !min-h-8 !w-8"
          title={editing ? "Đóng" : "Sửa"}
          aria-label={`${editing ? "Đóng chỉnh sửa" : "Sửa"} ${client.name}`}
        >
          {editing ? <X size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Xoá "${client.name}"? Các project đang gắn sẽ không bị xoá.`)) return;
            startTransition(async () => {
              const result = await deleteClient(client.id);
              if (result?.error) {
                setIsError(true);
                setMessage(result.error);
                notify({ message: result.error, tone: "error" });
              } else {
                notify({ message: `Đã xoá ${client.name}.`, tone: "success" });
              }
            });
          }}
          className="tf-icon-button !h-8 !min-h-8 !w-8 !border-transparent hover:!border-red-100 hover:!bg-red-50 hover:!text-red-500"
          title="Xoá"
          aria-label={`Xoá ${client.name}`}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {editing && (
        <div className="mt-3 grid gap-3 rounded-[8px] bg-zinc-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <input
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setMessage("");
            }}
            className="tf-field !min-h-9 !py-1.5"
            aria-label={`Tên client ${client.name}`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={resetEditor}
              className="tf-button-secondary !min-h-9 !px-3 !py-1.5"
            >
              Huỷ
            </button>
            <button
              type="button"
              disabled={pending || !name.trim()}
              onClick={() => {
                startTransition(async () => {
                  const result = await updateClient(client.id, name);
                  setIsError(Boolean(result.error));
                  setMessage(result.error ?? result.success ?? "");
                  if (!result.error) setEditing(false);
                  notify({
                    message: result.error ?? result.success ?? "Đã lưu Client.",
                    tone: result.error ? "error" : "success",
                  });
                });
              }}
              className="tf-button-primary !min-h-9 !px-3 !py-1.5"
            >
              <Save size={14} aria-hidden="true" />
              {pending ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </div>
      )}
      {message && isError && (
        <p className="mt-2 text-xs text-red-600">
          {message}
        </p>
      )}
    </li>
  );
}

export default function ClientCatalogManager({ clients }: { clients: ClientItem[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<CatalogState, FormData>(
    createClient,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Client</h2>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      >
        <input
          name="name"
          type="text"
          required
          placeholder="Tên client, ví dụ: Ngân hàng ABC"
          className="tf-field"
        />
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
          {pending ? "Đang thêm..." : "Thêm"}
        </button>
      </form>
      {state.error && <p className="px-4 pb-3 text-xs text-red-600">{state.error}</p>}

      <ul className="divide-y divide-zinc-100">
        {clients.length === 0 && (
          <li className="px-5 py-3 text-sm text-zinc-400">Chưa có Client nào.</li>
        )}
        {clients.map((client) => <ClientRow key={client.id} client={client} />)}
      </ul>
    </section>
  );
}
