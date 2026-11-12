import Link from "next/link";
import type { ReactNode } from "react";
import { crmTabHref, type CrmQuery } from "@/lib/crm/tabs";

/** URL tabs (`?tab=`) shared by the client profile and Opportunity pages; other query params are kept. */
export default function CrmTabs({ label, idPrefix, tabs, current, base, query, fallback, children }: {
  label: string; idPrefix: string; tabs: { key: string; label: string }[]; current: string;
  base: string; query: CrmQuery; fallback: string; children: ReactNode;
}) {
  return <>
    <div role="tablist" aria-label={label} className="flex gap-5 overflow-x-auto border-b border-zinc-100 px-5 [scrollbar-width:thin]">
      {tabs.map(tab => {
        const selected = tab.key === current;
        return <Link key={tab.key} id={`${idPrefix}-tab-${tab.key}`} role="tab" aria-selected={selected} aria-controls={`${idPrefix}-panel`} scroll={false} prefetch={false}
          href={crmTabHref(base, query, tab.key, fallback)}
          className={`shrink-0 whitespace-nowrap py-3 text-sm transition-colors duration-150 ${selected ? "font-semibold text-zinc-900 shadow-[inset_0_-2px_0_#18181b]" : "text-zinc-500 hover:text-zinc-900"}`}>{tab.label}</Link>;
      })}
    </div>
    <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${current}`} className="min-w-0">{children}</div>
  </>;
}
