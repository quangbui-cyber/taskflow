// Điều hướng chính: 6 khu vực trên thanh icon bên trái, mỗi khu vực có các mục
// con hiện thành tab ở đầu trang (HubTabs). Thông báo và cài đặt
// nằm ở góc dưới thanh icon nên không thuộc khu vực nào; Hồ sơ của tôi thuộc Đội ngũ.

export type ActiveSection =
  | "home"
  | "crm" | "crmClients" | "crmOpportunities" | "crmPipeline" | "crmImport"
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
  | "creative"
  | "caro"
  | "sudoku"
  | "hr"
  | "admin";

export type HubKey = "home" | "work" | "crm" | "projects" | "performance" | "people";

export type NavFlags = {
  showCrm?: boolean;
  showMeetings: boolean;
  showRevenue: boolean;
  showSuppliers: boolean;
  /** Admin hoặc người phụ trách nhân sự. */
  showHr: boolean;
  showCreative?: boolean;
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
  visible?: (flags: NavFlags) => boolean;
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
    ],
  },
  {
    key: "crm", label: "Khách hàng", href: "/crm", visible: (f) => !!f.showCrm,
    sections: [
      { key: "crm", label: "Review tuần", href: "/crm" },
      { key: "crmClients", label: "Khách hàng", href: "/crm/clients" },
      { key: "crmOpportunities", label: "Cơ hội", href: "/crm/opportunities" },
      { key: "crmPipeline", label: "Pipeline và hiệu quả", href: "/crm/pipeline" },
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
    href: "/leave",
    sections: [
      { key: "leave", label: "Nghỉ phép", href: "/leave" },
      { key: "documents", label: "Tài liệu", href: "/documents" },
      { key: "creative", label: "Góc Đọc", href: "/creative", visible: (flags) => flags.showCreative ?? true },
      { key: "recognition", label: "Kudos Wall", href: "/recognition" },
      { key: "caro", label: "Cờ Caro", href: "/caro" },
      { key: "sudoku", label: "Sudoku", href: "/sudoku" },
      { key: "profile", label: "Hồ sơ của tôi", href: "/profile" },
      {
        key: "hr",
        label: "Hồ sơ nhân sự",
        href: "/hr",
        visible: (flags) => flags.showHr,
      },
    ],
  },
];

export function visibleSections(hub: Hub, flags: NavFlags) {
  if (hub.visible && !hub.visible(flags)) return [];
  return hub.sections.filter((section) => section.visible?.(flags) ?? true);
}

export function hubForSection(section: ActiveSection): Hub | null {
  if (section.startsWith("crm")) return HUBS.find((hub) => hub.key === "crm") ?? null;
  if (section === "home") return HUBS[0];
  return HUBS.find((hub) => hub.sections.some((item) => item.key === section)) ?? null;
}
