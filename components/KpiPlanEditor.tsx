"use client";

import { useState, useTransition } from "react";
import { Lock, LockOpen, Save } from "lucide-react";
import {
  saveCompanyKpiPlan,
  saveTeamKpiAllocation,
  setKpiPlanLocked,
  type KpiState,
} from "@/app/actions/kpi";
import KpiMonthGrid, {
  AmountInput,
  formatMillions,
  type KpiGridRow,
} from "@/components/KpiMonthGrid";
import { useInteraction } from "@/components/InteractionProvider";
import { formatCompactVND } from "@/components/KpiViews";
import { sumMonths } from "@/lib/kpi";

type GridValues = Record<string, number[]>;

function SaveButton({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="tf-button-primary"
    >
      {pending ? (
        <span className="tf-spinner" aria-hidden="true" />
      ) : (
        <Save size={16} aria-hidden="true" />
      )}
      {pending ? "Đang lưu..." : label}
    </button>
  );
}

function useSave() {
  const { notify } = useInteraction();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function run(action: () => Promise<KpiState>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? "");
      notify({
        message: result.error ?? result.success ?? "Đã lưu.",
        tone: result.error ? "error" : "success",
      });
    });
  }
  return { pending, error, run };
}

export type KpiPlanTeam = {
  id: string;
  name: string;
  months: number[];
  accounts: Array<{ id: string; name: string }>;
};

/** Admin: KPI năm của công ty và chỉ tiêu tháng giao cho từng team. */
export function KpiCompanyPlanEditor({
  year,
  companyTarget: initialCompanyTarget,
  teams,
  locked,
}: {
  year: number;
  companyTarget: number;
  teams: KpiPlanTeam[];
  locked: boolean;
}) {
  const [companyTarget, setCompanyTarget] = useState(initialCompanyTarget);
  const [values, setValues] = useState<GridValues>(() =>
    Object.fromEntries(teams.map((team) => [team.id, team.months]))
  );
  const save = useSave();

  const assigned = teams.reduce(
    (sum, team) => sum + sumMonths(values[team.id] ?? []),
    0
  );
  const gap = companyTarget - assigned;
  const rows: KpiGridRow[] = teams.map((team) => ({
    id: team.id,
    name: team.name,
    hint: `${team.accounts.length} Account`,
  }));

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">
          Kế hoạch KPI công ty năm {year} <span className="font-normal text-zinc-500">(triệu đồng)</span>
        </h2>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.run(() =>
            saveCompanyKpiPlan(
              year,
              companyTarget,
              teams.map((team) => ({
                id: team.id,
                months: values[team.id] ?? [],
              }))
            )
          );
        }}
      >
        <div className="grid gap-4 border-b border-zinc-100 p-5 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-medium text-zinc-500">
              KPI công ty cả năm (triệu đồng)
            </span>
            <AmountInput
              value={companyTarget}
              onChange={setCompanyTarget}
              ariaLabel="KPI công ty cả năm, triệu đồng"
              disabled={locked}
              className="mt-1.5 !h-[42px] text-sm font-semibold"
            />
            <span className="mt-1 block text-xs tabular-nums text-zinc-400">
              = {formatCompactVND(companyTarget)}
            </span>
          </label>
          <div>
            <p className="text-xs font-medium text-zinc-500">Đã giao cho team</p>
            <p className="mt-2.5 text-lg font-semibold tabular-nums text-zinc-950">
              {formatMillions(assigned)}
            </p>
            <p className="mt-1 text-xs tabular-nums text-zinc-400">
              = {formatCompactVND(assigned)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-zinc-500">
              {gap < 0 ? "Giao vượt KPI công ty" : "Chưa giao"}
            </p>
            <p
              className={`mt-2.5 text-lg font-semibold tabular-nums ${
                gap === 0
                  ? "text-emerald-600"
                  : gap > 0
                    ? "text-amber-600"
                    : "text-red-600"
              }`}
            >
              {formatMillions(Math.abs(gap))}
            </p>
          </div>
        </div>

        {teams.length === 0 ? (
          <p className="px-5 py-4 text-sm text-zinc-400">
            Chưa có team kinh doanh.
          </p>
        ) : (
          <div className="py-3">
            <KpiMonthGrid
              rows={rows}
              values={values}
              onChange={(id, months) =>
                setValues((current) => ({ ...current, [id]: months }))
              }
              rowHeader="Team"
              disabled={locked || save.pending}
            />
          </div>
        )}

        {!locked && (
          <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-5 py-3">
            {save.error && <p className="text-xs text-red-600">{save.error}</p>}
            <SaveButton pending={save.pending} label="Lưu kế hoạch" />
          </div>
        )}
      </form>

    </section>
  );
}

/** Admin hoặc trưởng team: chia chỉ tiêu của một team xuống từng Account. */
export function KpiTeamAllocationEditor({
  year,
  team,
  accounts,
  locked,
}: {
  locked: boolean;
  year: number;
  team: { id: string; name: string; months: number[] };
  accounts: Array<{ id: string; name: string; months: number[] }>;
}) {
  const [values, setValues] = useState<GridValues>(() =>
    Object.fromEntries(accounts.map((account) => [account.id, account.months]))
  );
  const save = useSave();

  return (
    <section className="tf-panel overflow-hidden">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="font-semibold">
          Chia KPI {team.name} năm {year} <span className="font-normal text-zinc-500">(triệu đồng)</span>
        </h2>
      </div>
      {accounts.length === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-400">
          Team này chưa có Account nào.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.run(() =>
              saveTeamKpiAllocation(
                year,
                team.id,
                accounts.map((account) => ({
                  id: account.id,
                  months: values[account.id] ?? [],
                }))
              )
            );
          }}
        >
          <div className="py-3">
            <KpiMonthGrid
              rows={accounts.map((account) => ({
                id: account.id,
                name: account.name,
              }))}
              values={values}
              onChange={(id, months) =>
                setValues((current) => ({ ...current, [id]: months }))
              }
              rowHeader="Account"
              reference={{ label: "Chỉ tiêu team", months: team.months }}
              disabled={locked || save.pending}
            />
          </div>
          {!locked && (
            <div className="flex items-center justify-end gap-3 border-t border-zinc-100 px-5 py-3">
              {save.error && <p className="text-xs text-red-600">{save.error}</p>}
              <SaveButton pending={save.pending} label="Lưu phần chia" />
            </div>
          )}
        </form>
      )}
    </section>
  );
}

/** Trạng thái chốt của kế hoạch; Admin chốt hoặc mở lại tại đây. */
export function KpiPlanLockBar({
  year,
  lockedAtLabel,
  canToggle,
}: {
  year: number;
  /** Thời điểm chốt đã định dạng; null khi kế hoạch đang mở. */
  lockedAtLabel: string | null;
  canToggle: boolean;
}) {
  const toggle = useSave();
  const locked = lockedAtLabel !== null;

  return (
    <section
      className={`tf-panel flex flex-wrap items-center gap-3 px-5 py-3 ${
        locked ? "border-amber-200 bg-amber-50" : ""
      }`}
    >
      {locked ? (
        <Lock size={17} className="shrink-0 text-amber-600" aria-hidden="true" />
      ) : (
        <LockOpen size={17} className="shrink-0 text-zinc-400" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-800">
          {locked
            ? `Kế hoạch năm ${year} đã chốt lúc ${lockedAtLabel}`
            : `Kế hoạch năm ${year} đang mở để chỉnh sửa`}
        </p>
      </div>
      {canToggle && (
        <button
          type="button"
          disabled={toggle.pending}
          aria-busy={toggle.pending}
          className="tf-button-secondary"
          onClick={() => {
            if (
              locked &&
              !window.confirm(`Mở lại kế hoạch KPI năm ${year} để sửa?`)
            ) {
              return;
            }
            toggle.run(() => setKpiPlanLocked(year, !locked));
          }}
        >
          {locked ? "Mở lại" : "Chốt kế hoạch"}
        </button>
      )}
    </section>
  );
}
