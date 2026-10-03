import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canCreateProjects,
  canViewRevenue,
  readProjectBusinessFields,
} from "../lib/projectPolicy";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const customerProject = {
  category: "CLIENT" as const,
  revenue: 125_000_000,
  clientId: "client-a",
  accountId: "account-a",
  purchaseOrderNumber: null,
};

test("USER can create projects without acquiring financial access", () => {
  assert.equal(canCreateProjects("USER"), true);
  assert.equal(canViewRevenue("USER"), false);
  assert.equal(canCreateProjects("unknown"), false);
  for (const role of ["ADMIN", "ACCOUNT"])
    assert.equal(canViewRevenue(role), true);
});

test("internal projects discard customer metadata and financial input", () => {
  assert.deepEqual(
    readProjectBusinessFields(
      form({
        category: "INTERNAL",
        clientId: "client-a",
        accountId: "account-a",
        revenue: "500.000.000",
      }),
      "ADMIN",
    ),
    { category: "INTERNAL", revenue: 0, clientId: null, accountId: null },
  );
  assert.deepEqual(
    readProjectBusinessFields(form({ category: "INTERNAL" }), "USER"),
    {
      category: "INTERNAL",
      revenue: 0,
      clientId: null,
      accountId: null,
    },
  );
});

test("USER can create customer projects with an Account and zero revenue", () => {
  assert.deepEqual(
    readProjectBusinessFields(
      form({ category: "CLIENT", accountId: "account-a" }),
      "USER",
    ),
    {
      category: "CLIENT",
      revenue: 0,
      clientId: null,
      accountId: "account-a",
    },
  );
});

test("a USER owner editing nonfinancial fields preserves existing revenue", () => {
  assert.deepEqual(
    readProjectBusinessFields(
      form({ category: "CLIENT" }),
      "USER",
      customerProject,
    ),
    {
      category: "CLIENT",
      revenue: 125_000_000,
      clientId: "client-a",
      accountId: "account-a",
    },
  );
});

test("crafted financial fields are rejected for USER, including zero", () => {
  for (const revenue of ["0", "999.000.000", ""]) {
    assert.match(
      String(
        (
          readProjectBusinessFields(
            form({ category: "CLIENT", revenue }),
            "USER",
            customerProject,
          ) as { error: string }
        ).error,
      ),
      /quyền sửa doanh thu/,
    );
  }
});

test("category changes cannot bypass financial or PO protection", () => {
  assert.ok(
    "error" in
      readProjectBusinessFields(
        form({ category: "INTERNAL" }),
        "USER",
        customerProject,
      ),
  );
  assert.deepEqual(
    readProjectBusinessFields(
      form({ category: "INTERNAL" }),
      "ADMIN",
      customerProject,
    ),
    {
      category: "INTERNAL",
      revenue: 0,
      clientId: null,
      accountId: null,
    },
  );
  for (const role of ["ADMIN", "ACCOUNT", "USER"]) {
    assert.ok(
      "error" in
        readProjectBusinessFields(form({ category: "INTERNAL" }), role, {
          ...customerProject,
          purchaseOrderNumber: "PO-1",
        }),
    );
  }
});

test("PO imports require financial access and a customer project", () => {
  assert.ok(
    "error" in
      readProjectBusinessFields(
        form({ category: "CLIENT", projectSource: "JABIL_PO" }),
        "USER",
      ),
  );
  assert.ok(
    "error" in
      readProjectBusinessFields(
        form({ category: "INTERNAL", projectSource: "JABIL_PO" }),
        "ADMIN",
      ),
  );
  assert.ok(
    !(
      "error" in
      readProjectBusinessFields(
        form({ category: "CLIENT", projectSource: "JABIL_PO", accountId: "account-a" }),
        "ACCOUNT",
      )
    ),
  );
});

test("invalid categories and invalid revenue are rejected; VND formatting works", () => {
  assert.ok(
    "error" in readProjectBusinessFields(form({ category: "OTHER" }), "ADMIN"),
  );
  for (const revenue of ["-1", "NaN", "Infinity", "invalid"]) {
    assert.ok(
      "error" in
        readProjectBusinessFields(
          form({ category: "CLIENT", revenue }),
          "ACCOUNT",
        ),
    );
  }
  assert.deepEqual(
    readProjectBusinessFields(form({ revenue: "500.000.000 ₫", accountId: "account-a" }), "ACCOUNT"),
    {
      category: "CLIENT",
      revenue: 500_000_000,
      clientId: null,
      accountId: "account-a",
    },
  );
});

test("customer creation, clearing Account and editing legacy unassigned projects require Account", () => {
  for (const role of ["ADMIN", "ACCOUNT", "USER"]) {
    for (const accountId of ["", "   "]) {
      for (const existing of [undefined, customerProject]) {
        const result = readProjectBusinessFields(form({ category: "CLIENT", accountId }), role, existing);
        assert.ok("error" in result);
        assert.match(result.error, /bắt buộc chọn Account/);
      }
    }
    assert.ok("error" in readProjectBusinessFields(form({ category: "CLIENT" }), role));
    assert.ok("error" in readProjectBusinessFields(form({ category: "CLIENT" }), role, { ...customerProject, accountId: null }));
    assert.ok(!("error" in readProjectBusinessFields(form({ category: "CLIENT" }), role, customerProject)));
  }
});
