import { PROJECT_STATUSES } from "@/lib/types";
import type { WorkOwner } from "./workOwner";

export type PickerProject = { id: string; name: string; status: string };

export type PickerOwnerItem = WorkOwner & { label: string; status?: string };
export type PickerOwnerGroup = { key: string; label: string; items: PickerOwnerItem[] };
export type PickerCrmTargets = {
  opportunities?: { id: string; name: string; clientName: string }[];
  clients?: { id: string; name: string }[];
};
export type PickerGroup = PickerOwnerGroup & {
  status: string;
  label: string;
  projects: PickerProject[];
};

/** Dự án đang chạy luôn hiện sẵn; các nhóm còn lại gom vào mục "Dự án khác". */
export const PRIMARY_PICKER_STATUSES = ["BIDDING", "ON_PROCESS"] as const;
const OTHER_PICKER_STATUSES = ["PENDING", "DONE", "FAIL", "CANCEL"] as const;

function buildGroups(projects: PickerProject[], statuses: readonly string[]): PickerGroup[] {
  return statuses
    .map((status) => ({
      key: status,
      status,
      label: PROJECT_STATUSES.find((item) => item.key === status)?.label ?? status,
      projects: projects
        .filter((project) => project.status === status)
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
      items: projects.filter((project) => project.status === status)
        .sort((a, b) => a.name.localeCompare(b.name, "vi"))
        .map((project) => ({ kind: "PROJECT" as const, id: project.id, label: project.name, status: project.status })),
    }))
    .filter((group) => group.projects.length > 0);
}

export function groupProjectsForPicker(projects: PickerProject[], targets: PickerCrmTargets = {}) {
  const known = new Set<string>([...PRIMARY_PICKER_STATUSES, ...OTHER_PICKER_STATUSES]);
  // Trạng thái lạ (nếu sau này thêm) vẫn hiện trong "Dự án khác", không bị mất.
  const unknownStatuses = [...new Set(projects.map((p) => p.status).filter((s) => !known.has(s)))];
  const primary = buildGroups(projects, PRIMARY_PICKER_STATUSES);
  const others = buildGroups(projects, [...OTHER_PICKER_STATUSES, ...unknownStatuses]);
  const crm: PickerOwnerGroup[] = [];
  if (targets.opportunities?.length) crm.push({ key: "opportunities", label: "Cơ hội", items: [...targets.opportunities].sort((a, b) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id)).map((opportunity) => ({ kind: "OPPORTUNITY", id: opportunity.id, label: `${opportunity.name} · ${opportunity.clientName}` })) });
  if (targets.clients?.length) crm.push({ key: "clients", label: "Khách hàng", items: [...targets.clients].sort((a, b) => a.name.localeCompare(b.name, "vi") || a.id.localeCompare(b.id)).map((client) => ({ kind: "CLIENT", id: client.id, label: client.name })) });
  return {
    primary,
    others,
    crm,
    groups: [...primary, ...others, ...crm],
    otherCount: others.reduce((sum, group) => sum + group.projects.length, 0),
  };
}
