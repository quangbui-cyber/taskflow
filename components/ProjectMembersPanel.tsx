"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, UserPlus, UsersRound, X } from "lucide-react";
import { addMembers, removeMember } from "@/app/actions/projects";
import type { MemberDTO } from "@/lib/types";
import Avatar from "@/components/Avatar";
import PeoplePicker from "@/components/PeoplePicker";

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

export default function ProjectMembersPanel({
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"add" | "current">("add");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [pending, startTransition] = useTransition();
  const isOwner = currentUserId === ownerId;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, pending]);

  function submitSelected() {
    setMessage("");
    startTransition(async () => {
      const result = await addMembers(projectId, selectedIds);
      setMessageIsError(Boolean(result.error));
      setMessage(result.error ?? result.success ?? "");
      if (result.success) {
        setSelectedIds([]);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTab("add");
          setMessage("");
          setOpen(true);
        }}
        className="flex min-h-9 items-center rounded-[7px] border border-zinc-200 bg-white px-2 py-1 transition-colors hover:border-brand-300 hover:bg-brand-50"
        aria-label="Thêm hoặc quản lý thành viên"
      >
        <span className="flex -space-x-2">
          {members.slice(0, 4).map((member) => (
            <Avatar
              key={member.userId}
              id={member.userId}
              name={member.user.name}
              avatarUrl={member.user.avatarUrl}
              className="h-7 w-7 border-2 border-white text-[10px]"
            />
          ))}
        </span>
        {members.length > 4 && (
          <span className="ml-1 text-xs text-zinc-500">+{members.length - 4}</span>
        )}
        <span className="ml-2 hidden items-center gap-1.5 border-l border-zinc-200 pl-2 text-xs font-medium text-zinc-600 sm:flex">
          <Plus size={14} aria-hidden="true" />
          Thêm người
        </span>
      </button>

      {open && (
        <div
          className="tf-overlay-enter fixed inset-0 z-50 bg-zinc-950/40"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-members-title"
            className="tf-modal-enter absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-2xl"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 sm:px-6">
              <div>
                <h2 id="project-members-title" className="text-lg font-semibold text-zinc-900">
                  Thành viên project
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Chọn nhiều người hoặc thêm nhanh theo nhóm.
                </p>
              </div>
              <button
                type="button"
                className="tf-icon-button shrink-0"
                onClick={() => setOpen(false)}
                disabled={pending}
                aria-label="Đóng"
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <div className="flex shrink-0 border-b border-zinc-200 px-5 sm:px-6" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "add"}
                onClick={() => setTab("add")}
                className={`min-h-12 border-b-2 px-1 text-sm font-medium ${
                  tab === "add"
                    ? "border-brand-500 text-zinc-900"
                    : "border-transparent text-zinc-500 hover:text-zinc-800"
                }`}
              >
                Thêm người ({availableUsers.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "current"}
                onClick={() => setTab("current")}
                className={`ml-6 min-h-12 border-b-2 px-1 text-sm font-medium ${
                  tab === "current"
                    ? "border-brand-500 text-zinc-900"
                    : "border-transparent text-zinc-500 hover:text-zinc-800"
                }`}
              >
                Đang trong project ({members.length})
              </button>
            </div>

            {tab === "add" ? (
              <>
                <PeoplePicker
                  people={availableUsers.map((user) => ({ ...user, meta: user.role }))}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={(ids) => {
                    setSelectedIds(ids);
                    setMessage("");
                  }}
                  groups={memberGroups.map((group) => ({
                    id: group.id,
                    name: group.name,
                    memberIds: group.members.map((member) => member.id),
                  }))}
                  emptyMessage="Mọi người đã ở trong project hoặc không có tài khoản phù hợp."
                />
                <footer className="shrink-0 border-t border-zinc-200 bg-white px-5 py-4 sm:px-6">
                  {message && (
                    <div
                      className={`mb-3 flex items-start gap-2 rounded-[8px] px-3 py-2 text-sm ${
                        messageIsError
                          ? "bg-red-50 text-red-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {!messageIsError && (
                        <CheckCircle2 size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                      )}
                      {message}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-500">
                      Đã chọn <strong className="text-zinc-800">{selectedIds.length}</strong> người
                    </span>
                    <button
                      type="button"
                      disabled={pending || selectedIds.length === 0}
                      onClick={submitSelected}
                      className="tf-button-primary"
                    >
                      <UserPlus size={16} aria-hidden="true" />
                      {pending ? "Đang thêm…" : `Thêm ${selectedIds.length || ""} thành viên`}
                    </button>
                  </div>
                </footer>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
                <ul className="space-y-1">
                  {members.map((member) => (
                    <li
                      key={member.userId}
                      className="flex min-h-[56px] items-center gap-3 rounded-[8px] px-3 py-2 hover:bg-zinc-50"
                    >
                      <Avatar
                        id={member.userId}
                        name={member.user.name}
                        avatarUrl={member.user.avatarUrl}
                        className="h-9 w-9 text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-800">
                          {member.user.name}
                          {member.userId === currentUserId && (
                            <span className="font-normal text-zinc-400"> (bạn)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-zinc-400">
                          {member.role === "owner" ? "Chủ project" : member.user.email}
                        </p>
                      </div>
                      {member.userId !== ownerId &&
                        (isOwner || member.userId === currentUserId) && (
                          <button
                            type="button"
                            onClick={() => removeMember(projectId, member.userId)}
                            className="flex min-h-9 items-center gap-1.5 rounded-[7px] px-2.5 text-xs font-medium text-zinc-500 hover:bg-red-50 hover:text-red-600"
                          >
                            <X size={14} aria-hidden="true" />
                            {member.userId === currentUserId ? "Rời project" : "Xóa"}
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
                {members.length === 0 && (
                  <div className="py-12 text-center text-sm text-zinc-400">
                    <UsersRound size={28} className="mx-auto mb-2" aria-hidden="true" />
                    Project chưa có thành viên.
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
