"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { ChevronDown, Link2, Plus, Save, Trash2 } from "lucide-react";
import {
  createAccount,
  deleteAccount,
  linkLegacyAccount,
  setAccountTeam,
  type CatalogState,
} from "@/app/actions/catalog";
import Avatar from "@/components/Avatar";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import {
  useActionFeedback,
  useInteraction,
} from "@/components/InteractionProvider";

type TeamOption = { id: string; name: string };
type AccountUserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
};
type AccountItem = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  projectCount: number;
  teamId: string | null;
  linked: boolean;
};

function accountUserOptions(users: AccountUserOption[]): UserPickerOption[] {
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    meta: user.role === "ADMIN" ? "Admin" : "Account",
  }));
}

function LegacyAccountRow({
  account,
  users,
  teams,
}: {
  account: AccountItem;
  users: AccountUserOption[];
  teams: TeamOption[];
}) {
  const { notify } = useInteraction();
  const [userId, setUserId] = useState("");
  const [teamId, setTeamId] = useState(account.teamId ?? "");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const pickerOptions = accountUserOptions(users);

  function linkAccount() {
    startTransition(async () => {
      const result = await linkLegacyAccount(account.id, userId, teamId);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
      notify({
        message: result.error ?? result.success ?? "Đã liên kết Account.",
        tone: result.error ? "error" : "success",
      });
    });
  }

  function removeAccount() {
    if (!window.confirm(`Xoá "${account.name}" khỏi danh sách Account?`)) return;
    startTransition(async () => {
      const result = await deleteAccount(account.id);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
      notify({
        message: result.error ?? result.success ?? "Đã xoá Account.",
        tone: result.error ? "error" : "success",
      });
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
        <UserPicker
          value={userId}
          onChange={setUserId}
          options={pickerOptions}
          placeholder="Chọn user Account"
          emptyLabel="Chọn user Account"
          ariaLabel={`Tài khoản thay thế cho ${account.name}`}
        />
        <div className="relative min-w-0">
          <select
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            className="tf-field appearance-none !pr-10"
            aria-label={`Team của ${account.name}`}
          >
            <option value="">Chọn Team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          onClick={linkAccount}
          disabled={pending || !userId || !teamId}
          className="tf-button-primary"
        >
          <Link2 size={16} aria-hidden="true" />
          Lưu
        </button>
      </div>
      {message && isError && (
        <p className="text-xs text-red-600">
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
  const { notify } = useInteraction();
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
      notify({
        message: result.error ?? "Đã lưu Team của Account.",
        tone: result.error ? "error" : "success",
      });
    });
  }

  function removeAccount() {
    if (!window.confirm(`Xoá "${account.name}" khỏi danh sách Account?`)) return;
    startTransition(async () => {
      const result = await deleteAccount(account.id);
      setIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
      notify({
        message: result.error ?? result.success ?? "Đã xoá Account.",
        tone: result.error ? "error" : "success",
      });
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <span className="flex min-w-[180px] flex-1 items-center gap-2">
        <Avatar
          id={account.id}
          name={account.name}
          avatarUrl={account.avatarUrl}
          className="h-8 w-8 text-xs"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{account.name}</span>
          <span className="block truncate text-xs text-zinc-400">{account.email}</span>
          {message && isError && (
            <span className="mt-1 block text-xs text-red-600">
              {message}
            </span>
          )}
        </span>
      </span>
      <div className="relative min-w-[180px]">
        <select
          value={teamId}
          disabled={pending}
          onChange={(event) => {
            setTeamId(event.target.value);
            setMessage("");
          }}
          className="w-full appearance-none rounded-[7px] border border-zinc-200 py-1.5 pl-3 pr-9 text-xs text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-400/30 disabled:opacity-50"
          aria-label={`Team của ${account.name}`}
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
      </div>
      <button
        type="button"
        onClick={saveTeam}
        disabled={pending || !changed || !teamId}
        className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
      >
        <Save size={14} aria-hidden="true" />
        Lưu
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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [state, formAction, pending] = useActionState<CatalogState, FormData>(
    async (prev, formData) => {
      const result = await createAccount(prev, formData);
      if (!result.error) {
        formRef.current?.reset();
        setSelectedUserId("");
      }
      return result;
    },
    {}
  );
  useActionFeedback(state);
  const linkedAccounts = accounts.filter((account) => account.linked);
  const legacyAccounts = accounts.filter((account) => !account.linked);
  const pickerOptions = accountUserOptions(accountUsers);

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
        <UserPicker
          name="userId"
          value={selectedUserId}
          onChange={setSelectedUserId}
          options={pickerOptions}
          placeholder="Chọn tài khoản Account"
          emptyLabel="Chọn tài khoản Account"
          ariaLabel="Chọn tài khoản Account"
        />
        <div className="relative min-w-0">
          <select
            name="teamId"
            defaultValue=""
            required
            className="tf-field appearance-none !pr-10"
          >
            <option value="">Chọn Team bắt buộc</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={15}
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
        </div>
        <button
          type="submit"
          disabled={pending || !selectedUserId || accountUsers.length === 0 || teams.length === 0}
          className="tf-button-primary"
          aria-busy={pending}
        >
          {pending ? (
            <span className="tf-spinner" aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {pending ? "Đang lưu..." : "Lưu"}
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
