import assert from "node:assert/strict";
import test from "node:test";
import { activeDirectReportsWhere } from "../lib/directReports";

test("direct reports exclude deactivated and deleted accounts", () => {
  assert.deepEqual(activeDirectReportsWhere("manager-1"), {
    managerId: "manager-1",
    isActive: true,
    deletedAt: null,
  });
});
