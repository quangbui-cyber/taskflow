"use client";

import Link from "next/link";
import { saveCrmViewPreferenceAction } from "@/app/actions/crmClients";
import type { CrmViewPage } from "@/lib/crm/viewPreference";

/** crm51: view pills; the URL keeps filters and the choice is remembered per user in a cookie. */
export default function CrmViewSwitch({ page, label, current, options }: {
  page: CrmViewPage; label: string; current: string; options: { key: string; label: string; href: string }[];
}) {
  return <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-full border border-zinc-200 bg-white p-0.5 [scrollbar-width:none]">
    {options.map(option => {
      const selected = option.key === current;
      return <Link key={option.key} href={option.href} prefetch={false} scroll={false} aria-current={selected ? "page" : undefined}
        onClick={() => { if (!selected) void saveCrmViewPreferenceAction(page, option.key).catch(() => undefined); }}
        className={`inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm transition-colors duration-150 ${selected ? "bg-zinc-900 font-medium text-white" : "text-zinc-600 hover:text-zinc-900"}`}>{option.label}</Link>;
    })}
  </div>;
}
