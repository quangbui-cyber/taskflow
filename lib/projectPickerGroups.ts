import { PROJECT_STATUSES } from "@/lib/types";

export type PickerProject = { id: string; name: string; status: string };

export type PickerGroup = {
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
      status,
      label: PROJECT_STATUSES.find((item) => item.key === status)?.label ?? status,
      projects: projects
        .filter((project) => project.status === status)
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    }))
    .filter((group) => group.projects.length > 0);
}

export function groupProjectsForPicker(projects: PickerProject[]) {
  const known = new Set<string>([...PRIMARY_PICKER_STATUSES, ...OTHER_PICKER_STATUSES]);
  // Trạng thái lạ (nếu sau này thêm) vẫn hiện trong "Dự án khác", không bị mất.
  const unknownStatuses = [...new Set(projects.map((p) => p.status).filter((s) => !known.has(s)))];
  const primary = buildGroups(projects, PRIMARY_PICKER_STATUSES);
  const others = buildGroups(projects, [...OTHER_PICKER_STATUSES, ...unknownStatuses]);
  return {
    primary,
    others,
    otherCount: others.reduce((sum, group) => sum + group.projects.length, 0),
  };
}
