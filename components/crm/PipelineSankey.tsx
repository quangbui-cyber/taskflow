"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { layoutPipelineFlow, pipelineFlowRows, type FlowItem, type PipelineFlow } from "@/lib/crm/pipelineFlow";

const W = 1060, H = 300, LEFT = 170, RIGHT = 170, TOP = 26;
const LIST_LIMIT = 10;
type Active = { title: string; count: number; items: FlowItem[] } | null;

/** crm51 (sketch 006 screen 5): hand-written SVG sankey, no chart library. Narrow screens get a vertical funnel. */
export default function PipelineSankey({ flow }: { flow: PipelineFlow }) {
  const layout = useMemo(() => layoutPipelineFlow(flow, { width: W - LEFT - RIGHT, height: H, nodeWidth: 14, gap: 16 }), [flow]);
  const rows = useMemo(() => pipelineFlowRows(flow), [flow]);
  const [active, setActive] = useState<Active>(null);
  const [pinned, setPinned] = useState<Active>(null);
  const shown = active ?? pinned;
  const label = new Map(flow.nodes.map(n => [n.key, n.label]));
  const nodeItems = (key: string) => {
    const incoming = flow.links.filter(l => l.target === key);
    return (incoming.length ? incoming : flow.links.filter(l => l.source === key)).flatMap(l => l.items);
  };
  if (!flow.total) return <p className="py-6 text-center text-sm text-zinc-500">Chưa có Cơ hội trong kỳ này.</p>;
  const summary = `Dòng chảy ${flow.total} Cơ hội: ${flow.nodes.filter(n => n.kind !== "source").map(n => `${n.label} ${n.value}`).join(", ")}.`;
  return <div className="relative min-w-0">
    <div className="hidden md:block">
      <svg viewBox={`0 0 ${W} ${H + TOP + 12}`} width="100%" role="img" aria-label={summary} className="h-auto overflow-visible" onMouseLeave={() => setActive(null)}>
        <g transform={`translate(${LEFT},${TOP})`}>
          <g fill="none">
            {layout.links.map(link => {
              const title = `${label.get(link.source)} → ${label.get(link.target)}`;
              const on = shown?.title === title;
              return <path key={`${link.source}>${link.target}`} d={link.path} stroke={link.tone} strokeWidth={Math.max(1.5, link.thickness)} strokeOpacity={on ? 0.7 : shown ? 0.18 : 0.35}
                className="cursor-pointer transition-[stroke-opacity] duration-150 motion-reduce:transition-none"
                onMouseEnter={() => setActive({ title, count: link.value, items: link.items })}
                onClick={() => setPinned(p => p?.title === title ? null : { title, count: link.value, items: link.items })}>
                <title>{`${title}: ${link.value}`}</title>
              </path>;
            })}
          </g>
          {layout.nodes.map(node => {
            const textY = node.y + node.height / 2 + 4;
            const text = `${node.label} ${node.value}`;
            return <g key={node.key} className="cursor-pointer" onMouseEnter={() => setActive({ title: node.label, count: node.value, items: nodeItems(node.key) })} onClick={() => setPinned(p => p?.title === node.label ? null : { title: node.label, count: node.value, items: nodeItems(node.key) })}>
              <rect x={node.x} y={node.y} width={node.width} height={Math.max(2, node.height)} rx={3} fill={node.tone} />
              {node.kind === "source" && <text x={node.x - 8} y={textY} textAnchor="end" className="fill-zinc-600 text-[12px]">{text}</text>}
              {node.kind === "stage" && <text x={node.x + node.width / 2} y={node.y - 8} textAnchor="middle" className="fill-zinc-900 text-[12px] font-semibold">{text}</text>}
              {node.kind === "end" && <text x={node.x + node.width + 8} y={textY} className={`text-[12px] ${node.key === "WON" ? "fill-zinc-900 font-semibold" : "fill-zinc-600"}`}>{text}</text>}
              <title>{text}</title>
            </g>;
          })}
        </g>
      </svg>
      <div aria-live="polite" className="mt-2 min-h-[44px] rounded-[12px] bg-zinc-50 px-3 py-2 text-[13px]">
        {shown ? <>
          <p className="font-semibold text-zinc-900">{shown.title} · {shown.count} Cơ hội</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-zinc-600">{shown.items.slice(0, LIST_LIMIT).map(item => <li key={item.id}><Link href={`/crm/opportunities/${item.id}`} className="hover:underline">{item.clientName} · {item.name}</Link></li>)}{shown.items.length > LIST_LIMIT && <li className="text-zinc-400">+{shown.items.length - LIST_LIMIT}</li>}</ul>
        </> : <p className="text-zinc-500">Rê chuột hoặc bấm vào một dòng để xem danh sách Cơ hội.</p>}
      </div>
    </div>
    <VerticalFunnel flow={flow} />
    <table className="sr-only">
      <caption>Dòng chảy Cơ hội theo nguồn, giai đoạn và kết quả</caption>
      <thead><tr><th scope="col">Từ</th><th scope="col">Đến</th><th scope="col">Số Cơ hội</th></tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.from}>${row.to}`}><td>{row.from}</td><td>{row.to}</td><td>{row.count}</td></tr>)}</tbody>
    </table>
  </div>;
}

/** Below md the sankey collapses into one bar per node, top to bottom: sources, stages, outcomes. */
function VerticalFunnel({ flow }: { flow: PipelineFlow }) {
  const groups = [
    { title: "Nguồn", nodes: flow.nodes.filter(n => n.kind === "source") },
    { title: "Giai đoạn", nodes: flow.nodes.filter(n => n.kind === "stage") },
    { title: "Kết quả", nodes: flow.nodes.filter(n => n.kind === "end") },
  ];
  return <div aria-hidden="true" className="space-y-3 md:hidden">
    {groups.map(group => <div key={group.title}>
      <p className="mb-1 text-xs font-semibold text-zinc-500">{group.title}</p>
      <ul className="space-y-1">{group.nodes.map(node => <li key={node.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_2rem] items-center gap-2 text-[13px]">
        <span className="truncate">{node.label}</span>
        <span className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><span className="block h-full rounded-full" style={{ width: `${node.value / flow.total * 100}%`, background: node.tone }} /></span>
        <span className="text-right tabular-nums">{node.value}</span>
      </li>)}</ul>
    </div>)}
  </div>;
}
