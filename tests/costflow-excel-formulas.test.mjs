import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  SETTLEMENT_EXPORT_FAMILIES,
  buildSettlementExportWorkbook,
  normalizeSettlementExportProjection,
} from "../lib/costflow/export.ts";
import {
  aggregateSettlementVnd,
  balanceSettlementComponents,
  roundSettlementVnd,
} from "../lib/costflow/projectSettlement.ts";

const FAMILY_NAMES = [
  "QUOTATION",
  "CUSTOMER_ACCEPTANCE",
  "DNTU",
  "DNTT",
  "DNHTU",
  "PROJECT_SETTLEMENT",
];

function immutableProjection(overrides = {}) {
  return {
    projectId: "project-export",
    projectName: "Jabil POSM",
    family: "PROJECT_SETTLEMENT",
    source: {
      dossierId: "dossier-1",
      dossierVersionId: "dossier-version-2",
      dossierVersion: 2,
      documentVersionId: "workflow-version-4",
      documentVersion: 4,
      state: "APPROVED",
      supersedesId: "dossier-version-1",
      replacedById: null,
      replacementReason: "B02 reopen with a new immutable source",
    },
    title: "Quyết toán dự án",
    approvedAt: "2026-10-11T02:00:00.000Z",
    totals: {
      rawNet: "20000001/2",
      rawVat: "1600001/2",
      rawGross: "10800001/1",
      net: "10000001",
      vat: "800000",
      gross: "10800001",
    },
    recipients: [
      {
        recipientKey: "USER:account-a",
        recipientType: "EMPLOYEE",
        displayName: "Account A",
        actualGross: "10800001",
        advanceGross: "12000000",
        refundDue: "1199999",
        additionalDue: "0",
      },
    ],
    items: [
      {
        stableLineId: "ac-line-a",
        description: "Thi công =HYPERLINK(\"https://evil.invalid\")",
        recipientKey: "USER:account-a",
        rawNet: "20000001/2",
        rawVat: "1600001/2",
        rawGross: "10800001/1",
        net: "10000001",
        vat: "800000",
        gross: "10800001",
      },
    ],
    obligations: [
      { recipientKey: "USER:account-a", direction: "REFUND", amountDue: "1199999" },
    ],
    evidence: [
      { id: "invoice-a", kind: "EXPENSE_EVIDENCE", sha256: "a".repeat(64) },
    ],
    signingSnapshot: {
      id: "approved-snapshot-4",
      state: "DIGITAL_CONFIRMED",
      projectionSha256: "b".repeat(64),
      events: [
        { role: "CREATOR", actorId: "account-a", eventHash: "c".repeat(64), signedAt: "2026-10-11T01:00:00.000Z" },
        { role: "MANAGER", actorId: "manager", eventHash: "d".repeat(64), signedAt: "2026-10-11T01:10:00.000Z" },
      ],
    },
    ...overrides,
  };
}

test("excel export: exposes exactly the six confirmed XLSX families", () => {
  assert.deepEqual(SETTLEMENT_EXPORT_FAMILIES, FAMILY_NAMES);
});

test("excel export: consumes the authoritative aggregate rounding result", () => {
  assert.equal(roundSettlementVnd("1/2"), "1");
  assert.equal(roundSettlementVnd("-1/2"), "-1");
  assert.deepEqual(aggregateSettlementVnd(["1/2", "1/2", "1/2"]), { raw: "3/2", rounded: "2" });
  assert.deepEqual(balanceSettlementComponents({
    rawNet: "20000001/2",
    rawVat: "1600001/2",
    rawGross: "10800001/1",
  }), {
    rawNet: "20000001/2",
    rawVat: "1600001/2",
    rawGross: "10800001/1",
    net: "10000001",
    vat: "800000",
    gross: "10800001",
  });

  const normalized = normalizeSettlementExportProjection(immutableProjection({ family: "DNHTU" }));
  assert.equal(normalized.totals.net, "10000001");
  assert.equal(normalized.totals.vat, "800000");
  assert.equal(normalized.totals.gross, "10800001");
  assert.match(normalized.moneyInWords, /mười triệu tám trăm nghìn không trăm lẻ một đồng/i);
  assert.equal(normalized.approvedGross, "10800001");
});

test("excel export: every family is version-bound and formula-safe", async () => {
  for (const family of FAMILY_NAMES) {
    const output = await buildSettlementExportWorkbook(immutableProjection({ family }));
    assert.equal(output.family, family);
    assert.equal(output.sourceVersionId, "dossier-version-2");
    assert.match(output.fileName, /\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(output.bytes);
    assert.ok(workbook.worksheets.length >= 1);
    const values = workbook.worksheets.flatMap(sheet => {
      const found = [];
      sheet.eachRow(row => row.eachCell(cell => found.push(cell.value)));
      return found;
    });
    assert.equal(values.some(value => typeof value === "object" && value?.formula?.includes("HYPERLINK")), false);
    assert.equal(values.some(value => String(value).includes("=HYPERLINK")), true);
  }
});

test("excel export: project settlement has reconciliation and AC itemization with real allowlisted formulas", async () => {
  const output = await buildSettlementExportWorkbook(immutableProjection());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(output.bytes);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ["Đối soát", "Chi tiết AC"]);
  const formulaCells = [];
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => {
    if (cell.value && typeof cell.value === "object" && "formula" in cell.value) formulaCells.push(cell.value);
  })));
  assert.ok(formulaCells.length >= 4);
  assert.ok(formulaCells.every(cell => /^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/.test(cell.formula) || /^[DEF]\d+-[DEF]\d+$/.test(cell.formula)));
  assert.ok(formulaCells.every(cell => cell.result !== undefined && Number.isSafeInteger(Number(cell.result))), JSON.stringify(formulaCells));
});

test("excel export: draft or mutable sources are rejected", async () => {
  for (const state of ["DRAFT", "RETURNED", "SUBMITTED"]) {
    await assert.rejects(
      () => buildSettlementExportWorkbook(immutableProjection({ source: { ...immutableProjection().source, state } })),
      /immutable|bất biến|approved|duyệt/i,
    );
  }
  await assert.rejects(
    () => buildSettlementExportWorkbook(immutableProjection({ source: { ...immutableProjection().source, dossierVersionId: "" } })),
    /version|phiên bản/i,
  );
});

