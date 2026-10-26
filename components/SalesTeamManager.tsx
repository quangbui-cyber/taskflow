"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  createSalesTeam,
  deleteSalesTeam,
  renameSalesTeam,
  setSalesTeamLeader,
  type CatalogState,
} from "@/app/actions/catalog";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";

export type SalesTeamItem = {
  id: string;
  name: string;
  leaderId: string | null;
  accounts: Array<{ id: string; name: string }>;
};

function TeamRow({ team }: { team: SalesTeamItem }) {
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);
  const [error, setError] = useState("");

  function run(action: () => Promise<CatalogState>, done?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? "");
      notify({
        message: result.error ?? result.success ?? "Đã lưu.",
        tone: result.error ? "error" : "success",
      });
      if (!result.error) done?.();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
      {editing ? (
        <form
          className="flex min-w-[180px] flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => renameSalesTeam(team.id, name),
              () => setEditing(false)
            );
          }}
        >
          <input
            autoFocus
            required
            value={name}
            aria-label={`Tên mới của ${team.name}`}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setName(team.name);
                setEditing(false);
              }
            }}
            className="tf-field !min-h-9 min-w-0 flex-1 !py-1.5"
          />
          <button
            type="submit"
            disabled={pending}
            className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 text-emerald-600"
            title="Lưu tên"
            aria-label="Lưu tên team"
          >
            <Check size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => {
              setName(team.name);
              setEditing(false);
            }}
            className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0"
            title="Huỷ"
            aria-label="Huỷ đổi tên team"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </form>
      ) : (
        <span className="min-w-[180px] flex-1">
          <span className="block truncate font-medium">{team.name}</span>
          {error && (
            <span className="mt-0.5 block text-xs text-red-600">{error}</span>
          )}
        </span>
      )}

      <label className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Manager</span>
        <span className="relative block w-52">
          <select
            value={team.leaderId ?? ""}
            disabled={pending || team.accounts.length === 0}
            aria-label={`Manager của ${team.name}`}
            onChange={(event) => {
              const accountId = event.target.value;
              run(() => setSalesTeamLeader(team.id, accountId));
            }}
            className="w-full appearance-none truncate rounded-[7px] border border-zinc-200 py-1.5 pl-3 pr-9 text-xs text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-50"
          >
            <option value="">
              {team.accounts.length === 0 ? "Chưa có Account" : "Chưa chọn"}
            </option>
            {team.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
        </span>
      </label>

      <span className="w-20 shrink-0 text-right text-xs text-zinc-400">
        {team.accounts.length} Account
      </span>
      {/* Khi đang đổi tên vẫn giữ chỗ của nút bút chì để các cột không xê dịch. */}
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={editing}
        className={`tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 ${
          editing ? "invisible" : ""
        }`}
        title="Đổi tên team"
        aria-label={`Đổi tên ${team.name}`}
      >
        <Pencil size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Xoá team "${team.name}"?`)) {
            run(() => deleteSalesTeam(team.id));
          }
        }}
        className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 text-red-500"
        title="Xoá team"
        aria-label={`Xoá ${team.name}`}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Quản lý team kinh doanh: tạo, đổi tên, chỉ định Manager, xoá. */
export default function SalesTeamManager({ teams }: { teams: SalesTeamItem[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<CatalogState, FormData>(
    createSalesTeam,
    {}
  );
  useActionFeedback(state);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Team kinh doanh</h2>
      </div>

      <form ref={formRef} action={formAction} className="flex gap-2 p-4">
        <input
          name="name"
          type="text"
          required
          placeholder="Tên team, ví dụ: Team Sales 1"
          className="tf-field flex-1"
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
      {state.error && (
        <p className="-mt-2 px-4 pb-2 text-xs text-red-600">{state.error}</p>
      )}

      <ul className="divide-y divide-zinc-50">
        {teams.length === 0 && (
          <li className="px-5 py-3 text-sm text-zinc-400">Chưa có team nào.</li>
        )}
        {teams.map((team) => (
          <TeamRow key={team.id} team={team} />
        ))}
      </ul>
    </div>
  );
}
