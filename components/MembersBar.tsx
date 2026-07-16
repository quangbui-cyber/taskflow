"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Plus, UserPlus, UsersRound, X } from "lucide-react";
import {
  addMember,
  addMemberGroup,
  removeMember,
  type ActionState,
} from "@/app/actions/projects";
import type { MemberDTO } from "@/lib/types";
import Avatar from "@/components/Avatar";

type AvailableUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
};

type MemberGroupOption = {
  id: string;
  name: string;
  members: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  }[];
};

export default function MembersBar({
  projectId,
  members,
  availableUsers,
  memberGroups,
  ownerId,
  currentUserId,
}: {
  projectId: string;
  members: MemberDTO[];
  availableUsers: AvailableUser[];
  memberGroups: MemberGroupOption[];
  ownerId: string;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [selectedInviteeId, setSelectedInviteeId] = useState("");
  const [inviteFocused, setInviteFocused] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupMessage, setGroupMessage] = useState("");
  const [groupError, setGroupError] = useState(false);
  const [groupPending, startGroupTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await addMember(prev, formData);
      if (!result.error) {
        // Mời thành công → xoá ô nhập để gõ tên người tiếp theo
        setInviteQuery("");
        setSelectedInviteeId("");
      }
      return result;
    },
    {}
  );

  const isOwner = currentUserId === ownerId;
  const normalizedInviteQuery = inviteQuery.trim().toLowerCase();
  const suggestedUsers = availableUsers
    .filter((u) => {
      if (!normalizedInviteQuery) return true;
      return `${u.name} ${u.email}`.toLowerCase().includes(normalizedInviteQuery);
    })
    .slice(0, 8);
  const showSuggestions = inviteFocused && availableUsers.length > 0;

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setInviteFocused(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      setInviteFocused(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectInvitee(user: AvailableUser) {
    setInviteQuery(`${user.name} <${user.email}>`);
    setSelectedInviteeId(user.id);
    setInviteFocused(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-[7px] px-1 py-1 transition-colors hover:bg-zinc-100"
        title="Thành viên"
      >
        <span className="flex -space-x-2">
          {members.slice(0, 4).map((m) => (
            <Avatar
              key={m.userId}
              id={m.userId}
              name={m.user.name}
              avatarUrl={m.user.avatarUrl}
              className="h-8 w-8 border-2 border-white text-xs"
            />
          ))}
        </span>
        {members.length > 4 && (
          <span className="ml-1 text-xs text-zinc-500">
            +{members.length - 4}
          </span>
        )}
        <span className="ml-2 flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-400 hover:border-brand-400 hover:text-brand-700">
          <Plus size={16} aria-hidden="true" />
        </span>
      </button>

      {open && (
        <div className="tf-popover-enter absolute right-0 top-11 z-30 w-[min(340px,90vw)] space-y-3 rounded-[8px] border border-zinc-200 bg-white p-4 shadow-xl">
          <h3 className="font-semibold text-sm">
            Thành viên ({members.length})
          </h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center gap-2 py-1 text-sm"
              >
                <Avatar
                  id={m.userId}
                  name={m.user.name}
                  avatarUrl={m.user.avatarUrl}
                  className="h-7 w-7 text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {m.user.name}
                    {m.userId === currentUserId && (
                      <span className="text-zinc-400 font-normal"> (bạn)</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">
                    {m.role === "owner" ? "Chủ project" : m.user.email}
                  </p>
                </div>
                {m.userId !== ownerId &&
                  (isOwner || m.userId === currentUserId) && (
                    <button
                      onClick={() => removeMember(projectId, m.userId)}
                      className="flex h-8 w-8 items-center justify-center rounded-[6px] text-zinc-300 hover:bg-red-50 hover:text-red-500"
                      title={
                        m.userId === currentUserId ? "Rời project" : "Xoá khỏi project"
                      }
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  )}
              </li>
            ))}
          </ul>

          <form action={formAction} className="space-y-2 pt-2 border-t border-zinc-100">
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="inviteeId" value={selectedInviteeId} />
            <div className="flex gap-2 items-start">
              <div className="relative flex-1">
                <input
                  name="email"
                  type="text"
                  required
                  autoComplete="off"
                  value={inviteQuery}
                  onFocus={() => setInviteFocused(true)}
                  onBlur={() => setTimeout(() => setInviteFocused(false), 120)}
                  onChange={(e) => {
                    setInviteQuery(e.target.value);
                    setSelectedInviteeId("");
                    setInviteFocused(true);
                  }}
                  placeholder="Tên hoặc email thành viên"
                  className="tf-field !min-h-9 !py-1.5"
                />
                {showSuggestions && (
                  <div className="absolute left-0 right-0 top-10 z-40 max-h-56 overflow-y-auto rounded-[8px] border border-zinc-200 bg-white shadow-lg">
                    {suggestedUsers.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-zinc-400">
                        Không có thành viên phù hợp.
                      </p>
                    ) : (
                      <ul className="py-1">
                        {suggestedUsers.map((u) => (
                          <li key={u.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                selectInvitee(u);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-50"
                            >
                              <Avatar
                                id={u.id}
                                name={u.name}
                                avatarUrl={u.avatarUrl}
                                className="h-7 w-7 text-xs"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-zinc-700">
                                  {u.name}
                                </span>
                                <span className="block truncate text-xs text-zinc-400">
                                  {u.email}
                                </span>
                              </span>
                              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                                {u.role}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={pending || !inviteQuery.trim()}
                className="tf-button-primary !min-h-9 !px-3 !py-1.5"
              >
                <UserPlus size={15} aria-hidden="true" />
                Mời
              </button>
            </div>
            {state.error && (
              <p className="text-xs text-red-600">{state.error}</p>
            )}
          </form>

          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <UsersRound size={14} aria-hidden="true" />
              Thêm nhóm cố định
            </div>
            {memberGroups.length > 0 ? (
              <div className="flex gap-2">
                <select
                  value={selectedGroupId}
                  onChange={(event) => {
                    setSelectedGroupId(event.target.value);
                    setGroupMessage("");
                  }}
                  className="tf-field !min-h-9 !py-1.5"
                  aria-label="Chọn nhóm cố định"
                >
                  <option value="">Chọn nhóm</option>
                  {memberGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} · thêm {group.members.length} người
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={groupPending || !selectedGroupId}
                  onClick={() => {
                    startGroupTransition(async () => {
                      const result = await addMemberGroup(projectId, selectedGroupId);
                      setGroupError(Boolean(result.error));
                      setGroupMessage(result.error ?? result.success ?? "");
                      if (result.success) setSelectedGroupId("");
                    });
                  }}
                  className="tf-button-secondary !min-h-9 shrink-0 !px-3 !py-1.5"
                >
                  <UsersRound size={15} aria-hidden="true" />
                  Thêm nhóm
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                Chưa có nhóm phù hợp hoặc mọi người trong nhóm đã ở project.
              </p>
            )}
            {groupMessage && (
              <p className={`text-xs ${groupError ? "text-red-600" : "text-brand-800"}`}>
                {groupMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
