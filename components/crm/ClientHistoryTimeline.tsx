import Link from "next/link";
import { Star } from "lucide-react";
import ProjectFeedbackDialog from "./ProjectFeedbackDialog";
import { formatShortVnd, type HistoryGrid } from "@/lib/crm/clientHub";
import { CASE_STUDY_OPTIONS } from "@/lib/crm/clientHubLabels";
import { vnDateKey } from "@/lib/crm/dates";

type Program = { code: string; label: string; color: string };
type ProjectRow = { id: string; name: string; programLabel: string; date: Date | null; revenue: number | null; feedback: { rating: number; note: string | null; caseStudy: string } | null; canRate: boolean };
const COL0 = 80, COL = 65, TOP = 34, ROW = 46;
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const monthYear = (date: Date | null) => { if (!date) return "Chưa có ngày"; const [y, m] = vnDateKey(date).split("-"); return `${m}/${y}`; };
const CASE_TONE: Record<string, string> = { ALLOWED: "bg-brand-50 text-brand-700", NOT_ASKED: "bg-zinc-100 text-zinc-500", DENIED: "bg-[#fff1ec] text-[#c2410c]" };

function Stars({ rating }: { rating: number }) {
  return <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${rating} trên 5 sao`}>
    {[1, 2, 3, 4, 5].map((value) => <Star key={value} size={13} aria-hidden="true" className={value <= rating ? "fill-brand-400 text-brand-500" : "text-zinc-300"} />)}
  </span>;
}

/** Year x month grid of recognized Projects (dot size by revenue, colour by program) and open Opportunities (dashed). */
export default function ClientHistoryTimeline({ clientId, grid, projects, programs, showRevenue }: { clientId: string; grid: HistoryGrid; projects: ProjectRow[]; programs: Program[]; showRevenue: boolean }) {
  const color = (code: string) => programs.find((program) => program.code === code)?.color ?? "#a1a1aa";
  const label = (code: string) => programs.find((program) => program.code === code)?.label ?? code;
  const height = TOP + grid.years.length * ROW;
  const cells = new Map<string, typeof grid.points>();
  for (const point of grid.points) { const key = `${point.year}-${point.month}`; cells.set(key, [...(cells.get(key) ?? []), point]); }
  const used = [...new Set(grid.points.map((point) => point.programCode))];
  const hasOpen = grid.points.some((point) => point.kind === "OPPORTUNITY");
  return <div className="space-y-4">
    {grid.points.length ? <>
      <figure className="min-w-0">
        <svg viewBox={`0 0 ${COL0 + 11 * COL + 40} ${height}`} width="100%" role="img" aria-labelledby="client-history-svg-title" className="block">
          <title id="client-history-svg-title">Dự án và Cơ hội đang mở theo năm và tháng</title>
          <g fontSize="11" fill="#a1a1aa">
            {MONTHS.map((month) => <text key={month} x={COL0 + (month - 1) * COL} y={14} textAnchor="middle">T{month}</text>)}
            {grid.years.map((year, i) => <text key={year} x={0} y={TOP + i * ROW + 4}>{year}</text>)}
          </g>
          <g stroke="#f1f1f3">{grid.years.map((year, i) => <line key={year} x1={50} x2={COL0 + 11 * COL + 30} y1={TOP + i * ROW} y2={TOP + i * ROW} />)}</g>
          {[...cells].map(([key, points]) => points.map((point, index) => {
            const row = grid.years.indexOf(point.year);
            const cx = COL0 + (point.month - 1) * COL + (index - (points.length - 1) / 2) * 12;
            const cy = TOP + row * ROW;
            const name = `${point.name} · ${label(point.programCode)} · ${String(point.month).padStart(2, "0")}/${point.year}${point.kind === "OPPORTUNITY" ? " · Cơ hội đang mở" : ""}`;
            return point.kind === "PROJECT"
              ? <circle key={`${key}-${point.id}`} cx={cx} cy={cy} r={point.radius} fill={color(point.programCode)} fillOpacity={0.9}><title>{name}</title></circle>
              : <circle key={`${key}-${point.id}`} cx={cx} cy={cy} r={point.radius} fill="none" stroke={color(point.programCode)} strokeWidth={2} strokeDasharray="3 3"><title>{name}</title></circle>;
          }))}
        </svg>
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600" aria-hidden="true">
          {used.map((code) => <span key={code} className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-full" style={{ background: color(code) }} />{label(code)}</span>)}
          {hasOpen && <span className="inline-flex items-center gap-1.5 text-zinc-500"><i className="inline-block size-2.5 rounded-full border-[1.5px] border-dashed border-zinc-400" />Cơ hội đang mở</span>}
          {grid.olderCount > 0 && <span className="text-zinc-500">{grid.olderCount} mục trước {grid.years[0]}</span>}
        </figcaption>
      </figure>
      <table className="sr-only">
        <caption>Bảng thay thế cho lưới lịch sử hợp tác</caption>
        <thead><tr><th scope="col">Tháng</th><th scope="col">Loại</th><th scope="col">Tên</th><th scope="col">Chương trình</th></tr></thead>
        <tbody>{grid.points.map((point) => <tr key={point.id}><td>{String(point.month).padStart(2, "0")}/{point.year}</td><td>{point.kind === "PROJECT" ? "Dự án" : "Cơ hội đang mở"}</td><td>{point.name}</td><td>{label(point.programCode)}</td></tr>)}</tbody>
      </table>
    </> : <p className="text-sm text-zinc-500">Chưa có dự án hay Cơ hội có thời gian.</p>}
    {projects.length > 0 && <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <caption className="sr-only">Dự án đã ghi nhận và đánh giá của khách</caption>
        <thead className="text-xs text-zinc-500"><tr className="border-b border-zinc-100">
          <th scope="col" className="px-1 py-2 font-normal">Thời gian</th><th scope="col" className="px-1 py-2 font-normal">Dự án</th>
          {showRevenue && <th scope="col" className="px-1 py-2 text-right font-normal">Doanh thu</th>}
          <th scope="col" className="px-1 py-2 font-normal">Đánh giá của khách</th><th scope="col" className="px-1 py-2 font-normal">Case study</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-100">{projects.map((project) => {
          const caseStudy = project.feedback ? CASE_STUDY_OPTIONS.find((option) => option.key === project.feedback!.caseStudy) : null;
          return <tr key={project.id} className="align-top">
            <td className="whitespace-nowrap px-1 py-2.5 tabular-nums text-zinc-500">{monthYear(project.date)}</td>
            <td className="min-w-0 px-1 py-2.5"><Link href={`/projects/${project.id}`} className="font-semibold hover:underline">{project.name}</Link><span className="text-zinc-500"> · {project.programLabel}</span>{project.feedback?.note && <p className="mt-0.5 break-words text-xs text-zinc-500">{project.feedback.note}</p>}</td>
            {showRevenue && <td className="whitespace-nowrap px-1 py-2.5 text-right tabular-nums">{project.revenue === null ? "" : formatShortVnd(project.revenue)}</td>}
            <td className="whitespace-nowrap px-1 py-2.5"><span className="inline-flex items-center gap-2">{project.feedback ? <Stars rating={project.feedback.rating} /> : <span className="rounded-full bg-[#fff7e6] px-2 py-0.5 text-xs text-[#b86a08]">Chưa đánh giá</span>}{project.canRate && <ProjectFeedbackDialog clientId={clientId} projectId={project.id} projectName={project.name} feedback={project.feedback} />}</span></td>
            <td className="whitespace-nowrap px-1 py-2.5">{caseStudy ? <span className={`rounded-full px-2 py-0.5 text-xs ${CASE_TONE[caseStudy.key]}`}>{caseStudy.label}</span> : <span className="text-zinc-400">-</span>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
  </div>;
}
