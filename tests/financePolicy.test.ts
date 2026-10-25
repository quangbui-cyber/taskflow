import assert from "node:assert/strict";
import test from "node:test";
import {
  canBeFinanceApprover,
  canDeleteSuppliers,
  canManageSuppliers,
  canSetFinanceApprovers,
  readFinanceApprovers,
  readSupplierInput,
  supplierKey,
  supplierKeys,
} from "../lib/financePolicy";
import { canHoldAccountProfile, isUserRole, ROLE_LABELS } from "../lib/roles";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test("accountant is a real role but cannot hold an Account profile", () => {
  assert.equal(isUserRole("ACCOUNTANT"), true);
  assert.equal(ROLE_LABELS.ACCOUNTANT, "Kế toán");
  assert.equal(isUserRole("OWNER"), false);
  assert.equal(canHoldAccountProfile("ACCOUNTANT"), false);
  assert.equal(canHoldAccountProfile("ACCOUNT"), true);
});

test("only Admin and Account approve IC/AC or pick approvers", () => {
  for (const role of ["ADMIN", "ACCOUNT"]) {
    assert.equal(canBeFinanceApprover(role), true);
    assert.equal(canSetFinanceApprovers(role), true);
  }
  for (const role of ["ACCOUNTANT", "USER"]) {
    assert.equal(canBeFinanceApprover(role), false);
    assert.equal(canSetFinanceApprovers(role), false);
  }
});

test("approver fields left out of the form keep the saved approvers", () => {
  const existing = { icApproverId: "u1", acApproverId: "u2" };
  assert.deepEqual(
    readFinanceApprovers(form({ name: "x" }), "USER", "CLIENT", existing),
    existing,
  );
});

test("approvers can be set, cleared, and differ between IC and AC", () => {
  const existing = { icApproverId: "u1", acApproverId: null };
  assert.deepEqual(
    readFinanceApprovers(
      form({ icApproverId: "", acApproverId: "u3" }),
      "ACCOUNT",
      "CLIENT",
      existing,
    ),
    { icApproverId: null, acApproverId: "u3" },
  );
});

test("users without finance rights cannot change approvers", () => {
  const result = readFinanceApprovers(
    form({ icApproverId: "u9" }),
    "USER",
    "CLIENT",
    { icApproverId: null, acApproverId: null },
  );
  assert.ok("error" in result);
});

test("internal projects drop both approvers", () => {
  assert.deepEqual(
    readFinanceApprovers(
      form({ icApproverId: "u1", acApproverId: "u2" }),
      "ADMIN",
      "INTERNAL",
      { icApproverId: "u1", acApproverId: "u2" },
    ),
    { icApproverId: null, acApproverId: null },
  );
});

test("everyone views suppliers; only finance roles edit, fewer delete", () => {
  assert.equal(canManageSuppliers("USER"), false);
  for (const role of ["ADMIN", "ACCOUNT", "ACCOUNTANT"])
    assert.equal(canManageSuppliers(role), true);
  assert.equal(canDeleteSuppliers("ACCOUNT"), false);
  assert.equal(canDeleteSuppliers("ACCOUNTANT"), true);
  assert.equal(canDeleteSuppliers("ADMIN"), true);
});

test("supplier input is tidied: spaces collapsed, account digits joined", () => {
  const input = readSupplierInput(
    form({
      name: "  CÔNG TY TNHH   IN ẤN TÂN HOÀNG VIỆT ",
      shortName: "TÂN HOÀNG VIỆT",
      kind: "COMPANY",
      taxCode: "0312345678",
      bankAccount: "3836 5668",
      bankName: "ACB",
      email: "KeToan@Example.vn",
    }),
  );
  assert.ok(!("error" in input));
  assert.equal(input.name, "CÔNG TY TNHH IN ẤN TÂN HOÀNG VIỆT");
  assert.equal(input.bankAccount, "38365668");
  assert.equal(input.email, "ketoan@example.vn");
  assert.equal(input.phone, null);
});

test("supplier input rejects missing name, bad tax code, account without bank", () => {
  assert.ok("error" in readSupplierInput(form({ name: "  ", kind: "COMPANY" })));
  assert.ok(
    "error" in readSupplierInput(form({ name: "A", kind: "COMPANY", taxCode: "123" })),
  );
  assert.ok(
    "error" in readSupplierInput(form({ name: "A", kind: "PERSON", bankAccount: "123456" })),
  );
  assert.ok("error" in readSupplierInput(form({ name: "A", kind: "OTHER" })));
});

test("personal tax code may be a 12-digit citizen ID; branch codes allowed", () => {
  for (const taxCode of ["079200001234", "0312345678-001"]) {
    const input = readSupplierInput(form({ name: "A", kind: "PERSON", taxCode }));
    assert.ok(!("error" in input), taxCode);
  }
});

test("supplier keys compare names case-insensitively", () => {
  assert.equal(supplierKey("Tân Hoàng  Việt"), supplierKey("TÂN HOÀNG VIỆT"));
});

test("stored keys make case variants collide in the unique index", () => {
  assert.deepEqual(supplierKeys({ name: "CÔNG TY ARTECH", shortName: "ARTECH" }), {
    nameKey: "công ty artech",
    shortNameKey: "artech",
  });
  assert.equal(
    supplierKeys({ name: "Công ty Artech", shortName: null }).nameKey,
    supplierKeys({ name: "CÔNG TY ARTECH", shortName: null }).nameKey,
  );
  assert.equal(supplierKeys({ name: "A", shortName: null }).shortNameKey, null);
});
