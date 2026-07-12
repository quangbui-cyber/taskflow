"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Link2, Plus, Save, Trash2 } from "lucide-react";
import {
  createAccount,
  deleteAccount,
  linkLegacyAccount,
  setAccountTeam,
  type CatalogState,
} from "@/app/actions/catalog";

type TeamOption = { id: string; name: string };
type AccountUserOption = { id: string; name: string; email: string; role: string };
type AccountItem = {
  id: string;
  name: string;
  email: string | null;
  projectCount: number;
  teamId: string | null;
  linked: boolean;
};

function LegacyAccountRow({
  account,
  users,
  teams,
}: {
  account: AccountItem;
  users: AccountUserOption[];
  teams: TeamOption[];
}) {
  const [userId, setUserId] = useState("");
  const [teamId, setTeamId] = useState(account.teamId ?? "");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  function linkAccount() {
    startTransition(async () => {
      const result = await linkLegacyAccount(account.id, userId, teamId);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
    });
  }

  function removeAccount() {
    if (!window.confirm(`Xoá "${account.name}" khỏi danh sách Account?`)) return;
    startTransition(async () => {
      const result = await deleteAccount(account.id);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
    });
  }

  return (
    <li className="space-y-3 bg-amber-50/60 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-800">{account.name}</p>
          <p className="text-xs text-amber-700">
            Dữ liệu cũ · đang gắn {account.projectCount} project · cần liên kết user Account
          </p>
        </div>
        <button
          type="button"
          onClick={removeAccount}
          disabled={pending}
          className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 text-red-500"
          title="Xoá Account cũ"
          aria-label={`Xoá ${account.name}`}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <select
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          className="tf-field"
          aria-label={`Tài khoản thay thế cho ${account.name}`}
        >
          <option value="">Chọn user Account</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · {user.email} · {user.role === "ADMIN" ? "Admin" : "Account"}
            </option>
          ))}
        </select>
        <select
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
          className="tf-field"
          aria-label={`Team của ${account.name}`}
        >
          <option value="">Chọn Team</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={linkAccount}
          disabled={pending || !userId || !teamId}
          className="tf-button-primary"
        >
          <Link2 size={16} aria-hidden="true" />
          Lưu thay đổi
        </button>
      </div>
      {message && (
        <p className={`text-xs ${isError ? "text-red-600" : "text-brand-800"}`}>
          {message}
        </p>
      )}
    </li>
  );
}

function LinkedAccountRow({
  account,
  teams,
}: {
  account: AccountItem;
  teams: TeamOption[];
}) {
  const [teamId, setTeamId] = useState(account.teamId ?? "");
  const [savedTeamId, setSavedTeamId] = useState(account.teamId ?? "");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = teamId !== savedTeamId;

  function saveTeam() {
    startTransition(async () => {
      const result = await setAccountTeam(account.id, teamId);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? "Đã lưu thay đổi.");
      if (!result.error) setSavedTeamId(teamId);
    });
  }

  function removeAccount() {
    if (!window.confirm(`Xoá "${account.name}" khỏi danh sách Account?`)) return;
    startTransition(async () => {
      const result = await deleteAccount(account.id);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <span className="min-w-[180px] flex-1">
        <span className="block truncate font-medium">{account.name}</span>
        <span className="block truncate text-xs text-zinc-400">{account.email}</span>
        {message && (
          <span className={`mt-1 block text-xs ${isError ? "text-red-600" : "text-brand-800"}`}>
            {message}
          </span>
        )}
      </span>
      <select
        value={teamId}
        disabled={pending}
        onChange={(event) => {
          setTeamId(event.target.value);
          setMessage("");
        }}
        className="rounded-[7px] border border-zinc-200 px-2 py-1.5 text-xs text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-400/30"
        aria-label={`Team của ${account.name}`}
      >
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={saveTeam}
        disabled={pending || !changed || !teamId}
        className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
      >
        <Save size={14} aria-hidden="true" />
        Lưu thay đổi
      </button>
      <span className="shrink-0 text-xs text-zinc-400">
        {account.projectCount} project
      </span>
      <button
        type="button"
        onClick={removeAccount}
        disabled={pending}
        className="tf-icon-button !h-8 !min-h-8 !w-8 shrink-0 text-red-500"
        title="Xoá Account"
        aria-label={`Xoá ${account.name}`}
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

export default function AccountCatalogManager({
  accounts,
  accountUsers,
  teams,
}: {
  accounts: AccountItem[];
  accountUsers: AccountUserOption[];
  teams: TeamOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<CatalogState, FormData>(
    createAccount,
    {}
  );
  const linkedAccounts = accounts.filter((account) => account.linked);
  const legacyAccounts = accounts.filter((account) => !account.linked);

  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);

  return (
    <div className="tf-panel overflow-hidden xl:col-span-2">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">Account</h2>
        <p className="mt-0.5 text-xs text-zinc-400">
          Chọn người dùng Admin hoặc Account và bắt buộc gán vào một Team.
        </p>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <select name="userId" defaultValue="" required className="tf-field">
          <option value="">Chọn tài khoản Account</option>
          {accountUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · {user.email} · {user.role === "ADMIN" ? "Admin" : "Account"}
            </option>
          ))}
        </select>
        <select name="teamId" defaultValue="" required className="tf-field">
          <option value="">Chọn Team bắt buộc</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending || accountUsers.length === 0 || teams.length === 0}
          className="tf-button-primary"
        >
          <Plus size={16} aria-hidden="true" />
          Lưu thay đổi
        </button>
      </form>

      {accountUsers.length === 0 && (
        <p className="px-4 pb-3 text-xs text-zinc-400">
          Tất cả người dùng Admin hoặc Account đã được thêm vào danh sách Account.
        </p>
      )}
      {teams.length === 0 && (
        <p className="px-4 pb-3 text-xs text-amber-700">
          Hãy tạo Team trước khi thêm Account.
        </p>
      )}
      {state.error && <p className="px-4 pb-3 text-xs text-red-600">{state.error}</p>}
      {state.success && (
        <p className="px-4 pb-3 text-xs text-brand-800">{state.success}</p>
      )}

      <ul className="divide-y divide-zinc-100">
        {linkedAccounts.length === 0 && legacyAccounts.length === 0 && (
          <li className="px-5 py-3 text-sm text-zinc-400">Chưa có Account.</li>
        )}
        {linkedAccounts.map((account) => (
          <LinkedAccountRow key={account.id} account={account} teams={teams} />
        ))}
        {legacyAccounts.map((account) => (
          <LegacyAccountRow
            key={account.id}
            account={account}
            users={accountUsers}
            teams={teams}
          />
        ))}
      </ul>
    </div>
  );
}
