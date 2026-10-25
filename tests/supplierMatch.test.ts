import assert from "node:assert/strict";
import test from "node:test";
import {
  accountDigits,
  findSameBankAccount,
  findSameTaxCode,
  findSimilarSuppliers,
  searchKey,
} from "../lib/supplierMatch";

const suppliers = [
  { id: "s1", name: "CÔNG TY TNHH IN ẤN TÂN HOÀNG VIỆT", shortName: "TÂN HOÀNG VIỆT", bankAccount: "38365668", taxCode: "0312345678" },
  { id: "s2", name: "CTY TNHH MT VÀ CN ARTECH", shortName: "ARTECH", bankAccount: "2920258888", taxCode: null },
  { id: "s3", name: "Võ Phạm Trọng Huy", shortName: "HUY", bankAccount: "1826052005", taxCode: null },
];

const names = (typed: string, excludeId?: string) =>
  findSimilarSuppliers(typed, suppliers, { excludeId }).map(
    (match) => `${match.supplier.id}${match.exact ? "!" : ""}`,
  );

test("accents, case and spacing do not matter", () => {
  assert.equal(searchKey("  Tân  Hoàng-Việt "), "tan hoang viet");
  assert.deepEqual(names("tan hoang viet"), ["s1!"]);
  assert.deepEqual(names("artech"), ["s2!"]);
});

test("company boilerplate is ignored when comparing names", () => {
  assert.deepEqual(names("Cty TNHH Tân Hoàng Việt"), ["s1"]);
  assert.deepEqual(names("Công ty Artech"), ["s2"]);
});

test("partial names suggest without being exact", () => {
  assert.deepEqual(names("Hoàng Việt"), ["s1"]);
  assert.deepEqual(names("trọng huy"), ["s3"]);
});

test("too short or unrelated input suggests nothing", () => {
  assert.deepEqual(names("a"), []);
  assert.deepEqual(names("Saigonlight"), []);
});

test("the supplier being edited is not suggested to itself", () => {
  assert.deepEqual(names("ARTECH", "s2"), []);
});

test("same bank account is found whatever the formatting", () => {
  assert.equal(accountDigits("3836 5668"), "38365668");
  assert.deepEqual(findSameBankAccount("3836-5668", suppliers).map((s) => s.id), ["s1"]);
  assert.deepEqual(findSameBankAccount("38365668", suppliers, "s1"), []);
  assert.deepEqual(findSameBankAccount("123", suppliers), []);
});

test("same tax code is found", () => {
  assert.deepEqual(findSameTaxCode("0312345678", suppliers).map((s) => s.id), ["s1"]);
  assert.deepEqual(findSameTaxCode("0312", suppliers), []);
});
