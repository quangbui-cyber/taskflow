"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import UserPicker, { type UserPickerOption } from "@/components/UserPicker";
import { useInteraction } from "@/components/InteractionProvider";
import { setTeamManagersAction, setCrmDataStewardsAction, saveCrmSettingAction } from "@/app/actions/crmSettings";
import type { PipelineModeSetting } from "@/lib/crm/pipelineMode";
import type { PrepilotSection } from "@/lib/crm/prepilot";
import { CrmConfigurationBadge, CrmHistory, type CrmChange } from "./CrmSettings";
type Team = { id: string; name: string; managerIds: string[] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function CrmAccessSettings({ teams, users, stewardIds, pipelineMode, version, changes, notConfigured, access }: {
  teams: Team[]; users: UserPickerOption[]; stewardIds: string[]; pipelineMode: PipelineModeSetting; version: number; changes: CrmChange[];
  notConfigured: Pick<Record<PrepilotSection, boolean>, "ACCESS" | "SOURCE"> & Partial<Pick<Record<PrepilotSection, boolean>, "ACCESS_LIST">>;
  /** crm54: people who may use CRM besides Admin. Disabled users are dropped from the editable list. */
  access?: { userIds: string[]; version: number; adminIds: string[]; limited: boolean };
}) {
  const activeAccessIds = (access?.userIds ?? []).filter((id) => users.some((u) => u.id === id));
  const [accessIds, setAccessIds] = useState(activeAccessIds);
  const [accessBaseline, setAccessBaseline] = useState(activeAccessIds);
  const [accessVersion, setAccessVersion] = useState(access?.version ?? 0);
  const accessOptions = users.filter((u) => !access?.adminIds.includes(u.id));
  const [managerIds, setManagers] = useState(Object.fromEntries(teams.map((t) => [t.id, t.managerIds])));
  const [managerBaseline, setManagerBaseline] = useState(managerIds);
  const [stewards, setStewards] = useState(stewardIds);
  const [stewardBaseline, setStewardBaseline] = useState(stewardIds);
  const [source, setSource] = useState(pipelineMode);
  const [sourceBaseline, setSourceBaseline] = useState(pipelineMode);
  const [sourceVersion, setSourceVersion] = useState(version);
  const [pending, startTransition] = useTransition();
  const { notify } = useInteraction();
  const router = useRouter();
  const historyNames = Object.fromEntries([...users, ...teams].map((item) => [item.id, item.name]));
  function run(action: () => Promise<{ error?: string; success?: string }>, onSaved: () => void) {
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) { notify({ message: result.error, tone: "error" }); return; }
        onSaved();
        notify({ message: "Đã lưu cấu hình.", tone: "success" }); router.refresh();
      } catch {
        notify({ message: "Không lưu được cấu hình. Vui lòng thử lại.", tone: "error" });
      }
    });
  }
  const picker = (ids: string[], update: (ids: string[]) => void, label: string, options = users, placeholder = "Thêm người phụ trách") => <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{ids.map((id) => <span key={id} className="flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-sm">{users.find((u) => u.id === id)?.name ?? id}<button type="button" aria-label={`Bỏ ${users.find((u) => u.id === id)?.name ?? id} khỏi ${label}`} onClick={() => update(ids.filter((v) => v !== id))}>×</button></span>)}</div>
    <UserPicker options={options.filter((u) => !ids.includes(u.id))} value="" onChange={(id) => { if (id) update([...ids, id]); }} ariaLabel={label} placeholder={placeholder} disabled={pending} />
  </div>;
  // crm54: while CRM is opened per person, the official source cannot move to Cơ hội (also blocked on the server).
  const sourceLocked = !!access?.limited && sourceBaseline.mode !== "OPPORTUNITY_OFFICIAL";
  const accessDirty = !same([...accessIds].sort(), [...accessBaseline].sort());
  return <fieldset disabled={pending} className="min-w-0 space-y-6">
    {access && <section className="tf-panel p-5">
      <h2 className="mb-5 flex flex-wrap items-center gap-3 text-base font-semibold">Người dùng CRM{notConfigured.ACCESS_LIST && <CrmConfigurationBadge />}</h2>
      {picker(accessIds, setAccessIds, "Người dùng CRM", accessOptions, "Thêm người dùng CRM")}
      <button type="button" className={`${accessDirty ? "tf-button-primary" : "tf-button-secondary"} mt-3`} disabled={!accessDirty || pending} onClick={() => run(() => saveCrmSettingAction("access.users", accessIds, accessVersion), () => { setAccessBaseline([...accessIds]); setAccessVersion((v) => v + 1); })}>Lưu người dùng CRM</button>
      <CrmHistory changes={changes.filter((c) => c.key === "access.users")} names={historyNames} />
    </section>}
    <section className="tf-panel p-5">
      <h2 className="mb-5 flex flex-wrap items-center gap-3 text-base font-semibold">Phân quyền CRM{notConfigured.ACCESS && <CrmConfigurationBadge />}</h2>
      <div className="space-y-6">{teams.map((team) => {
        const dirty = !same(managerIds[team.id], managerBaseline[team.id]);
        return <div key={team.id}><h3 className="mb-3 font-semibold">AD/AM · {team.name}</h3>
          {picker(managerIds[team.id], (ids) => setManagers({ ...managerIds, [team.id]: ids }), `AD/AM ${team.name}`)}
          <button type="button" className={`${dirty ? "tf-button-primary" : "tf-button-secondary"} mt-3`} disabled={!dirty || pending} onClick={() => run(() => setTeamManagersAction(team.id, managerIds[team.id]), () => setManagerBaseline((current) => ({ ...current, [team.id]: [...managerIds[team.id]] })))}>Lưu AD/AM · {team.name}</button>
        </div>;
      })}</div>
      <h3 className="mb-3 mt-6 font-semibold">Người giữ chất lượng dữ liệu</h3>
      {picker(stewards, setStewards, "Người giữ chất lượng dữ liệu")}
      <button type="button" className={`${!same(stewards, stewardBaseline) ? "tf-button-primary" : "tf-button-secondary"} mt-3`} disabled={same(stewards, stewardBaseline) || pending} onClick={() => run(() => setCrmDataStewardsAction(stewards), () => setStewardBaseline([...stewards]))}>Lưu người giữ chất lượng dữ liệu</button>
      <CrmHistory changes={changes.filter((c) => c.key.startsWith("teamManagers.") || c.key === "stewards")} names={historyNames} />
    </section>
    <section className="tf-panel space-y-4 p-5">
      <h2 className="flex flex-wrap items-center gap-3 text-base font-semibold">Nguồn báo cáo{notConfigured.SOURCE && <CrmConfigurationBadge />}</h2>
      <label className="block text-sm">Báo cáo chính thức<select className="tf-field mt-2 w-full" value={source.mode} onChange={(e) => setSource({ ...source, mode: e.target.value as PipelineModeSetting["mode"] })}>
        <option value="PROJECT_OFFICIAL">Báo cáo chính thức đọc Project</option><option value="OPPORTUNITY_OFFICIAL" disabled={sourceLocked}>{sourceLocked ? "Báo cáo chính thức đọc Cơ hội · chế độ giới hạn" : "Báo cáo chính thức đọc Cơ hội"}</option>
      </select></label>
      <fieldset><legend className="mb-3 text-sm">Team pilot</legend><div className="flex flex-wrap gap-4">{teams.map((team) => <label key={team.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={source.pilotTeamIds.includes(team.id)} onChange={(e) => setSource({ ...source, pilotTeamIds: e.target.checked ? [...source.pilotTeamIds, team.id] : source.pilotTeamIds.filter((id) => id !== team.id) })} />{team.name}</label>)}</div></fieldset>
      <label className="block text-sm">Ngày chuyển thống nhất<input type="date" className="tf-field !w-auto mt-2 block" value={source.plannedCutoverDate ?? ""} onChange={(e) => setSource({ ...source, plannedCutoverDate: e.target.value || null })} /></label>
      <button type="button" className={!same(source, sourceBaseline) ? "tf-button-primary" : "tf-button-secondary"} disabled={same(source, sourceBaseline) || pending} onClick={() => run(() => saveCrmSettingAction("pipeline.mode", source, sourceVersion), () => { setSourceBaseline(structuredClone(source)); setSourceVersion((v) => v + 1); })}>Lưu nguồn báo cáo</button>
      <CrmHistory changes={changes.filter((c) => c.key === "pipeline.mode")} names={historyNames} />
    </section>
  </fieldset>;
}

