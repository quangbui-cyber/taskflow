import assert from "node:assert/strict";
import test from "node:test";
import { groupIcLinesByVendor } from "../lib/costflow/icVendorView";
import { calculateLineCost } from "../lib/costflow/money";
import type { IcLine } from "../lib/costflow/types";

function line(id: string, vendorId: string | undefined, unitPrice: string, costReady = true): IcLine {
  const input = { quantity: "2", days: "1", unitPrice, vatPercent: "10", basis: "NET" as const };
  return { ...input, id, vendorId, description: `Hạng mục ${id}`, unit: "cái", cost: costReady ? calculateLineCost(input) : null };
}

test("IC vendor view groups line items and exact totals by supplier, keeping unassigned separate", () => {
  const groups = groupIcLinesByVendor([
    line("a", "vendor-a", "100"),
    line("b", "vendor-b", "50"),
    line("c", "vendor-a", "25"),
    line("d", undefined, "10"),
    line("e", "vendor-a", "0", false),
  ], [{ id: "vendor-a", name: "NCC A" }, { id: "vendor-b", name: "NCC B" }]);

  assert.deepEqual(groups.map(group => [group.name, group.lines.map(item => item.id)]), [
    ["NCC A", ["a", "c", "e"]],
    ["NCC B", ["b"]],
    ["Chưa gắn NCC", ["d"]],
  ]);
  assert.equal(groups[0].amount.net, "250");
  assert.equal(groups[0].amount.vat, "25");
  assert.equal(groups[0].amount.gross, "275");
  assert.equal(groups[0].missingCostCount, 1);
  assert.equal(groups[1].amount.gross, "110");
  assert.equal(groups[2].amount.gross, "22");
});
