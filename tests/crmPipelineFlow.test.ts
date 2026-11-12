import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPipelineFlow, funnelFromFlow, layoutPipelineFlow, organizationMonths, pipelineFlowRows, type FlowOpportunity } from "../lib/crm/pipelineFlow";

let seq = 0;
const opp = (patch: Partial<FlowOpportunity>): FlowOpportunity => ({ id: `o${++seq}`, name: `Cơ hội ${seq}`, clientName: `Khách ${seq}`, source: "REPEAT", stage: "CARE", outcome: null, ...patch });
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function assertConserved(flow: ReturnType<typeof buildPipelineFlow>) {
  for (const node of flow.nodes) {
    const inflow = sum(flow.links.filter(l => l.target === node.key).map(l => l.value));
    const outflow = sum(flow.links.filter(l => l.source === node.key).map(l => l.value));
    if (node.kind === "stage") assert.equal(inflow, outflow, `${node.key} in ${inflow} out ${outflow}`);
    if (node.kind === "source") { assert.equal(inflow, 0); assert.equal(node.value, outflow); }
    if (node.kind === "end") { assert.equal(outflow, 0); assert.equal(node.value, inflow); }
    if (node.kind === "stage") assert.equal(node.value, inflow);
  }
}

test("every middle node conserves flow and totals match the input", () => {
  const rows = [
    opp({ source: "REPEAT", stage: "BIDDING", outcome: "WON" }),
    opp({ source: "REPEAT", stage: "BIDDING", outcome: "LOST_COMPETITIVE" }),
    opp({ source: "REFERRAL", stage: "BIDDING", outcome: null }),
    opp({ source: "REFERRAL", stage: "BRIEF", outcome: "CUSTOMER_CANCELLED" }),
    opp({ source: "INBOUND", stage: "BRIEF", outcome: null }),
    opp({ source: "INDUSTRY_EVENT", stage: "CARE", outcome: null }),
    opp({ source: "OTHER", stage: "CARE", outcome: "CS_DECLINED" }),
    opp({ source: "REPEAT", stage: "CARE", outcome: "LEGACY_UNCLASSIFIED" }),
  ];
  const flow = buildPipelineFlow(rows);
  assert.equal(flow.total, rows.length);
  assertConserved(flow);
  const node = (key: string) => flow.nodes.find(n => n.key === key)?.value ?? 0;
  assert.equal(node("CARE"), 8); assert.equal(node("BRIEF"), 5); assert.equal(node("BIDDING"), 3);
  assert.equal(node("WON"), 1); assert.equal(node("LOST"), 1); assert.equal(node("OPEN"), 2);
  assert.equal(node("CANCELLED"), 1); assert.equal(node("DECLINED"), 1); assert.equal(node("NO_BRIEF"), 1); assert.equal(node("UNCLEAR"), 1);
  assert.equal(sum(flow.nodes.filter(n => n.kind === "end").map(n => n.value)), rows.length);
  // Hover lists carry the exact Opportunities on each link.
  const won = flow.links.find(l => l.source === "BIDDING" && l.target === "WON")!;
  assert.deepEqual(won.items.map(i => i.id), [rows[0].id]);
});

test("missing or unknown source goes to the Khác group", () => {
  const flow = buildPipelineFlow([opp({ source: null }), opp({ source: "SOMETHING_NEW" }), opp({ source: "OTHER" })]);
  const sources = flow.nodes.filter(n => n.kind === "source");
  assert.deepEqual(sources.map(n => [n.key, n.label, n.value]), [["SOURCE:OTHER", "Khác", 3]]);
  assertConserved(flow);
});

test("an empty period yields no nodes and no links", () => {
  const flow = buildPipelineFlow([]);
  assert.deepEqual(flow, { nodes: [], links: [], total: 0 });
  assert.deepEqual(layoutPipelineFlow(flow, { width: 600, height: 300 }).nodes, []);
  assert.deepEqual(pipelineFlowRows(flow), []);
});

test("customer cancellation before Brief leaves Care directly and never touches Brief", () => {
  const flow = buildPipelineFlow([opp({ stage: "CARE", outcome: "CUSTOMER_CANCELLED" })]);
  assert.equal(flow.nodes.some(n => n.key === "BRIEF"), false);
  assert.deepEqual(flow.links.map(l => `${l.source}>${l.target}`), ["SOURCE:REPEAT>CARE", "CARE>CANCELLED"]);
  assertConserved(flow);
});

test("legacy won rows recorded outside Bidding still pass through Brief and Bidding", () => {
  const flow = buildPipelineFlow([opp({ stage: "CARE", outcome: "WON" })]);
  assert.deepEqual(flow.links.map(l => `${l.source}>${l.target}`), ["SOURCE:REPEAT>CARE", "CARE>BRIEF", "BRIEF>BIDDING", "BIDDING>WON"]);
  assertConserved(flow);
});

test("layout stacks nodes inside the box and link thickness follows value", () => {
  const rows = [opp({ stage: "BIDDING", outcome: "WON" }), opp({ stage: "BIDDING", outcome: "WON" }), opp({ source: "REFERRAL", stage: "CARE" })];
  const layout = layoutPipelineFlow(buildPipelineFlow(rows), { width: 800, height: 300 });
  for (const n of layout.nodes) {
    assert.ok(n.y >= 0 && n.y + n.height <= 300 + 1e-6, `${n.key} inside`);
    assert.ok(n.x >= 0 && n.x <= 800);
  }
  const care = layout.links.filter(l => l.source === "CARE");
  const wide = care.find(l => l.target === "BRIEF")!, thin = care.find(l => l.target === "NO_BRIEF")!;
  assert.ok(Math.abs(wide.thickness - 2 * thin.thickness) < 1e-6);
  assert.match(wide.path, /^M[\d.]+,[\d.]+ C/);
});

test("screen-reader rows list every link with its count", () => {
  const flow = buildPipelineFlow([opp({ stage: "BRIEF" })]);
  assert.deepEqual(pipelineFlowRows(flow), [
    { from: "Khách cũ mua lại", to: "Chăm sóc", count: 1 },
    { from: "Chăm sóc", to: "Brief", count: 1 },
    { from: "Brief", to: "Đang mở", count: 1 },
  ]);
});

test("organization months split won and expected value, quarter rows use the first month", () => {
  const result = organizationMonths(2026, [
    { outcome: "WON", expectedMonth: 3, expectedQuarter: null, contractValue: 900, budgetMin: 100, budgetMax: 200 },
    { outcome: null, expectedMonth: 3, expectedQuarter: null, contractValue: null, budgetMin: 100, budgetMax: 300 },
    { outcome: null, expectedMonth: null, expectedQuarter: 2, contractValue: null, budgetMin: null, budgetMax: 50 },
    { outcome: null, expectedMonth: null, expectedQuarter: null, contractValue: null, budgetMin: 10, budgetMax: null },
    { outcome: "LOST_COMPETITIVE", expectedMonth: 5, expectedQuarter: null, contractValue: 777, budgetMin: 1, budgetMax: 2 },
  ]);
  assert.deepEqual(result.months[2], { month: 3, won: 900, expected: 200 });
  assert.deepEqual(result.months[3], { month: 4, won: 0, expected: 50 });
  assert.deepEqual(result.months[4], { month: 5, won: 0, expected: 0 });
  assert.equal(result.unknownExpected, 10);
  assert.equal(result.totalWon, 900); assert.equal(result.totalExpected, 260);
});

test("funnel reads the same nodes as the sankey", () => {
  const flow = buildPipelineFlow([opp({ stage: "BIDDING", outcome: "WON" }), opp({ stage: "BRIEF" }), opp({ stage: "CARE" }), opp({ stage: "CARE", outcome: "CUSTOMER_CANCELLED" })]);
  assert.deepEqual(funnelFromFlow(flow), { opened: 4, brief: 2, bidding: 1, won: 1, briefRate: 50, biddingRate: 50 });
  assert.deepEqual(funnelFromFlow(buildPipelineFlow([])), { opened: 0, brief: 0, bidding: 0, won: 0, briefRate: null, biddingRate: null });
});
