import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFinanceHeader,
  financeHeaderRows,
  missingFinanceHeaderLabels,
  readFinanceHeader,
  type FinanceHeader,
} from "../lib/financeHeader";

const vn = (day: string) => new Date(`${day}T00:00:00+07:00`);

const full: FinanceHeader = {
  clientName: "Jabil Vietnam",
  programName: "3D Figures",
  headcount: "68 tượng",
  location: "TP.HCM",
  eventStart: vn("2026-09-22"),
  eventEnd: null,
};

test("all five fields print in the fixed order", () => {
  assert.deepEqual(
    financeHeaderRows(full).map((row) => `${row.label}: ${row.value}`),
    [
      "Khách hàng: Jabil Vietnam",
      "Tên chương trình: 3D Figures",
      "Số lượng: 68 tượng",
      "Địa điểm: TP.HCM",
      "Thời gian: 22/09/2026",
    ],
  );
});

test("empty or blank fields disappear from the export", () => {
  const rows = financeHeaderRows({
    ...full,
    headcount: "   ",
    location: null,
    eventStart: null,
  });
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Khách hàng", "Tên chương trình"],
  );
  assert.deepEqual(missingFinanceHeaderLabels({ ...full, location: "" }), ["Địa điểm"]);
});

test("multi-day events print as a range", () => {
  const rows = financeHeaderRows({
    ...full,
    eventStart: vn("2026-08-01"),
    eventEnd: vn("2026-08-03"),
  });
  assert.equal(rows.at(-1)?.value, "01/08 – 03/08/2026");
});

test("a new IC starts from the project's client, name and dates", () => {
  const header = defaultFinanceHeader({
    name: "Vietjet – Chuyến bay đồng hành",
    clientName: "Vietjet",
    executionStartAt: vn("2026-08-01"),
    executionEndAt: null,
  });
  assert.equal(header.clientName, "Vietjet");
  assert.equal(header.programName, "Vietjet – Chuyến bay đồng hành");
  assert.equal(header.headcount, null);
  assert.deepEqual(
    financeHeaderRows(header).map((row) => row.label),
    ["Khách hàng", "Tên chương trình", "Thời gian"],
  );
});

test("form input is tidied and dates are checked", () => {
  const form = new FormData();
  form.set("clientName", "  Vietjet  Air ");
  form.set("headcount", "240 khách");
  form.set("eventStart", "2026-08-01");
  form.set("eventEnd", "2026-08-03");
  const header = readFinanceHeader(form);
  assert.ok(!("error" in header));
  assert.equal(header.clientName, "Vietjet Air");
  assert.equal(header.location, null);

  const reversed = new FormData();
  reversed.set("eventStart", "2026-08-03");
  reversed.set("eventEnd", "2026-08-01");
  assert.ok("error" in readFinanceHeader(reversed));

  const endOnly = new FormData();
  endOnly.set("eventEnd", "2026-08-03");
  assert.ok("error" in readFinanceHeader(endOnly));
});
