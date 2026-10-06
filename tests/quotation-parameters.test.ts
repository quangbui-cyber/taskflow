import test from "node:test";
import assert from "node:assert/strict";
import { blankPairedRow, normalizePairedRows } from "../lib/costflow/pairedDraft";
import {
  applyParameterImpact,
  evaluateFormula,
  normalizeParameterSnapshot,
  parameterFinalizationIssues,
  previewParameterImpact,
  type FormulaNode,
  type QuotationParameterSnapshot,
} from "../lib/costflow/quotationParameters";

function snapshot(): QuotationParameterSnapshot {
  return {
    schemaVersion: 1,
    definitions: [
      { key: "participants", label: "Số người", defaultValue: "100", scope: "SHARED" },
      { key: "factor", label: "Hệ số", defaultValue: "2", scope: "SHARED" },
      { key: "missing", label: "Chưa nhập", defaultValue: "", scope: "SHARED" },
    ],
    sharedValues: { participants: "100", factor: "2", missing: "" },
    modules: [
      { id: "team", label: "Teambuilding", eventType: "Teambuilding", overrides: {} },
      { id: "gala", label: "Gala", eventType: "Gala", overrides: { participants: "80" } },
    ],
  };
}

test("typed evaluator supports PARAM, CONST, MUL, DIV, CEIL and FLOOR exactly", () => {
  const config = snapshot();
  assert.deepEqual(evaluateFormula({ op: "PARAM", key: "participants" }, config), { value: "100" });
  assert.deepEqual(evaluateFormula({ op: "PARAM", key: "participants", moduleId: "gala" }, config), { value: "80" });
  assert.deepEqual(evaluateFormula({ op: "CONST", value: "2.5" }, config), { value: "2.5" });
  assert.deepEqual(evaluateFormula({ op: "MUL", left: { op: "PARAM", key: "participants" }, right: { op: "CONST", value: "2" } }, config), { value: "200" });
  assert.deepEqual(evaluateFormula({ op: "DIV", left: { op: "PARAM", key: "participants" }, right: { op: "CONST", value: "4" } }, config), { value: "25" });
  const third: FormulaNode = { op: "DIV", left: { op: "CONST", value: "5" }, right: { op: "CONST", value: "2" } };
  assert.deepEqual(evaluateFormula({ op: "CEIL", value: third }, config), { value: "3" });
  assert.deepEqual(evaluateFormula({ op: "FLOOR", value: third }, config), { value: "2" });
});

test("module override wins over shared values and event labels remain suggestions", () => {
  const config = snapshot();
  for (const label of ["Teambuilding", "Conference", "Gala", "Activation", "Exhibition", "Production", "Custom mixed"]) {
    config.modules.push({ id: `module-${config.modules.length}`, label, eventType: label, overrides: {} });
  }
  const normalized = normalizeParameterSnapshot(config);
  assert.equal(normalized.modules.length, 9);
  assert.equal(evaluateFormula({ op: "PARAM", key: "participants" }, normalized, "team").value, "100");
  assert.equal(evaluateFormula({ op: "PARAM", key: "participants" }, normalized, "gala").value, "80");
});

test("normalizer rejects unknown operators, duplicates, negative values and excessive AST depth", () => {
  assert.throws(() => normalizeParameterSnapshot({ ...snapshot(), definitions: [...snapshot().definitions, snapshot().definitions[0]] }), /bị trùng/);
  assert.throws(() => normalizeParameterSnapshot({ ...snapshot(), sharedValues: { participants: "-1" } }), /không được âm/);
  const row = blankPairedRow("row");
  row.sell.parameterBinding = { mode: "FORMULA", quantityFormula: { op: "CONST", value: "1" } };
  const malformed = structuredClone(row) as unknown as { sell: { parameterBinding: { quantityFormula: { op: string } } } };
  malformed.sell.parameterBinding.quantityFormula = { op: "EXEC" };
  assert.throws(() => normalizePairedRows([malformed]), /Toán tử/);
  let deep: unknown = { op: "CONST", value: "1" };
  for (let i = 0; i < 13; i++) deep = { op: "CEIL", value: deep };
  const tooDeep = blankPairedRow("deep");
  (tooDeep.sell as unknown as { parameterBinding: unknown }).parameterBinding = { mode: "FORMULA", quantityFormula: deep };
  assert.throws(() => normalizePairedRows([tooDeep]), /độ sâu 12/);
});

test("semantic errors are row issues while draft structure stays valid", () => {
  const config = snapshot();
  assert.equal(evaluateFormula({ op: "PARAM", key: "unknown" }, config).issue?.code, "UNKNOWN_PARAMETER");
  assert.equal(evaluateFormula({ op: "PARAM", key: "missing" }, config).issue?.code, "MISSING_PARAMETER");
  assert.equal(evaluateFormula({ op: "DIV", left: { op: "CONST", value: "1" }, right: { op: "CONST", value: "0" } }, config).issue?.code, "DIVISION_BY_ZERO");
  assert.equal(evaluateFormula({ op: "DIV", left: { op: "CONST", value: "1" }, right: { op: "CONST", value: "3" } }, config).issue?.code, "INVALID_RESULT");
});

test("preview and apply preserve manual and overridden fields and keep sell and buy independent", () => {
  const computed = blankPairedRow("computed");
  computed.name = "Computed";
  computed.sell.quantity = "100";
  computed.sell.unitPrice = "10";
  computed.sell.parameterBinding = { mode: "PARAMETER", moduleId: "team", quantityFormula: { op: "PARAM", key: "participants" }, lastCalculated: { quantity: "100" } };
  computed.buy.quantity = "7";
  computed.buy.unitPrice = "4";
  const manual = blankPairedRow("manual");
  manual.name = "Manual";
  manual.sell.quantity = "3";
  manual.sell.unitPrice = "20";
  const overridden = blankPairedRow("overridden");
  overridden.name = "Override";
  overridden.sell.quantity = "99";
  overridden.sell.unitPrice = "1";
  overridden.sell.parameterBinding = { mode: "OVERRIDDEN", moduleId: "team", quantityFormula: { op: "PARAM", key: "participants" }, lastCalculated: { quantity: "100" } };
  const rows = normalizePairedRows([computed, manual, overridden]);
  const proposed = snapshot();
  proposed.sharedValues.participants = "120";
  const preview = previewParameterImpact(rows, snapshot(), proposed);
  assert.deepEqual(preview.affected.map(item => [item.rowId, item.side, item.field, item.oldValue, item.newValue]), [["computed", "sell", "quantity", "100", "120"]]);
  assert.equal(rows[0].sell.quantity, "100", "preview must be pure");
  const applied = applyParameterImpact(rows, snapshot(), preview);
  assert.equal(applied.rows[0].sell.quantity, "120");
  assert.equal(applied.rows[0].buy.quantity, "7");
  assert.equal(applied.rows[1].sell.quantity, "3");
  assert.equal(applied.rows[2].sell.quantity, "99");
  const stale = structuredClone(rows);
  stale[0].sell.unitPrice = "11";
  assert.throws(() => applyParameterImpact(stale, snapshot(), preview), /Bảng đã thay đổi/);
});

test("legacy rows without parameter configuration remain manual and snapshots are independent clones", () => {
  const row = blankPairedRow("legacy");
  row.name = "Legacy";
  row.sell.quantity = "1";
  row.sell.unitPrice = "100";
  assert.deepEqual(parameterFinalizationIssues([row], undefined, "sell"), []);
  const original = snapshot();
  const clone = normalizeParameterSnapshot(structuredClone(original));
  clone.sharedValues.participants = "999";
  clone.modules[0].overrides.participants = "12";
  assert.equal(original.sharedValues.participants, "100");
  assert.equal(original.modules[0].overrides.participants, undefined);
});

test("mixed Teambuilding and Gala rows share values with module-specific override", () => {
  const team = blankPairedRow("team-row");
  team.name = "Team guests";
  team.sell.quantity = "100";
  team.sell.unitPrice = "1";
  team.sell.parameterBinding = { mode: "PARAMETER", moduleId: "team", quantityFormula: { op: "PARAM", key: "participants" } };
  const gala = blankPairedRow("gala-row");
  gala.name = "Gala guests";
  gala.sell.quantity = "80";
  gala.sell.unitPrice = "1";
  gala.sell.parameterBinding = { mode: "PARAMETER", moduleId: "gala", quantityFormula: { op: "PARAM", key: "participants" } };
  const proposed = snapshot();
  proposed.sharedValues.participants = "110";
  proposed.modules.find(module => module.id === "gala")!.overrides.participants = "75";
  const preview = previewParameterImpact(normalizePairedRows([team, gala]), snapshot(), proposed);
  assert.deepEqual(preview.affected.map(item => [item.rowId, item.newValue]), [["team-row", "110"], ["gala-row", "75"]]);
});
