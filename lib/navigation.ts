// Điều hướng chính: 5 khu vực trên thanh icon bên trái, mỗi khu vực có các mục
// con hiện thành tab ở đầu trang (HubTabs). Thông báo và cài đặt
// nằm ở góc dưới thanh icon nên không thuộc khu vực nào; Hồ sơ của tôi thuộc Đội ngũ.

export type ActiveSection =
  | "home"
  | "tasks"
  | "meetings"
  | "documents"
  | "projects"
  | "suppliers"
  | "team"
  | "kpi"
  | "revenue"
  | "recognition"
  | "leave"
  | "notifications"
  | "profile"
  | "admin";

export type HubKey = "home" | "work" | "projects" | "performance" | "people";

export type NavFlags = {
  showMeetings: boolean;
  showRevenue: boolean;
  showSuppliers: boolean;
};

export type HubSection = {
  key: ActiveSection;
  label: string;
  href: string;
  visible?: (flags: NavFlags) => boolean;
};

export type Hub = {
  key: HubKey;
  label: string;
  href: string;
  sections: HubSection[];
};

export const HUBS: Hub[] = [
  { key: "home", label: "Trang chủ", href: "/", sections: [] },
  {
    key: "work",
    label: "Công việc",
    href: "/tasks",
    sections: [
      { key: "tasks", label: "Việc cần làm", href: "/tasks" },
      {
        key: "meetings",
        label: "Lịch họp",
        href: "/meetings",
        visible: (flags) => flags.showMeetings,
      },
      { key: "documents", label: "Tài liệu", href: "/documents" },
    ],
  },
  {
    key: "projects",
    label: "Dự án",
    href: "/projects",
    sections: [
      { key: "projects", label: "Danh sách dự án", href: "/projects" },
      {
        key: "suppliers",
        label: "Nhà cung cấp",
        href: "/suppliers",
        visible: (flags) => flags.showSuppliers,
      },
    ],
  },
  {
    key: "performance",
    label: "Hiệu quả",
    href: "/team",
    sections: [
      { key: "team", label: "Hiệu suất", href: "/team" },
      { key: "kpi", label: "KPI", href: "/kpi" },
      {
        key: "revenue",
        label: "Doanh số",
        href: "/revenue",
        visible: (flags) => flags.showRevenue,
      },
    ],
  },
  {
    key: "people",
    label: "Đội ngũ",
    href: "/recognition",
    sections: [
      { key: "recognition", label: "Góc cảm ơn", href: "/recognition" },
      { key: "leave", label: "Nghỉ phép", href: "/leave" },
      { key: "profile", label: "Hồ sơ của tôi", href: "/profile" },
    ],
  },
];

export function visibleSections(hub: Hub, flags: NavFlags) {
  return hub.sections.filter((section) => section.visible?.(flags) ?? true);
}

export function hubForSection(section: ActiveSection): Hub | null {
  if (section === "home") return HUBS[0];
  return HUBS.find((hub) => hub.sections.some((item) => item.key === section)) ?? null;
}
