"use client";

import { useMemo, useState } from "react";
import UserRow, { type UserItem } from "@/components/UserRow";

type FilterKey = "ALL" | "ADMIN" | "ACCOUNT" | "USER" | "INACTIVE";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "Tất cả" },
  { key: "ADMIN", label: "Admin" },
  { key: "ACCOUNT", label: "Account" },
  { key: "USER", label: "User" },
  { key: "INACTIVE", label: "Vô hiệu hóa" },
];

export default function UserAccountManager({
  users,
  adminId,
  managers,
}: {
  users: UserItem[];
  adminId: string;
  managers: { id: string; name: string; email: string; avatarUrl: string | null }[];
}) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");

  const counts = useMemo(
    () => ({
      ALL: users.length,
      ADMIN: users.filter((user) => user.role === "ADMIN").length,
      ACCOUNT: users.filter((user) => user.role === "ACCOUNT").length,
      USER: users.filter((user) => user.role === "USER").length,
      INACTIVE: users.filter((user) => !user.isActive).length,
    }),
    [users]
  );

  const visibleUsers = useMemo(() => {
    if (activeFilter === "ALL") return users;
    if (activeFilter === "INACTIVE") {
      return users.filter((user) => !user.isActive);
    }
    return users.filter((user) => user.role === activeFilter);
  }, [activeFilter, users]);
  return (
    <section className="overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-sm">
      <div className="px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-zinc-950">
                Tài khoản
              </h2>
              <span className="text-sm font-medium text-zinc-400">{users.length}</span>
            </div>
          </div>
          <div
            className="tf-scroll-tabs flex items-center gap-0.5 rounded-[7px] bg-zinc-100/80 p-0.5"
            role="group"
            aria-label="Lọc danh sách tài khoản"
          >
            {FILTERS.map((filter) => {
              const selected = activeFilter === filter.key;
              return (
                <button
                  key={filter.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActiveFilter(filter.key)}
                  style={{ fontSize: "13px", lineHeight: "18px" }}
                  className={`flex min-h-8 shrink-0 items-center gap-1 rounded-[6px] px-2.5 font-medium transition-colors ${
                    selected
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-zinc-500 hover:bg-white/55 hover:text-zinc-800"
                  }`}
                >
                  {filter.label}
                  <span className={selected ? "text-brand-700" : "text-zinc-400"}>
                    {counts[filter.key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(220px,1.35fr)_96px_minmax(240px,1fr)_72px] gap-4 border-y border-zinc-100 bg-zinc-50/70 px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 lg:grid">
        <span>Tài khoản</span>
        <span>Vai trò</span>
        <span>Quản lý</span>
        <span className="text-right">Thao tác</span>
      </div>

      {visibleUsers.length > 0 ? (
        <ul className="divide-y divide-zinc-100/80">
          {visibleUsers.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === adminId}
              managers={managers}
            />
          ))}
        </ul>
      ) : (
        <div className="tf-empty">Không có tài khoản trong nhóm này.</div>
      )}
    </section>
  );
}
