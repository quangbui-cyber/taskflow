import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import {
  LeaveCancelButton,
  LeaveDecisionButtons,
  LeaveManagerPicker,
  LeaveQuotaInput,
  LeaveRequestForm,
  LeaveUsedInput,
} from "@/components/LeaveViews";
import {
  HALF_DAY_OPTIONS,
  canCancelLeave,
  formatLeaveDate,
  formatLeaveDays,
  leaveApproverIds,
  leaveDaysByMonth,
  leaveManagerId,
  leaveStatusInfo,
  leaveTypeInfo,
  summarizeLeave,
  todayInVietnam,
} from "@/lib/leave";
import { loadLeaveManagers } from "@/lib/leaveData";

const LEAVE_BLUE_DARK = "#1d4ed8";
const LEAVE_BLUE_SOFT = "#eff6ff";

type LeaveRow = {
  type: string;
  startDate: Date;
  endDate: Date;
  halfDay: string | null;
  days: number;
  reason: string | null;
};

function LeaveSummaryLine({ request }: { request: LeaveRow }) {
  const range =
    request.startDate.getTime() === request.endDate.getTime()
      ? formatLeaveDate(request.startDate)
      : `${formatLeaveDate(request.startDate)} – ${formatLeaveDate(request.endDate)}`;
  const halfDay = HALF_DAY_OPTIONS.find(
    (option) => option.key === request.halfDay
  );
  return (
    <>
      <p className="text-sm font-medium text-zinc-900">
        {range}
        {halfDay ? ` · ${halfDay.label.toLowerCase()}` : ""}
        <span className="ml-2 font-normal text-zinc-500">
          {formatLeaveDays(request.days)} ngày ·{" "}
          {leaveTypeInfo(request.type).label}
        </span>
      </p>
      {request.reason && (
        <p className="mt-0.5 text-xs text-zinc-500">Lý do: {request.reason}</p>
      )}
    </>
  );
}

function ViewChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active
          ? "border-blue-600 bg-blue-600 font-medium text-white"
          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; year?: string; month?: string }>;
}) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const isAdmin = user.role === "ADMIN";
  const today = todayInVietnam();
  const year = today.getUTCFullYear();
  const yearRange = {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1)),
  };

  const [leaveManagers, sidebarProjects] = await Promise.all([
    loadLeaveManagers(),
    prisma.project.findMany({
      where: { members: { some: { userId: user.id } } },
      select: {
        id: true,
        name: true,
        color: true,
        status: true,
        category: true,
        responsibleTeam: { select: { id: true, name: true } },
        responsibleGroup: { select: { id: true, name: true } },
        account: { select: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const isLeaveManager = leaveManagers.some(
    (manager) => manager.id === user.id
  );
  // Quản lý nghỉ phép và Admin xem được đơn của toàn công ty.
  const seesEveryone = isLeaveManager || isAdmin;
  // Thiết lập chỉ Admin thấy; báo cáo dành cho người xem được toàn công ty.
  const view =
    params.view === "settings" && isAdmin
      ? "settings"
      : params.view === "report" && seesEveryone
        ? "report"
        : "requests";

  const header = (
    <>
      <div>
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-[8px]"
            style={{ backgroundColor: LEAVE_BLUE_SOFT, color: LEAVE_BLUE_DARK }}
          >
            <CalendarDays size={20} aria-hidden="true" />
          </span>
          <h1 className="tf-page-title" style={{ color: LEAVE_BLUE_DARK }}>
            Nghỉ phép
          </h1>
        </div>
      </div>
      {seesEveryone && (
        <nav className="flex gap-2" aria-label="Chế độ xem Nghỉ phép">
          <ViewChip href="/leave" active={view === "requests"}>
            Đơn nghỉ
          </ViewChip>
          <ViewChip href="/leave?view=report" active={view === "report"}>
            Báo cáo
          </ViewChip>
          {isAdmin && (
            <ViewChip href="/leave?view=settings" active={view === "settings"}>
              Thiết lập
            </ViewChip>
          )}
        </nav>
      )}
    </>
  );

  if (view === "report") {
    const requestedYear = Number(params.year);
    const reportYear =
      Number.isInteger(requestedYear) &&
      requestedYear >= 2020 &&
      requestedYear <= year + 1
        ? requestedYear
        : year;
    const [approved, firstRequest] = await Promise.all([
      // Chỉ đơn đã duyệt mới vào báo cáo. Một đơn luôn nằm trọn trong một năm.
      prisma.leaveRequest.findMany({
        where: {
          status: "APPROVED",
          startDate: {
            gte: new Date(Date.UTC(reportYear, 0, 1)),
            lt: new Date(Date.UTC(reportYear + 1, 0, 1)),
          },
        },
        include: {
          user: { select: { id: true, name: true } },
          decider: { select: { name: true } },
        },
        orderBy: { startDate: "asc" },
      }),
      prisma.leaveRequest.findFirst({
        where: { status: "APPROVED" },
        orderBy: { startDate: "asc" },
        select: { startDate: true },
      }),
    ]);

    type PersonMonth = {
      id: string;
      name: string;
      annual: number;
      unpaid: number;
      entries: Array<{ request: (typeof approved)[number]; days: number }>;
    };
    const months = Array.from({ length: 12 }, (_, index) => ({
      month: index + 1,
      people: new Map<string, PersonMonth>(),
    }));
    for (const request of approved) {
      const split = leaveDaysByMonth(
        request.startDate,
        request.endDate,
        request.halfDay
      );
      for (const [month, days] of split) {
        const bucket = months[month - 1].people;
        const person = bucket.get(request.user.id) ?? {
          id: request.user.id,
          name: request.user.name,
          annual: 0,
          unpaid: 0,
          entries: [],
        };
        if (leaveTypeInfo(request.type).deductsQuota) person.annual += days;
        else person.unpaid += days;
        person.entries.push({ request, days });
        bucket.set(request.user.id, person);
      }
    }
    const rows = months.map(({ month, people }) => {
      const list = [...people.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "vi")
      );
      return {
        month,
        people: list,
        annual: list.reduce((sum, person) => sum + person.annual, 0),
        unpaid: list.reduce((sum, person) => sum + person.unpaid, 0),
      };
    });

    const requestedMonth = Number(params.month);
    const selectedMonth =
      Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
        ? requestedMonth
        : reportYear === year
          ? today.getUTCMonth() + 1
          : (rows.find((row) => row.people.length > 0)?.month ?? 1);
    const selected = rows[selectedMonth - 1];
    const firstYear = firstRequest?.startDate.getUTCFullYear() ?? year;
    const years = Array.from(
      { length: year - Math.min(firstYear, reportYear) + 1 },
      (_, index) => Math.min(firstYear, reportYear) + index
    );
    const reportHref = (y: number, m?: number) =>
      `/leave?view=report&year=${y}${m ? `&month=${m}` : ""}`;

    return (
      <div className="tf-shell">
        <Sidebar user={user} projects={sidebarProjects} activeSection="leave" />
        <main className="tf-main">
          <div className="tf-page space-y-6">
            {header}

            <nav className="flex flex-wrap gap-2" aria-label="Năm báo cáo">
              {years.map((y) => (
                <ViewChip key={y} href={reportHref(y)} active={y === reportYear}>
                  {y}
                </ViewChip>
              ))}
            </nav>

            <section className="tf-panel overflow-hidden">
              <div className="border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">
                  Báo cáo nghỉ phép năm {reportYear}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  Chỉ tính đơn đã duyệt. Đơn vắt qua hai tháng được tách theo
                  ngày làm việc của từng tháng. Bấm vào một tháng để xem chi
                  tiết.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500">
                      <th className="px-5 py-2 text-left font-medium">Tháng</th>
                      <th className="px-3 py-2 text-right font-medium">
                        Số người nghỉ
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Phép năm
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Không lương
                      </th>
                      <th className="px-5 py-2 text-right font-medium">
                        Tổng ngày
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {rows.map((row) => {
                      const active = row.month === selectedMonth;
                      const empty = row.people.length === 0;
                      return (
                        <tr
                          key={row.month}
                          className={active ? "bg-blue-50" : undefined}
                        >
                          <td className="px-5 py-2">
                            <Link
                              href={reportHref(reportYear, row.month)}
                              prefetch={false}
                              aria-current={active ? "true" : undefined}
                              className={`font-medium hover:underline ${
                                active ? "text-blue-700" : "text-zinc-800"
                              }`}
                            >
                              Tháng {row.month}
                            </Link>
                          </td>
                          {[
                            String(row.people.length),
                            formatLeaveDays(row.annual),
                            formatLeaveDays(row.unpaid),
                          ].map((value, index) => (
                            <td
                              key={index}
                              className={`px-3 py-2 text-right tabular-nums ${
                                empty ? "text-zinc-300" : "text-zinc-700"
                              }`}
                            >
                              {value}
                            </td>
                          ))}
                          <td
                            className={`px-5 py-2 text-right font-semibold tabular-nums ${
                              empty ? "text-zinc-300" : "text-zinc-950"
                            }`}
                          >
                            {formatLeaveDays(row.annual + row.unpaid)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-zinc-100 text-zinc-700">
                      <th className="px-5 py-2 text-left font-medium">Cả năm</th>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {new Set(approved.map((request) => request.user.id)).size}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLeaveDays(
                          rows.reduce((sum, row) => sum + row.annual, 0)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatLeaveDays(
                          rows.reduce((sum, row) => sum + row.unpaid, 0)
                        )}
                      </td>
                      <td className="px-5 py-2 text-right font-semibold tabular-nums text-zinc-950">
                        {formatLeaveDays(
                          rows.reduce(
                            (sum, row) => sum + row.annual + row.unpaid,
                            0
                          )
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="tf-panel overflow-hidden">
              <div className="border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">
                  Chi tiết tháng {selectedMonth}/{reportYear}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {selected.people.length} người nghỉ ·{" "}
                  {formatLeaveDays(selected.annual + selected.unpaid)} ngày
                </p>
              </div>
              {selected.people.length === 0 ? (
                <p className="px-5 py-4 text-sm text-zinc-400">
                  Không có ai nghỉ trong tháng này.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {selected.people.map((person) => (
                    <li key={person.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                        <p className="min-w-0 flex-1 text-sm font-semibold text-zinc-900">
                          {person.name}
                        </p>
                        <p className="text-xs tabular-nums text-zinc-500">
                          Phép năm {formatLeaveDays(person.annual)} · Không
                          lương {formatLeaveDays(person.unpaid)} ·{" "}
                          <strong className="font-semibold text-zinc-900">
                            Tổng {formatLeaveDays(person.annual + person.unpaid)}{" "}
                            ngày
                          </strong>
                        </p>
                      </div>
                      <ul className="mt-2 space-y-1.5 border-l-2 border-zinc-100 pl-3">
                        {person.entries.map(({ request, days }) => (
                          <li key={request.id} className="text-xs text-zinc-600">
                            <LeaveSummaryLine request={request} />
                            <p className="mt-0.5 text-zinc-400">
                              {days !== request.days
                                ? `Tính cho tháng này: ${formatLeaveDays(days)} ngày · `
                                : ""}
                              Duyệt bởi {request.decider?.name ?? "—"}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </main>
      </div>
    );
  }

  if (view === "settings") {
    const people = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        annualLeaveDays: true,
        leaveAdjustments: {
          where: { year },
          select: { adjustmentDays: true },
        },
        leaveRequests: {
          where: { startDate: yearRange },
          select: { type: true, status: true, days: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return (
      <div className="tf-shell">
        <Sidebar user={user} projects={sidebarProjects} activeSection="leave" />
        <main className="tf-main">
          <div className="tf-page space-y-6">
            {header}
            <section className="tf-panel overflow-hidden">
              <div className="border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">Quản lý nghỉ phép</h2>
              </div>
              <div className="p-5">
                <LeaveManagerPicker
                  key={leaveManagers.map((manager) => manager.id).join("|")}
                  users={people.map((person) => ({
                    id: person.id,
                    name: person.name,
                  }))}
                  selectedIds={leaveManagers.map((manager) => manager.id)}
                />
              </div>
            </section>

            <section className="tf-panel overflow-hidden">
              <div className="border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">Quỹ phép năm {year}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500">
                      <th className="px-5 py-2 text-left font-medium">
                        Người dùng
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Đã dùng
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Chờ duyệt
                      </th>
                      <th className="px-3 py-2 text-right font-medium">
                        Còn lại
                      </th>
                      <th className="px-5 py-2 text-right font-medium">
                        Phép năm
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {people.map((person) => {
                      const balance = summarizeLeave(
                        person.leaveRequests,
                        person.annualLeaveDays,
                        person.leaveAdjustments[0]?.adjustmentDays ?? 0
                      );
                      return (
                        <tr key={person.id}>
                          <td className="px-5 py-2 font-medium text-zinc-800">
                            {person.name}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <LeaveUsedInput
                              key={`${person.id}:${year}:${balance.used}`}
                              userId={person.id}
                              userName={person.name}
                              year={year}
                              days={balance.used}
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                            {formatLeaveDays(balance.pending)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-semibold tabular-nums ${
                              balance.remaining < 0
                                ? "text-red-600"
                                : "text-zinc-900"
                            }`}
                          >
                            {formatLeaveDays(balance.remaining)}
                          </td>
                          <td className="px-5 py-2">
                            <LeaveQuotaInput
                              key={`${person.id}:${person.annualLeaveDays}`}
                              userId={person.id}
                              userName={person.name}
                              days={person.annualLeaveDays}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  const [me, myRequests, toDecide, upcoming] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        annualLeaveDays: true,
        leaveAdjustments: {
          where: { year },
          select: { adjustmentDays: true },
        },
        managerId: true,
        manager: { select: { name: true, isActive: true } },
      },
    }),
    prisma.leaveRequest.findMany({
      where: { userId: user.id },
      include: { decider: { select: { name: true } } },
      orderBy: { startDate: "desc" },
      take: 50,
    }),
    // Đơn tôi phải duyệt: của nhân viên tôi trực tiếp quản lý; nếu tôi là quản lý
    // tab Nghỉ phép thì thêm đơn của người chưa có quản lý (hoặc quản lý đã nghỉ việc).
    prisma.leaveRequest.findMany({
      where: {
        status: "PENDING",
        userId: { not: user.id },
        user: {
          OR: [
            { managerId: user.id },
            ...(isLeaveManager
              ? [{ managerId: null }, { manager: { isActive: false } }]
              : []),
          ],
        },
      },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: "asc" },
    }),
    // Lịch nghỉ đã duyệt sắp tới: người xem toàn công ty thấy mọi người, quản lý thấy nhân viên mình.
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        endDate: { gte: today },
        userId: { not: user.id },
        ...(seesEveryone ? {} : { user: { managerId: user.id } }),
      },
      include: { user: { select: { name: true } } },
      orderBy: { startDate: "asc" },
      take: 30,
    }),
  ]);

  const requester = {
    id: me.id,
    managerId: me.managerId,
    managerActive: me.manager?.isActive,
  };
  const approverIds = leaveApproverIds(
    requester,
    leaveManagers.map((manager) => manager.id)
  );
  const approverName = leaveManagerId(requester)
    ? (me.manager?.name ?? "")
    : leaveManagers
        .filter((manager) => approverIds.includes(manager.id))
        .map((manager) => manager.name)
        .join(", ");

  const summary = summarizeLeave(
    myRequests.filter(
      (request) =>
        request.startDate >= yearRange.gte && request.startDate < yearRange.lt
    ),
    me.annualLeaveDays,
    me.leaveAdjustments[0]?.adjustmentDays ?? 0
  );

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="leave" />

      <main className="tf-main">
        <div className="tf-page space-y-6">
          {header}

          <div className="tf-metric-strip">
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">
                Phép năm {year}
              </p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatLeaveDays(summary.quota)} ngày
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Đã dùng</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatLeaveDays(summary.used)} ngày
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Đang chờ duyệt</p>
              <p className="mt-2 text-xl font-semibold tabular-nums text-zinc-950">
                {formatLeaveDays(summary.pending)} ngày
              </p>
            </section>
            <section className="tf-metric-item">
              <p className="text-xs font-medium text-zinc-500">Còn lại</p>
              <p
                className={`mt-2 text-xl font-semibold tabular-nums ${
                  summary.remaining < 0 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {formatLeaveDays(summary.remaining)} ngày
              </p>
            </section>
          </div>

          {approverIds.length > 0 ? (
            <LeaveRequestForm
              today={today.toISOString().slice(0, 10)}
              remaining={summary.remaining - summary.pending}
              approverName={approverName}
            />
          ) : (
            <section className="tf-panel border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
              Chưa có người duyệt đơn của bạn: bạn chưa có quản lý trực tiếp và
              chưa có quản lý nghỉ phép nào khác.{" "}
              {isAdmin ? (
                <Link
                  href="/leave?view=settings"
                  prefetch={false}
                  className="font-medium underline"
                >
                  Chọn quản lý nghỉ phép trong Thiết lập
                </Link>
              ) : (
                "Hãy báo Admin."
              )}
            </section>
          )}

          {toDecide.length > 0 && (
            <section className="tf-panel overflow-hidden">
              <div className="border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">
                  Đơn cần tôi duyệt ({toDecide.length})
                </h2>
              </div>
              <ul className="divide-y divide-zinc-50">
                {toDecide.map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="text-xs font-semibold text-zinc-600">
                        {request.user.name}
                      </p>
                      <LeaveSummaryLine request={request} />
                    </div>
                    <LeaveDecisionButtons
                      requestId={request.id}
                      requesterName={request.user.name}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="tf-panel overflow-hidden">
            <div className="border-b border-zinc-100 px-5 py-3">
              <h2 className="font-semibold">Đơn của tôi</h2>
            </div>
            {myRequests.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-400">
                Bạn chưa có đơn xin nghỉ nào.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-50">
                {myRequests.map((request) => {
                  const status = leaveStatusInfo(request.status);
                  return (
                    <li
                      key={request.id}
                      className="flex flex-wrap items-center gap-3 px-5 py-3"
                    >
                      <div className="min-w-0 flex-1 basis-64">
                        <LeaveSummaryLine request={request} />
                        {request.decider && (
                          <p className="mt-0.5 text-xs text-zinc-400">
                            {request.status === "REJECTED"
                              ? "Từ chối bởi"
                              : "Duyệt bởi"}{" "}
                            {request.decider.name}
                            {request.decisionNote
                              ? ` — ${request.decisionNote}`
                              : ""}
                          </p>
                        )}
                      </div>
                      <span className={`tf-badge shrink-0 ${status.className}`}>
                        {status.label}
                      </span>
                      {canCancelLeave(request, today) && (
                        <LeaveCancelButton requestId={request.id} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {upcoming.length > 0 && (
            <section className="tf-panel overflow-hidden">
              <div className="border-b border-zinc-100 px-5 py-3">
                <h2 className="font-semibold">Lịch nghỉ sắp tới</h2>
              </div>
              <ul className="divide-y divide-zinc-50">
                {upcoming.map((request) => (
                  <li key={request.id} className="px-5 py-3">
                    <p className="text-xs font-semibold text-zinc-600">
                      {request.user.name}
                    </p>
                    <LeaveSummaryLine request={request} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
