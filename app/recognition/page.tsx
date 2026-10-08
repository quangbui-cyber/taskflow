import Link from "next/link";
import type { Prisma } from "@prisma/client";
import {
  Globe2,
  HeartHandshake,
  Lock,
  MoreVertical,
  Sparkles,
  Star,
} from "lucide-react";
import Avatar from "@/components/Avatar";
import RecognitionComposer from "@/components/RecognitionComposer";
import RecognitionMonthSelect from "@/components/RecognitionMonthSelect";
import RecognitionWebhookSettings from "@/components/RecognitionWebhookSettings";
import Sidebar from "@/components/Sidebar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRecognitionWebhookStatus } from "@/lib/recognitionGoogleChat";
import {
  RECOGNITION_WEEKLY_STAR_LIMIT,
  recognitionCategoryLabel,
  recognitionMonthOptions,
  recognitionMonthRange,
  recognitionWeekRange,
} from "@/lib/recognitions";

type RecognitionView = "all" | "received" | "sent" | "webhook";

type Person = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type RankRow = {
  person: Person;
  count: number;
};

function recognitionTimeLabel(date: Date) {
  const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const time = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const day = dateFormatter.format(date);
  if (day === dateFormatter.format(now)) return `${time} · Hôm nay`;
  if (day === dateFormatter.format(yesterday)) return `${time} · Hôm qua`;
  return `${time} · ${day}`;
}

function buildRanking(
  recognitions: Array<{ senderId: string; recipientId: string }>,
  people: Map<string, Person>,
  mode: "received" | "sent"
): RankRow[] {
  const groups = new Map<string, Set<string>>();
  for (const recognition of recognitions) {
    const personId = mode === "received" ? recognition.recipientId : recognition.senderId;
    const counterpartId = mode === "received" ? recognition.senderId : recognition.recipientId;
    const counterparts = groups.get(personId) ?? new Set<string>();
    counterparts.add(counterpartId);
    groups.set(personId, counterparts);
  }

  return [...groups.entries()]
    .flatMap(([personId, counterparts]) => {
      const person = people.get(personId);
      return person ? [{ person, count: counterparts.size }] : [];
    })
    .sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name, "vi"))
    .slice(0, 3);
}

function RankingList({
  title,
  subtitle,
  rows,
  mode,
}: {
  title: string;
  subtitle: string;
  rows: RankRow[];
  mode: "received" | "sent";
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col border-b border-zinc-200 py-6">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 text-[11px] text-zinc-500">{subtitle}</p>
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-8 text-center text-xs leading-5 text-zinc-400">
          Những ngôi sao đầu tiên<br />sẽ xuất hiện tại đây.
        </div>
      ) : (
        <ol className="flex flex-1 flex-col justify-evenly gap-4 pt-4">
          {rows.map(({ person, count }) => (
            <li key={person.id} className="flex items-center gap-3">
              <Avatar
                id={person.id}
                name={person.name}
                avatarUrl={person.avatarUrl}
                className="h-11 w-11 text-sm"
              />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-semibold text-zinc-900">
                  {person.name}
                </strong>
                <small className="block truncate text-[10px] text-zinc-500">
                  {mode === "received" ? "Nhận từ" : "Gửi đến"} {count} người khác nhau
                </small>
              </span>
              <strong className="flex flex-col items-end text-sm font-semibold tabular-nums text-brand-600">
                {count}
                <small className="text-[9px] font-medium">người</small>
              </strong>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function RecognitionPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; focus?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const requestedView: RecognitionView =
    params.view === "received" || params.view === "sent" || params.view === "webhook"
      ? params.view
      : "all";
  const view: RecognitionView =
    requestedView === "webhook" && user.role !== "ADMIN" ? "all" : requestedView;
  const month = recognitionMonthRange(params.month);
  const currentWeek = recognitionWeekRange();
  const dateWhere = { gte: month.start, lt: month.end };

  const feedWhere: Prisma.RecognitionWhereInput = {
    createdAt: dateWhere,
    ...(view === "received"
      ? { recipientId: user.id }
      : view === "sent"
        ? { senderId: user.id }
        : {
            OR: [
              { visibility: "COMPANY" },
              { senderId: user.id },
              { recipientId: user.id },
            ],
          }),
  };

  const [people, recognitions, rankingSource, sidebarProjects, sentThisWeek] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
    prisma.recognition.findMany({
      where: feedWhere,
      include: {
        sender: { select: { id: true, name: true, avatarUrl: true } },
        recipient: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.recognition.findMany({
      where: { createdAt: dateWhere },
      select: { senderId: true, recipientId: true },
    }),
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
    prisma.recognition.count({
      where: {
        senderId: user.id,
        createdAt: { gte: currentWeek.start, lt: currentWeek.end },
      },
    }),
  ]);

  const remainingStars = Math.max(
    0,
    RECOGNITION_WEEKLY_STAR_LIMIT - sentThisWeek
  );

  const peopleById = new Map(people.map((person) => [person.id, person]));
  const shining = buildRanking(rankingSource, peopleById, "received");
  const giving = buildRanking(rankingSource, peopleById, "sent");
  const webhookStatus =
    view === "webhook" ? await getRecognitionWebhookStatus() : null;
  const monthOptions = recognitionMonthOptions();
  if (!monthOptions.some((option) => option.key === month.key)) {
    const [year, monthNumber] = month.key.split("-").map(Number);
    monthOptions.push({ key: month.key, label: `Tháng ${monthNumber}/${year}` });
  }

  const tabHref = (nextView: RecognitionView) => {
    const query = new URLSearchParams();
    if (nextView !== "all") query.set("view", nextView);
    if (month.key !== monthOptions[0]?.key) query.set("month", month.key);
    const value = query.toString();
    return value ? `/recognition?${value}` : "/recognition";
  };

  const tabs: Array<{ key: RecognitionView; label: string }> = [
    { key: "all", label: "Mọi người" },
    { key: "received", label: "Dành cho tôi" },
    { key: "sent", label: "Tôi đã gửi" },
    ...(user.role === "ADMIN"
      ? ([{ key: "webhook", label: "Webhook" }] as const)
      : []),
  ];

  return (
    <div className="tf-shell">
      <Sidebar user={user} projects={sidebarProjects} activeSection="recognition" />

      <main className="tf-main">
        <div className="tf-page !max-w-[1220px] !pt-12">
          <header className="mb-[54px] flex items-start justify-between gap-5">
            <div>
              <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em] text-zinc-950">
                Góc cảm ơn
              </h1>
              <p className="mt-1.5 text-sm text-zinc-500">
                Một lời cảm ơn nhỏ có thể làm ngày làm việc tốt hơn.
              </p>
            </div>
            {view !== "webhook" && (
              <RecognitionComposer
                recipients={people
                  .filter((person) => person.id !== user.id)
                  .map(({ id, name }) => ({ id, name }))}
                remainingStars={remainingStars}
                weeklyLimit={RECOGNITION_WEEKLY_STAR_LIMIT}
              />
            )}
          </header>

          <div
            className={
              view === "webhook"
                ? "max-w-4xl"
                : "grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_322px]"
            }
          >
            <section className="tf-panel overflow-hidden">
              <div className="flex min-h-20 items-stretch justify-between gap-4 border-b border-zinc-200 px-5">
                <nav className="flex min-w-0 gap-2 sm:gap-5" aria-label="Lọc lời cảm ơn">
                  {tabs.map((tab) => (
                    <Link
                      key={tab.key}
                      href={tabHref(tab.key)}
                      aria-current={view === tab.key ? "page" : undefined}
                      className={`relative flex min-h-20 items-center px-1.5 text-xs transition-colors sm:px-2.5 sm:text-sm ${
                        view === tab.key
                          ? "font-semibold text-zinc-900 after:absolute after:inset-x-1.5 after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-brand-400 sm:after:inset-x-2.5"
                          : "text-zinc-500 hover:text-zinc-800"
                      }`}
                    >
                      {tab.label}
                    </Link>
                  ))}
                </nav>
                {view !== "webhook" && (
                  <div className="hidden items-center sm:flex">
                    <RecognitionMonthSelect value={month.key} options={monthOptions} />
                  </div>
                )}
              </div>

              {view === "webhook" && webhookStatus ? (
                <RecognitionWebhookSettings
                  configured={webhookStatus.configured}
                  source={webhookStatus.source}
                  updatedAt={
                    webhookStatus.updatedAt
                      ? new Intl.DateTimeFormat("vi-VN", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          timeZone: "Asia/Ho_Chi_Minh",
                        }).format(webhookStatus.updatedAt)
                      : null
                  }
                />
              ) : (
                <>
                  <div className="border-b border-zinc-200 px-5 sm:hidden">
                    <RecognitionMonthSelect value={month.key} options={monthOptions} compact />
                  </div>

                  {recognitions.length === 0 ? (
                <div className="flex min-h-[540px] flex-col items-center justify-center px-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Sparkles size={25} aria-hidden="true" />
                  </span>
                  <h2 className="mt-4 text-lg font-semibold text-zinc-800">
                    Chưa có ngôi sao nào trong tháng này
                  </h2>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">
                    Một lời cảm ơn chân thành là cách tuyệt vời để bắt đầu dải ngân hà của cả nhóm.
                  </p>
                </div>
                  ) : (
                <div className="px-5">
                  {recognitions.map((recognition) => {
                    const focused = params.focus === recognition.id;
                    return (
                      <article
                        key={recognition.id}
                        id={`recognition-${recognition.id}`}
                        className={`relative grid min-h-[258px] grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-zinc-200 py-8 last:border-b-0 sm:grid-cols-[58px_minmax(0,1fr)_auto] sm:gap-4 sm:py-9 ${
                          focused ? "-mx-3 rounded-[8px] bg-brand-50/65 px-3 ring-2 ring-brand-200" : ""
                        }`}
                      >
                        <Avatar
                          id={recognition.sender.id}
                          name={recognition.sender.name}
                          avatarUrl={recognition.sender.avatarUrl}
                          className="h-12 w-12 text-base sm:h-[58px] sm:w-[58px]"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-x-1.5 pr-10 text-sm leading-6 text-zinc-700 sm:pr-0 sm:text-[15px]">
                            <strong className="font-semibold text-zinc-900">{recognition.sender.name}</strong>
                            <span>gửi một ngôi sao đến</span>
                            <strong className="font-semibold text-zinc-900">{recognition.recipient.name}</strong>
                          </div>
                          <Star
                            size={25}
                            fill="currentColor"
                            className="my-3.5 text-brand-400"
                            aria-label="Một ngôi sao"
                          />
                          <p className="max-w-xl text-sm leading-6 text-zinc-700">
                            {recognition.message}
                          </p>
                          <span className="mt-4 flex w-fit items-center gap-1.5 rounded-[6px] bg-brand-50 px-2.5 py-1.5 text-xs text-brand-800">
                            <HeartHandshake size={14} aria-hidden="true" />
                            {recognitionCategoryLabel(recognition.category)}
                          </span>
                          <span className="mt-3.5 flex w-fit items-center gap-1.5 text-xs text-zinc-500">
                            {recognition.visibility === "PRIVATE" ? (
                              <Lock size={14} aria-hidden="true" />
                            ) : (
                              <Globe2 size={14} aria-hidden="true" />
                            )}
                            {recognition.visibility === "PRIVATE"
                              ? "Chỉ người gửi và người nhận"
                              : "Công khai trong công ty"}
                          </span>
                        </div>
                        <div className="hidden items-start gap-1.5 sm:flex">
                          <time className="whitespace-nowrap pt-2.5 text-xs text-zinc-500">
                            {recognitionTimeLabel(recognition.createdAt)}
                          </time>
                          <Avatar
                            id={recognition.recipient.id}
                            name={recognition.recipient.name}
                            avatarUrl={recognition.recipient.avatarUrl}
                            className="h-[58px] w-[58px] shrink-0 text-base"
                          />
                          <button
                            type="button"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] text-zinc-500 hover:bg-zinc-100"
                            aria-label="Mở menu lời cảm ơn"
                          >
                            <MoreVertical size={18} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="absolute right-0 top-7 sm:hidden">
                          <button
                            type="button"
                            className="flex h-9 w-9 items-center justify-center rounded-[7px] text-zinc-500 hover:bg-zinc-100"
                            aria-label="Mở menu lời cảm ơn"
                          >
                            <MoreVertical size={18} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                  )}
                </>
              )}
            </section>

            {view !== "webhook" && (
              <aside className="tf-panel flex min-h-[680px] flex-col px-5 py-6 xl:min-h-[854px]">
              <header>
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-zinc-950">
                  Dải ngân hà nhà mình
                </h2>
                <p className="mt-1 text-sm text-zinc-500">Ai đang tỏa sáng tháng này?</p>
              </header>
              <div className="border-b border-zinc-200 py-2.5">
                <RecognitionMonthSelect value={month.key} options={monthOptions} compact />
              </div>
              <RankingList
                title="Những vì sao đang sáng"
                subtitle="Theo số người gửi khác nhau"
                rows={shining}
                mode="received"
              />
              <RankingList
                title="Hội những người gieo sao"
                subtitle="Theo số người nhận khác nhau"
                rows={giving}
                mode="sent"
              />
              <p className="pt-4 text-center text-[10px] leading-4 text-zinc-400">
                Làm mới mỗi tháng · Không dùng để đánh giá hiệu suất
              </p>
              </aside>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
