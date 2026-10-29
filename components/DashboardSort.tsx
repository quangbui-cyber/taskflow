"use client";

import { ArrowUpDown, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

export default function DashboardSort({ value }: { value: "due" | "project" }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <div className="flex items-center gap-2">
      <ArrowUpDown size={16} className="text-zinc-400" aria-hidden="true" />
      <label htmlFor="dashboard-sort" className="sr-only">
        Sắp xếp công việc
      </label>
      <div className="relative">
        <select
          id="dashboard-sort"
          value={value}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams.toString());
            next.set("sort", event.target.value);
            router.replace(`/tasks?${next.toString()}`);
          }}
          className="appearance-none rounded-[7px] border border-zinc-200 bg-white py-2 pl-3 pr-10 text-sm text-zinc-600 outline-none hover:bg-zinc-50 focus:border-brand-500"
        >
          <option value="due">Theo hạn</option>
          <option value="project">Theo dự án</option>
        </select>
        <ChevronDown
          size={15}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
