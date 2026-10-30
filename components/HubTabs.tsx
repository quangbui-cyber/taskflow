import Link from "next/link";
import { canViewRevenue } from "@/lib/auth";
import { creativeEnabled, financeEnabled, meetingsEnabled } from "@/lib/features";
import { canManageHr } from "@/lib/employeeRecords";
import { hubForSection, visibleSections, type ActiveSection } from "@/lib/navigation";

/** Tab các mục con của khu vực đang mở, đặt ở đầu vùng nội dung của trang. */
export default function HubTabs({
  section,
  role,
  isHrManager = false,
}: {
  section: ActiveSection;
  role?: string;
  isHrManager?: boolean;
}) {
  const hub = hubForSection(section);
  if (!hub) return null;
  const sections = visibleSections(hub, {
    showMeetings: meetingsEnabled(),
    showRevenue: canViewRevenue(role ?? ""),
    showSuppliers: financeEnabled(),
    showHr: canManageHr({ role, isHrManager }),
    showCreative: creativeEnabled(),
  });
  if (sections.length < 2) return null;

  return (
    <div className="border-b border-zinc-200 bg-white px-4 sm:px-8 lg:px-10">
      <nav
        className="tf-scroll-tabs flex items-center gap-6 overflow-x-auto"
        aria-label={`Mục trong ${hub.label}`}
      >
        <span className="hidden shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500 sm:inline">
          {hub.label}
        </span>
        {sections.map((item) => {
          const active = item.key === section;
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 py-3 text-sm transition-colors ${
                active
                  ? "border-brand-500 font-semibold text-zinc-950"
                  : "border-transparent text-zinc-600 hover:text-zinc-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
