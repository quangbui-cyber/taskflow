import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePrepilot, prepilotSectionFlags, type PrepilotInput } from "../lib/crm/prepilot";

const seed: PrepilotInput = {
  cadenceWeeksRaw: { S: 2, A: 4, B: 8, C: 13, UNRATED: 4 },
  potentialScaleRaw: [],
  tierMatrixRaw: { revenueBands: [], cells: {} },
  pipelineModeRaw: { mode: "PROJECT_OFFICIAL", pilotTeamIds: [], plannedCutoverDate: null },
  teams: [{ id: "t1", name: "Team Một", activeManagerCount: 0 }, { id: "t2", name: "Team Hai", activeManagerCount: 0 }],
  activeStewardCount: 0,
  reasons: ["LOST", "CANCELLED", "DECLINED"].map((group) => ({ group, active: true, requiresNote: true })),
  today: "2026-11-09",
};

const item = (key: string, overrides: Partial<PrepilotInput> = {}) =>
  evaluatePrepilot({ ...seed, ...overrides }).items.find((row) => row.key === key)!;

test("seeded defaults report only configured persisted inputs and preserve item order", () => {
  const result = evaluatePrepilot(seed);
  assert.deepEqual(result.items.map(({ key }) => key), [
    "TIER_CADENCE", "POTENTIAL_SCALE", "TIER_MATRIX", "PERSONA_DEPTH", "PILOT_TEAM", "TEAM_MANAGERS", "DATA_STEWARD",
    "ACCESS_LIST", "PLANNED_CUTOVER", "REASONS_LOST", "REASONS_CANCELLED", "REASONS_DECLINED",
  ]);
  assert.deepEqual(result.missing, ["POTENTIAL_SCALE", "TIER_MATRIX", "PERSONA_DEPTH", "PILOT_TEAM", "TEAM_MANAGERS", "DATA_STEWARD"]);
  assert.equal(result.ready, false);
  assert.equal(item("TIER_CADENCE").detail, "S 2 · A 4 · B 8 · C 13 · Chưa xếp hạng 4 tuần");
  assert.equal(item("PLANNED_CUTOVER").status, "NOT_APPLICABLE");
});

test("missing or invalid persisted tier rows do not inherit application defaults", () => {
  assert.equal(item("POTENTIAL_SCALE", { potentialScaleRaw: null }).status, "NOT_CONFIGURED");
  for (const cadenceWeeksRaw of [null, { S: 2, A: 4, B: 8, C: 13 }, { S: 2, A: 4, B: 8, C: 13, UNRATED: 0 }]) {
    assert.equal(item("TIER_CADENCE", { cadenceWeeksRaw }).status, "NOT_CONFIGURED");
  }
});

test("pilot fallback needs a valid cutover date on or after today, using VN date copy", () => {
  const pipeline = { mode: "PROJECT_OFFICIAL", pilotTeamIds: ["t1"] };
  const date = (plannedCutoverDate: unknown) => item("PLANNED_CUTOVER", { pipelineModeRaw: { ...pipeline, plannedCutoverDate } });
  assert.deepEqual([date(null).status, date(null).detail], ["NOT_CONFIGURED", "Chưa đặt ngày"]);
  assert.deepEqual([date("2026-11-08").status, date("2026-11-08").detail], ["NOT_CONFIGURED", "Ngày đã qua: 08/11/2026"]);
  assert.equal(date("2026-11-09").status, "CONFIGURED");
  assert.equal(date("2026-11-10").status, "CONFIGURED");
  assert.equal(date("2026-11-31").status, "NOT_CONFIGURED");
  assert.equal(item("PLANNED_CUTOVER", { pipelineModeRaw: { ...pipeline, mode: "OPPORTUNITY_OFFICIAL", plannedCutoverDate: null } }).status, "NOT_APPLICABLE");
});

test("a missing team is reported and manager scope follows valid pilot selection", () => {
  const pipeline = { mode: "PROJECT_OFFICIAL", plannedCutoverDate: null };
  const gone = item("PILOT_TEAM", { pipelineModeRaw: { ...pipeline, pilotTeamIds: ["gone"] } });
  assert.deepEqual([gone.status, gone.detail], ["NOT_CONFIGURED", "Team không còn tồn tại"]);
  const selected = item("TEAM_MANAGERS", { pipelineModeRaw: { ...pipeline, pilotTeamIds: ["t1"] } });
  assert.equal(selected.status, "NOT_CONFIGURED");
  assert.match(selected.detail, /Team Một/);
  assert.doesNotMatch(selected.detail, /Team Hai/);
  assert.match(item("TEAM_MANAGERS").detail, /Team Một.*Team Hai/);
});

test("each reason group needs an active note-required option", () => {
  for (const group of ["LOST", "CANCELLED", "DECLINED"]) {
    for (const reasons of [[{ group, active: false, requiresNote: true }], [{ group, active: true, requiresNote: false }]]) {
      assert.equal(item(`REASONS_${group}`, { reasons }).status, "NOT_CONFIGURED");
    }
    assert.equal(item(`REASONS_${group}`).status, "CONFIGURED");
  }
});

test("fully persisted readiness sets all Admin warning flags false", () => {
  const ready: PrepilotInput = {
    ...seed,
    potentialScaleRaw: [{ key: "high", label: "Cao" }],
    tierMatrixRaw: { revenueBands: [{ key: "base", label: "Cơ sở", minPercentile: 0 }], cells: { base: { high: "A" } } },
    personaDepthRaw: { S: [], A: [], B: [], C: [], UNRATED: [] },
    pipelineModeRaw: { mode: "PROJECT_OFFICIAL", pilotTeamIds: ["t1"], plannedCutoverDate: "2026-11-10" },
    teams: [{ ...seed.teams[0], activeManagerCount: 1 }, seed.teams[1]],
    activeStewardCount: 1,
    crmAccessUserCount: 2,
  };
  const result = evaluatePrepilot(ready);
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(prepilotSectionFlags(result), { TIER: false, ACCESS: false, SOURCE: false, REASONS: false, PERSONA: false, ACCESS_LIST: false });
  const warnings = evaluatePrepilot({ ...ready, cadenceWeeksRaw: null, reasons: [] });
  assert.deepEqual(prepilotSectionFlags(warnings), { TIER: true, ACCESS: false, SOURCE: false, REASONS: true, PERSONA: false, ACCESS_LIST: false });
  const pendingPersona = evaluatePrepilot({ ...ready, personaDepthRaw: null });
  assert.deepEqual(prepilotSectionFlags(pendingPersona), { TIER: false, ACCESS: false, SOURCE: false, REASONS: false, PERSONA: true, ACCESS_LIST: false }, "pending persona must not mark an already configured tier matrix as missing");
});

test("persona readiness needs an explicit choice for every tier and rejects malformed stored policy", () => {
  const complete = { S: ["budgetSeason"], A: ["vendorSelection"], B: [], C: [], UNRATED: [] };
  assert.equal(item("PERSONA_DEPTH", { personaDepthRaw: complete }).status, "CONFIGURED");
  for (const personaDepthRaw of [null, {}, { ...complete, C: null }, { ...complete, UNRATED: ["unknown"] }]) {
    assert.equal(item("PERSONA_DEPTH", { personaDepthRaw }).status, "NOT_CONFIGURED");
  }
});

test("crm54: an empty CRM access list warns in its own section but never blocks readiness", () => {
  const ready: PrepilotInput = {
    ...seed,
    potentialScaleRaw: [{ key: "high", label: "Cao" }],
    tierMatrixRaw: { revenueBands: [{ key: "base", label: "Cơ sở", minPercentile: 0 }], cells: { base: { high: "A" } } },
    personaDepthRaw: { S: [], A: [], B: [], C: [], UNRATED: [] },
    pipelineModeRaw: { mode: "PROJECT_OFFICIAL", pilotTeamIds: ["t1"], plannedCutoverDate: "2026-11-10" },
    teams: [{ ...seed.teams[0], activeManagerCount: 1 }, seed.teams[1]],
    activeStewardCount: 1,
  };
  for (const crmAccessUserCount of [undefined, 0]) {
    const result = evaluatePrepilot({ ...ready, crmAccessUserCount });
    const access = result.items.find(({ key }) => key === "ACCESS_LIST")!;
    assert.deepEqual([access.status, access.section, access.label, access.detail], ["NOT_CONFIGURED", "ACCESS_LIST", "Người dùng CRM", "Chỉ Admin"]);
    assert.equal(result.ready, true);
    assert.deepEqual(result.missing, []);
    assert.equal(prepilotSectionFlags(result).ACCESS_LIST, true);
  }
  const listed = evaluatePrepilot({ ...ready, crmAccessUserCount: 3 }).items.find(({ key }) => key === "ACCESS_LIST")!;
  assert.deepEqual([listed.status, listed.detail], ["CONFIGURED", "3 người ngoài Admin"]);
});
