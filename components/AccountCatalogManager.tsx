"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  createAccount,
  deleteAccount,
  setAccountTeam,
  type CatalogState,
} from "@/app/actions/catalog";

type TeamOption = { id: string; name: string };
type AccountItem = {
  id: string;
  name: string;
  projectCount: number;
  teamId: string | null;
};

export default function AccountCatalogManager({
  accounts,
  teams,
}: {
  accounts: AccountItem[];
  teams: TeamOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<CatalogState, FormData>(
    createAccount,
    {}
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, startTransition] = useTransition();

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-0.5 text-xs text-zinc-400">
          Đầu mối phụ trách và Team kinh doanh tương ứng.
        </p>
      </div>

      <form ref={formRef} action={formAction} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
        <input
          name="name"
          type="text"
          required
          placeholder="Tên account"
          className="tf-field"
        />
        <select name="teamId" defaultValue="" className="tf-field">
          <option value="">Chưa chọn Team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending} className="tf-button-primary">
          <Plus size={16} aria-hidden="true" />
          Thêm
        </button>
      </form>

      {state.error && (
        <p className="px-4 -mt-2 pb-2 text-xs text-red-600">{state.error}</p>
      )}
      {updateError && (
        <p className="px-4 pb-2 text-xs text-red-600">{updateError}</p>
      )}

      <ul className="divide-y divide-zinc-50">
        {accounts.length === 0 && (
          <li className="px-5 py-3 text-sm text-zinc-400">Chưa có Account.</li>
        )}
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
            <span className="min-w-[140px] flex-1 truncate font-medium">
              {account.name}
            </span>
            <select
              value={account.teamId ?? ""}
              disabled={updating}
              onChange={(event) => {
                const teamId = event.target.value || null;
                setUpdateError(null);
                startTransition(async () => {
                  const result = await setAccountTeam(account.id, teamId);
                  if (result.error) setUpdateError(result.error);
                });
              }}
              className="rounded-[7px] border border-zinc-200 px-2 py-1.5 text-xs text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
              aria-label={`Team của ${account.name}`}
            >
              <option value="">Chưa chọn Team</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <span className="shrink-0 text-xs text-zinc-400">
              {account.projectCount} project
            </span>
            <button
              onClick={() => {
                if (
                  confirm(
                    `Xoá "${account.name}"? Các project đang gắn sẽ bỏ trống Account.`
                  )
                ) {
                  deleteAccount(account.id);
                }
              }}
              className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 !border-transparent hover:!border-red-100 hover:!bg-red-50 hover:!text-red-500"
              title="Xoá"
              aria-label={`Xoá ${account.name}`}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
