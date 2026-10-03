import type { ResponsibilityOptions } from "@/lib/projectResponsibility";

export default function ProjectResponsibilitySelect({
  teams,
  groups,
  defaultValue = "",
  disabled,
}: ResponsibilityOptions & { defaultValue?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <span className="tf-label">Team/phòng ban phụ trách</span>
      <select
        name="responsibility"
        defaultValue={defaultValue}
        disabled={disabled}
        className="tf-field"
      >
        <option value="">— Chưa gán —</option>
        {groups.length > 0 && (
          <optgroup label="Phòng ban / Nhóm">
            {groups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.name}
              </option>
            ))}
          </optgroup>
        )}
        {teams.length > 0 && (
          <optgroup label="Team kinh doanh">
            {teams.map((team) => (
              <option key={team.id} value={`team:${team.id}`}>
                {team.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <span className="mt-1 block text-xs text-zinc-500">
        Chọn nhóm quản lý dự án. Thêm người tham gia tại mục Thành viên.
      </span>
      {teams.length === 0 && groups.length === 0 && (
        <span className="mt-1 block text-xs text-amber-600">
          Chưa có nhóm để chọn. Admin có thể thêm tại Cài đặt.
        </span>
      )}
    </label>
  );
}
