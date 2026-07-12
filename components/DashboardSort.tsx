"use client";

import { ArrowUpDown } from "lucide-react";
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
      <select
        id="dashboard-sort"
        value={value}
        onChange={(event) => {
          const next = new URLSearchParams(searchParams.toString());
          next.set("sort", event.target.value);
          router.replace(`/?${next.toString()}`);
        }}
        className="rounded-[7px] border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 outline-none hover:bg-zinc-50 focus:border-brand-500"
      >
        <option value="due">Theo hạn</option>
        <option value="project">Theo dự án</option>
      </select>
    </div>
  );
}
