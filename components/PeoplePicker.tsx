"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, UsersRound, X } from "lucide-react";
import Avatar from "@/components/Avatar";

export type PeoplePickerPerson = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  meta?: string | null;
};

export type PeoplePickerGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

export type PeoplePickerAvailability = {
  status: "free" | "busy";
  label?: string;
};

export default function PeoplePicker({
  people,
  selectedIds,
  onSelectedIdsChange,
  groups = [],
  availability = {},
  showAvailabilityFilter = false,
  showSelectedSummary = true,
  compactGroups = false,
  emptyMessage = "Không có nhân sự phù hợp.",
  selectedLabel = "Đã chọn",
}: {
  people: PeoplePickerPerson[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  groups?: PeoplePickerGroup[];
  availability?: Record<string, PeoplePickerAvailability>;
  showAvailabilityFilter?: boolean;
  showSelectedSummary?: boolean;
  compactGroups?: boolean;
  emptyMessage?: string;
  selectedLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "selected" | "free">("all");
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("vi");
  const filteredPeople = people.filter((person) => {
    if (
      normalizedQuery &&
      !`${person.name} ${person.email}`
        .toLocaleLowerCase("vi")
        .includes(normalizedQuery)
    ) {
      return false;
    }
    if (filter === "selected") return selected.has(person.id);
    if (filter === "free") return availability[person.id]?.status !== "busy";
    return true;
  });

  function togglePerson(personId: string) {
    const next = new Set(selected);
    if (next.has(personId)) next.delete(personId);
    else next.add(personId);
    onSelectedIdsChange([...next]);
  }

  function groupMemberIds(group: PeoplePickerGroup) {
    return group.memberIds.filter((id) => peopleById.has(id));
  }

  function selectedGroupCount(group: PeoplePickerGroup) {
    return groupMemberIds(group).filter((id) => selected.has(id)).length;
  }

  function toggleGroup(group: PeoplePickerGroup) {
    const ids = groupMemberIds(group);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    const next = new Set(selected);
    ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
    onSelectedIdsChange([...next]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showSelectedSummary && selectedIds.length > 0 && (
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-zinc-600">
              {selectedLabel} {selectedIds.length} người
            </span>
            <button
              type="button"
              onClick={() => onSelectedIdsChange([])}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {selectedIds.map((id) => {
              const person = peopleById.get(id);
              if (!person) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => togglePerson(id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-1 pr-2 text-xs font-medium text-zinc-700 hover:border-brand-400"
                  title={`Bỏ chọn ${person.name}`}
                >
                  <Avatar
                    id={person.id}
                    name={person.name}
                    avatarUrl={person.avatarUrl}
                    className="h-6 w-6 text-[10px]"
                  />
                  <span className="max-w-32 truncate">{person.name}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-3 border-b border-zinc-100 p-4">
        <label className="relative block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm theo tên hoặc email"
            className="tf-field !min-h-10 !pl-9 !py-1.5"
            aria-label="Tìm người"
          />
        </label>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["all", "Tất cả"],
              ["selected", `Đã chọn (${selectedIds.length})`],
              ...(showAvailabilityFilter ? [["free", "Chỉ người rảnh"]] : []),
            ] as ["all" | "selected" | "free", string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`min-h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
                filter === value
                  ? "border-brand-400 bg-brand-100 text-brand-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-300 hover:bg-brand-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {groups.length > 0 &&
          (compactGroups ? (
            <details className="group relative w-fit">
              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-[7px] border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 hover:border-brand-300 hover:bg-brand-50 [&::-webkit-details-marker]:hidden">
                <UsersRound size={13} aria-hidden="true" />
                Chọn theo nhóm
                <ChevronDown
                  size={13}
                  className="transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="absolute left-0 top-10 z-30 w-72 rounded-[8px] border border-zinc-200 bg-white p-2 shadow-xl">
                <p className="px-2 pb-1.5 text-xs font-medium text-zinc-500">
                  Bấm để chọn hoặc bỏ cả nhóm
                </p>
                <div className="space-y-1">
                  {groups.map((group) => {
                    const memberIds = groupMemberIds(group);
                    const selectedCount = selectedGroupCount(group);
                    const active = memberIds.length > 0 && selectedCount === memberIds.length;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => toggleGroup(group)}
                        disabled={memberIds.length === 0}
                        aria-pressed={active}
                        className={`flex min-h-9 w-full items-center justify-between rounded-[7px] px-2.5 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? "bg-brand-100 text-brand-900"
                            : "text-zinc-700 hover:bg-brand-50"
                        }`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="flex h-4 w-4 items-center justify-center rounded border border-zinc-300 bg-white">
                            {active && <Check size={11} aria-hidden="true" />}
                          </span>
                          {group.name}
                        </span>
                        <span className="font-normal text-zinc-400">
                          {selectedCount}/{memberIds.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>
          ) : (
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <UsersRound size={13} aria-hidden="true" />
              Chọn nhanh theo nhóm
            </div>
            <div className="flex flex-wrap gap-1.5">
              {groups.map((group) => {
                const memberIds = groupMemberIds(group);
                const selectedCount = selectedGroupCount(group);
                const active = memberIds.length > 0 && selectedCount === memberIds.length;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroup(group)}
                    disabled={memberIds.length === 0}
                    aria-pressed={active}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? "border-brand-400 bg-brand-100 text-brand-900"
                        : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-300 hover:bg-brand-50"
                    }`}
                  >
                    {active && <Check size={12} aria-hidden="true" />}
                    {group.name}
                    <span className="font-normal text-zinc-400">
                      {selectedCount}/{memberIds.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {filteredPeople.map((person) => {
            const checked = selected.has(person.id);
            const personAvailability = availability[person.id];
            return (
              <label
                key={person.id}
                className={`flex min-h-[54px] cursor-pointer items-center gap-3 rounded-[8px] border px-3 py-2 transition-colors ${
                  checked
                    ? "border-brand-300 bg-brand-50"
                    : "border-transparent hover:border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePerson(person.id)}
                  className="h-4 w-4 shrink-0 accent-[#a8d431]"
                />
                <Avatar
                  id={person.id}
                  name={person.name}
                  avatarUrl={person.avatarUrl}
                  className="h-8 w-8 shrink-0 text-xs"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800">
                    {person.name}
                  </span>
                  <span className="block truncate text-xs text-zinc-400">
                    {person.meta || person.email}
                  </span>
                </span>
                {personAvailability && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                      personAvailability.status === "busy"
                        ? "bg-red-50 text-red-700"
                        : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {personAvailability.status === "busy"
                      ? personAvailability.label || "Bận giờ này"
                      : "Rảnh"}
                  </span>
                )}
              </label>
            );
          })}
          {filteredPeople.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">
              {filter === "selected" && selectedIds.length === 0
                ? "Chưa chọn ai."
                : emptyMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
