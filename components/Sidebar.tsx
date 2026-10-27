import Link from "next/link";
import {
  Bell,
  BriefcaseBusiness,
  ChartColumn,
  CheckCircle2,
  House,
  Settings,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import LogoutButton from "@/components/LogoutButton";
import PushDeviceSync from "@/components/PushDeviceSync";
import Brand from "@/components/Brand";
import Avatar from "@/components/Avatar";
import MobileSidebarMenu from "@/components/MobileSidebarMenu";
import { canViewRevenue } from "@/lib/auth";
import { meetingsEnabled } from "@/lib/features";
import {
  HUBS,
  hubForSection,
  visibleSections,
  type ActiveSection,
  type HubKey,
} from "@/lib/navigation";
import { prisma } from "@/lib/prisma";
import type { ProjectCategory } from "@/lib/types";

type ProjectItem = {
  id: string;
  name: string;
  color: string;
  status: string;
  category: ProjectCategory;
  responsibleTeam: { id: string; name: string } | null;
  responsibleGroup: { id: string; name: string } | null;
  account: { team: { id: string; name: string } } | null;
};

const HUB_ICONS: Record<HubKey, LucideIcon> = {
  home: House,
  work: CheckCircle2,
  projects: BriefcaseBusiness,
  performance: ChartColumn,
  people: UsersRound,
};

function RailLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // Mỗi trang đích tự truy vấn Prisma riêng; tắt prefetch để thanh điều
      // hướng không kéo theo hàng loạt lần render ngầm.
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`flex flex-col items-center gap-1 rounded-[10px] px-1 pb-2 pt-2.5 text-[11px] leading-tight transition-colors ${
        active
          ? "bg-brand-100 font-semibold text-brand-800"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      <span className="text-center">{label}</span>
    </Link>
  );
}

function MobileLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-10 items-center rounded-[7px] px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-brand-50 font-medium text-brand-700"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      {label}
    </Link>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="absolute -right-1 -top-1 min-w-4 rounded-full border-2 border-white bg-red-500 px-1 text-center text-[9px] font-bold leading-3 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export default async function Sidebar({
  user,
  activeProjectId,
  activeSection = "home",
}: {
  user: {
    id: string;
    name: string;
    email: string;
    role?: string;
    avatarUrl?: string | null;
  };
  // Cây dự án đã chuyển sang trang /projects; giữ prop để các trang cũ không phải đổi.
  projects?: ProjectItem[];
  activeProjectId?: string;
  activeSection?: ActiveSection;
}) {
  const unreadCount = await prisma.notification.count({
    where: { userId: user.id, read: false },
  });
  const flags = {
    showMeetings: meetingsEnabled(),
    showRevenue: canViewRevenue(user.role ?? ""),
  };
  const activeHub = activeProjectId ? "projects" : hubForSection(activeSection)?.key;
  const isAdmin = user.role === "ADMIN";
  const unreadLabel =
    unreadCount > 0 ? `Thông báo (${unreadCount} chưa đọc)` : "Thông báo";

  return (
    <>
      <PushDeviceSync userId={user.id} />
      <aside className="sticky top-0 hidden h-screen w-[84px] shrink-0 flex-col border-r border-zinc-200 bg-white px-2 py-3 md:flex">
        <Link
          href="/"
          prefetch={false}
          aria-label="myCreative - Trang chủ"
          className="mb-4 flex h-10 items-center justify-center rounded-[10px] bg-brand-400 text-sm font-extrabold tracking-wide text-zinc-950"
        >
          CS
        </Link>

        <nav className="flex flex-col gap-1.5" aria-label="Khu vực chính">
          {HUBS.map((hub) => (
            <RailLink
              key={hub.key}
              href={hub.href}
              label={hub.label}
              icon={HUB_ICONS[hub.key]}
              active={activeHub === hub.key}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2 pt-3">
          <Link
            href="/notifications"
            prefetch={false}
            aria-label={unreadLabel}
            title="Thông báo"
            aria-current={activeSection === "notifications" ? "page" : undefined}
            className={`relative flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors ${
              activeSection === "notifications"
                ? "bg-brand-100 text-brand-800"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
            }`}
          >
            <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
            <UnreadDot count={unreadCount} />
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              prefetch={false}
              aria-label="Cài đặt"
              title="Cài đặt"
              aria-current={activeSection === "admin" ? "page" : undefined}
              className={`flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors ${
                activeSection === "admin"
                  ? "bg-brand-100 text-brand-800"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              }`}
            >
              <Settings size={20} strokeWidth={1.8} aria-hidden="true" />
            </Link>
          )}
          <Link
            href="/profile"
            prefetch={false}
            aria-label={`Tài khoản của tôi: ${user.name}`}
            title="Tài khoản của tôi: đổi tên, ảnh đại diện, mật khẩu"
            aria-current={activeSection === "profile" ? "page" : undefined}
            className="rounded-full"
          >
            <Avatar
              id={user.id}
              name={user.name}
              avatarUrl={user.avatarUrl}
              className="h-9 w-9 text-sm"
            />
          </Link>
          <LogoutButton />
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/95 px-4 backdrop-blur md:hidden">
        <Link href="/" prefetch={false} aria-label="myCreative - Trang chủ">
          <Brand compact />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/notifications"
            prefetch={false}
            aria-label={unreadLabel}
            className="relative flex h-11 w-11 items-center justify-center rounded-[7px] border border-zinc-200 text-zinc-600"
          >
            <Bell size={19} aria-hidden="true" />
            <UnreadDot count={unreadCount} />
          </Link>
          <MobileSidebarMenu>
            <div className="absolute right-0 top-12 z-50 max-h-[calc(100vh-80px)] w-[min(88vw,320px)] overflow-y-auto rounded-[8px] border border-zinc-200 bg-white p-3 shadow-xl">
              {HUBS.map((hub) => {
                const sections = visibleSections(hub, flags);
                return (
                  <div key={hub.key} className="border-b border-zinc-100 py-2 first:pt-0 last:border-b-0">
                    {sections.length === 0 ? (
                      <MobileLink href={hub.href} label={hub.label} active={activeHub === hub.key} />
                    ) : (
                      <>
                        <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                          {hub.label}
                        </p>
                        {sections.map((section) => (
                          <MobileLink
                            key={section.key}
                            href={section.href}
                            label={section.label}
                            active={
                              section.key === "projects"
                                ? activeHub === "projects" && activeSection !== "suppliers"
                                : activeSection === section.key
                            }
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}
              {isAdmin && (
                <div className="border-t border-zinc-200 pt-2">
                  <MobileLink href="/admin" label="Cài đặt" active={activeSection === "admin"} />
                </div>
              )}
              <div className="mt-2 flex items-center gap-3 border-t border-zinc-200 px-2 pt-3">
                <Avatar
                  id={user.id}
                  name={user.name}
                  avatarUrl={user.avatarUrl}
                  className="h-9 w-9 text-sm"
                />
                <Link
                  href="/profile"
                  prefetch={false}
                  aria-current={activeSection === "profile" ? "page" : undefined}
                  className="min-w-0 flex-1 rounded-[6px] px-1 py-0.5 transition-colors hover:bg-zinc-100"
                  title="Tài khoản của tôi: đổi tên, ảnh đại diện, mật khẩu"
                >
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-zinc-500">{user.email}</p>
                </Link>
                <LogoutButton />
              </div>
            </div>
          </MobileSidebarMenu>
        </div>
      </header>
    </>
  );
}
