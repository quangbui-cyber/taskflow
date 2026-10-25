"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Save, Trash2, UsersRound, X } from "lucide-react";
import {
  createMemberGroup,
  deleteMemberGroup,
  updateMemberGroup,
} from "@/app/actions/admin";
import Avatar from "@/components/Avatar";

type GroupUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
};
type GroupItem = { id: string; name: string; memberIds: string[] };

function MemberPicker({
  users,
  selectedIds,
  onChange,
}: {
  users: GroupUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredUsers = users.filter((user) =>
    `${user.name} ${user.email}`.toLowerCase().includes(normalizedQuery)
  );

  function toggle(userId: string) {
    const next = new Set(selected);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    onChange([...next]);
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-zinc-200">
      <div className="border-b border-zinc-100 p-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm theo tên hoặc email"
          className="tf-field !min-h-9 !py-1.5"
        />
      </div>
      <div className="grid max-h-52 grid-cols-1 overflow-y-auto p-2 sm:grid-cols-2">
        {filteredUsers.map((user) => (
          <label
            key={user.id}
            className="flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-2 hover:bg-zinc-50"
          >
            <input
              type="checkbox"
              checked={selected.has(user.id)}
              onChange={() => toggle(user.id)}
              className="h-4 w-4 accent-[#a8d431]"
            />
            <Avatar
              id={user.id}
              name={user.name}
              avatarUrl={user.avatarUrl}
              className="h-7 w-7 text-xs"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-zinc-700">
                {user.name}
              </span>
              <span className="block truncate text-xs text-zinc-400">{user.email}</span>
            </span>
          </label>
        ))}
        {filteredUsers.length === 0 && (
          <p className="p-2 text-sm text-zinc-400">Không có nhân sự phù hợp.</p>
        )}
      </div>
    </div>
  );
}

export default function MemberGroupManager({
  users,
  groups,
}: {
  users: GroupUser[];
  groups: GroupItem[];
}) {
  const [newName, setNewName] = useState("");
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMemberIds, setEditMemberIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [pending, startTransition] = useTransition();

  function showResult(result: { error?: string; success?: string }) {
    setIsError(Boolean(result.error));
    setMessage(result.error ?? result.success ?? "");
  }

  function createGroup(event: React.FormEvent) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("name", newName);
    newMemberIds.forEach((id) => formData.append("memberIds", id));
    startTransition(async () => {
      const result = await createMemberGroup({}, formData);
      showResult(result);
      if (result.success) {
        setNewName("");
        setNewMemberIds([]);
      }
    });
  }

  function beginEdit(group: GroupItem) {
    setEditingId(group.id);
    setEditName(group.name);
    setEditMemberIds(group.memberIds);
    setMessage("");
  }

  function saveGroup() {
    if (!editingId) return;
    startTransition(async () => {
      const result = await updateMemberGroup(editingId, editName, editMemberIds);
      showResult(result);
      if (result.success) setEditingId(null);
    });
  }

  function removeGroup(group: GroupItem) {
    if (!window.confirm(`Xoá nhóm "${group.name}"?`)) return;
    startTransition(async () => {
      showResult(await deleteMemberGroup(group.id));
      if (editingId === group.id) setEditingId(null);
    });
  }

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
            <UsersRound size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold">Phòng ban / Nhóm</h2>
          </div>
        </div>
      </div>

      <form onSubmit={createGroup} className="space-y-3 border-b border-zinc-100 p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Tên phòng ban / nhóm, ví dụ: Creative"
            className="tf-field min-w-0 flex-1"
          />
          <button
            type="submit"
            disabled={pending || !newName.trim() || newMemberIds.length === 0}
            className="tf-button-primary"
          >
            <Plus size={16} aria-hidden="true" />
            Lưu
          </button>
        </div>
        <MemberPicker users={users} selectedIds={newMemberIds} onChange={setNewMemberIds} />
        <p className="text-xs text-zinc-400">Đã chọn {newMemberIds.length} người</p>
      </form>

      <ul className="divide-y divide-zinc-100">
        {groups.length === 0 && (
          <li className="px-5 py-4 text-sm text-zinc-400">Chưa có phòng ban hoặc nhóm.</li>
        )}
        {groups.map((group) => {
          const memberUsers = group.memberIds
            .map((id) => users.find((user) => user.id === id))
            .filter((user): user is GroupUser => Boolean(user));
          const editing = editingId === group.id;
          return (
            <li key={group.id} className="p-5">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-zinc-900">{group.name}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">
                    {memberUsers.map((user) => user.name).join(", ")}
                  </p>
                </div>
                <span className="text-xs text-zinc-400">{memberUsers.length} người</span>
                <button
                  type="button"
                  onClick={() => (editing ? setEditingId(null) : beginEdit(group))}
                  className="tf-button-secondary !min-h-8 !px-2.5 !py-1 text-xs"
                >
                  {editing ? <X size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
                  {editing ? "Đóng" : "Sửa"}
                </button>
                <button
                  type="button"
                  onClick={() => removeGroup(group)}
                  disabled={pending}
                  className="tf-icon-button !h-8 !min-h-8 !w-8 text-red-500"
                  title="Xoá nhóm"
                  aria-label={`Xoá nhóm ${group.name}`}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>

              {editing && (
                <div className="mt-4 space-y-3 rounded-[8px] bg-zinc-50 p-4">
                  <input
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="tf-field"
                    aria-label="Tên nhóm"
                  />
                  <MemberPicker
                    users={users}
                    selectedIds={editMemberIds}
                    onChange={setEditMemberIds}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={saveGroup}
                      disabled={pending || !editName.trim() || editMemberIds.length === 0}
                      className="tf-button-primary"
                    >
                      <Save size={15} aria-hidden="true" />
                      Lưu
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {message && (
        <p className={`border-t border-zinc-100 px-5 py-3 text-sm ${isError ? "text-red-600" : "text-brand-800"}`}>
          {message}
        </p>
      )}
    </section>
  );
}
