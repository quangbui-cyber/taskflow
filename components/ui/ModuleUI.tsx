"use client";

import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export function ModuleTabs({ tabs, active, onChange, label }: {
  tabs: { id: string; label: string; count?: number }[]; active: string; onChange: (id: string) => void; label: string;
}) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const scroller = navRef.current;
    const selected = scroller?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!scroller || !selected) return;

    const selectedStart = selected.offsetLeft;
    const selectedEnd = selectedStart + selected.offsetWidth;
    const visibleStart = scroller.scrollLeft;
    const visibleEnd = visibleStart + scroller.clientWidth;
    if (selectedStart >= visibleStart && selectedEnd <= visibleEnd) return;

    scroller.scrollTo({
      left: Math.max(0, selectedStart - (scroller.clientWidth - selected.offsetWidth) / 2),
      behavior: "auto",
    });
  }, [active]);

  return <nav ref={navRef} className="tf-module-tabs" aria-label={label}>{tabs.map(tab =>
    <button type="button" key={tab.id} aria-pressed={active === tab.id} onClick={() => onChange(tab.id)}>
      {tab.label}{typeof tab.count === "number" && tab.count > 0 && <span className="tf-tab-count">{tab.count}</span>}
    </button>
  )}</nav>;
}

export function MetricCard({ label, value, hint, icon: Icon, accent = false }: {
  label: string; value: string; hint: string; icon: LucideIcon; accent?: boolean;
}) {
  return <div className={`tf-metric-card${accent ? " is-accent" : ""}`}>
    <div className="tf-metric-label"><span>{label}</span><span className="tf-metric-icon"><Icon size={18} aria-hidden="true" /></span></div>
    <p className="tf-metric-value">{value}</p><p className="tf-metric-hint">{hint}</p>
  </div>;
}
