import { OPPORTUNITY_SOURCES } from "./labels";

/** One Opportunity created or closed in the report period. Display only; nothing here feeds revenue or KPI. */
export type FlowOpportunity = { id: string; name: string; clientName: string; source: string | null; stage: string; outcome: string | null };
export type FlowNodeKind = "source" | "stage" | "end";
export type FlowNode = { key: string; label: string; kind: FlowNodeKind; column: number; value: number; tone: string };
export type FlowItem = { id: string; name: string; clientName: string };
export type FlowLink = { source: string; target: string; value: number; items: FlowItem[] };
export type PipelineFlow = { nodes: FlowNode[]; links: FlowLink[]; total: number };

const SOURCE_TONES: Record<string, string> = { REPEAT: "#84cc16", REFERRAL: "#3f6212", INBOUND: "#a3a3a3", INDUSTRY_EVENT: "#60a5fa", OTHER: "#d4d4d8" };
const STAGES = [
  { key: "CARE", label: "Chăm sóc", column: 1 },
  { key: "BRIEF", label: "Brief", column: 2 },
  { key: "BIDDING", label: "Bidding", column: 3 },
] as const;
// End order puts the outcomes reached through Bidding on top so long Care exits run along the bottom.
const ENDS = [
  { key: "WON", label: "Thắng", tone: "#16a34a" },
  { key: "LOST", label: "Thua", tone: "#dc2626" },
  { key: "OPEN", label: "Đang mở", tone: "#a8d431" },
  { key: "CANCELLED", label: "Khách hủy", tone: "#fb923c" },
  { key: "DECLINED", label: "CS không tham gia", tone: "#a1a1aa" },
  { key: "UNCLEAR", label: "Chưa rõ kết quả", tone: "#d4d4d8" },
  { key: "NO_BRIEF", label: "Chưa ra Brief", tone: "#e4e4e7" },
] as const;
const OUTCOME_END: Record<string, string> = { WON: "WON", LOST_COMPETITIVE: "LOST", CUSTOMER_CANCELLED: "CANCELLED", CS_DECLINED: "DECLINED", LEGACY_UNCLASSIFIED: "UNCLEAR" };

function sourceKey(source: string | null): string {
  return OPPORTUNITY_SOURCES.some(s => s.key === source) ? source! : "OTHER";
}
/** Path of one Opportunity. The stage stays where it was closed (canClose), so it is the furthest stage reached. */
function pathOf(o: FlowOpportunity): string[] {
  const reachedBidding = o.stage === "BIDDING" || o.outcome === "WON" || o.outcome === "LOST_COMPETITIVE";
  const reachedBrief = reachedBidding || o.stage === "BRIEF";
  const end = o.outcome === null ? (reachedBrief ? "OPEN" : "NO_BRIEF") : OUTCOME_END[o.outcome] ?? "UNCLEAR";
  return [`SOURCE:${sourceKey(o.source)}`, "CARE", ...(reachedBrief ? ["BRIEF"] : []), ...(reachedBidding ? ["BIDDING"] : []), end];
}

export function buildPipelineFlow(opportunities: FlowOpportunity[]): PipelineFlow {
  if (!opportunities.length) return { nodes: [], links: [], total: 0 };
  const links = new Map<string, FlowLink>();
  const inflow = new Map<string, number>(), outflow = new Map<string, number>();
  for (const o of opportunities) {
    const path = pathOf(o);
    for (let i = 0; i < path.length - 1; i++) {
      const id = `${path[i]}>${path[i + 1]}`;
      const link = links.get(id) ?? { source: path[i], target: path[i + 1], value: 0, items: [] };
      link.value++; link.items.push({ id: o.id, name: o.name, clientName: o.clientName });
      links.set(id, link);
      outflow.set(path[i], (outflow.get(path[i]) ?? 0) + 1);
      inflow.set(path[i + 1], (inflow.get(path[i + 1]) ?? 0) + 1);
    }
  }
  const nodes: FlowNode[] = [
    ...OPPORTUNITY_SOURCES.filter(s => outflow.has(`SOURCE:${s.key}`)).map(s => ({ key: `SOURCE:${s.key}`, label: s.key === "OTHER" ? "Khác" : s.label, kind: "source" as const, column: 0, value: outflow.get(`SOURCE:${s.key}`)!, tone: SOURCE_TONES[s.key] })),
    ...STAGES.filter(s => inflow.has(s.key)).map(s => ({ key: s.key, label: s.label, kind: "stage" as const, column: s.column, value: inflow.get(s.key)!, tone: "#18181b" })),
    ...ENDS.filter(e => inflow.has(e.key)).map(e => ({ key: e.key, label: e.label, kind: "end" as const, column: 4, value: inflow.get(e.key)!, tone: e.tone })),
  ];
  const order = new Map(nodes.map((n, i) => [n.key, i]));
  const sorted = [...links.values()].sort((a, b) => order.get(a.source)! - order.get(b.source)! || order.get(a.target)! - order.get(b.target)!);
  return { nodes, links: sorted, total: opportunities.length };
}

export type LaidNode = FlowNode & { x: number; y: number; width: number; height: number };
export type LaidLink = FlowLink & { path: string; thickness: number; tone: string };
/** Pure SVG layout: columns left to right, node height and link thickness both proportional to count. */
export function layoutPipelineFlow(flow: PipelineFlow, box: { width: number; height: number; nodeWidth?: number; gap?: number }): { nodes: LaidNode[]; links: LaidLink[] } {
  if (!flow.nodes.length) return { nodes: [], links: [] };
  const nodeWidth = box.nodeWidth ?? 14, gap = box.gap ?? 14;
  const columns = [0, 1, 2, 3, 4].map(c => flow.nodes.filter(n => n.column === c));
  const used = columns.filter(c => c.length);
  const scale = Math.min(...used.map(c => (box.height - gap * (c.length - 1)) / c.reduce((s, n) => s + n.value, 0)));
  const x = (column: number) => column * (box.width - nodeWidth) / 4;
  const nodes: LaidNode[] = [];
  for (const column of columns) {
    let y = 0;
    for (const n of column) { const height = n.value * scale; nodes.push({ ...n, x: x(n.column), y, width: nodeWidth, height }); y += height + gap; }
  }
  const byKey = new Map(nodes.map(n => [n.key, n]));
  const outOffset = new Map<string, number>(), inOffset = new Map<string, number>();
  const links = flow.links.map(link => {
    const s = byKey.get(link.source)!, t = byKey.get(link.target)!;
    const thickness = link.value * scale;
    const sy = s.y + (outOffset.get(s.key) ?? 0) + thickness / 2, ty = t.y + (inOffset.get(t.key) ?? 0) + thickness / 2;
    outOffset.set(s.key, (outOffset.get(s.key) ?? 0) + thickness); inOffset.set(t.key, (inOffset.get(t.key) ?? 0) + thickness);
    const x0 = s.x + s.width, x1 = t.x, mid = (x0 + x1) / 2;
    const r = (n: number) => Math.round(n * 10) / 10;
    return { ...link, thickness, tone: s.kind === "source" ? s.tone : t.kind === "end" ? t.tone : "#a8d431", path: `M${r(x0)},${r(sy)} C${r(mid)},${r(sy)} ${r(mid)},${r(ty)} ${r(x1)},${r(ty)}` };
  });
  return { nodes, links };
}

/** Same numbers as the chart, as table rows for screen readers and the narrow-screen fallback. */
export function pipelineFlowRows(flow: PipelineFlow): { from: string; to: string; count: number }[] {
  const label = new Map(flow.nodes.map(n => [n.key, n.label]));
  return flow.links.map(l => ({ from: label.get(l.source)!, to: label.get(l.target)!, count: l.value }));
}

export type OrganizationMonthInput = { outcome: string | null; expectedMonth: number | null; expectedQuarter: number | null; contractValue: number | null; budgetMin: number | null; budgetMax: number | null };
/**
 * Won value (contract) and expected value (open budget midpoint) by organization month of one year.
 * Display only: the expected part is never added to revenue, KPI or reports (D-20). Quarter-only rows use the first month.
 */
export function organizationMonths(year: number, rows: OrganizationMonthInput[]) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, won: 0, expected: 0 }));
  let unknownWon = 0, unknownExpected = 0;
  for (const row of rows) {
    const month = row.expectedMonth && row.expectedMonth >= 1 && row.expectedMonth <= 12 ? row.expectedMonth : row.expectedQuarter && row.expectedQuarter >= 1 && row.expectedQuarter <= 4 ? (row.expectedQuarter - 1) * 3 + 1 : null;
    const won = row.outcome === "WON" ? row.contractValue ?? 0 : 0;
    const expected = row.outcome === null ? (row.budgetMin !== null && row.budgetMax !== null ? (row.budgetMin + row.budgetMax) / 2 : row.budgetMax ?? row.budgetMin ?? 0) : 0;
    if (month === null) { unknownWon += won; unknownExpected += expected; continue; }
    months[month - 1].won += won; months[month - 1].expected += expected;
  }
  return { year, months, unknownWon, unknownExpected, totalWon: months.reduce((s, m) => s + m.won, 0) + unknownWon, totalExpected: months.reduce((s, m) => s + m.expected, 0) + unknownExpected };
}

/** Funnel counts read from the same flow nodes as the sankey, so both views always agree. */
export function funnelFromFlow(flow: PipelineFlow) {
  const value = (key: string) => flow.nodes.find(n => n.key === key)?.value ?? 0;
  const pct = (a: number, b: number) => b ? Math.round(a / b * 100) : null;
  const opened = flow.total, brief = value("BRIEF"), bidding = value("BIDDING"), won = value("WON");
  return { opened, brief, bidding, won, briefRate: pct(brief, opened), biddingRate: pct(bidding, brief) };
}
