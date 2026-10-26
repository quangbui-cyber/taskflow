import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_NAME_MAX_LENGTH,
  canCreateClient,
  clientNameError,
  clientNameKey,
  normalizeClientName,
} from "../lib/clientCatalog";

test("client names are stored with Unicode and whitespace normalized", () => {
  assert.equal(normalizeClientName("  Công ty\tＡＢＣ  Việt Nam  "), "Công ty ABC Việt Nam");
});

test("client duplicate keys ignore case and harmless whitespace differences", () => {
  assert.equal(clientNameKey("  JABIL   Việt Nam "), clientNameKey("jabil Việt Nam"));
  assert.notEqual(clientNameKey("Cong ty A"), clientNameKey("Công ty A"));
});

test("client names are required and bounded", () => {
  assert.equal(clientNameError(" \n\t "), "Tên Client không được để trống.");
  assert.equal(clientNameError("A".repeat(CLIENT_NAME_MAX_LENGTH)), null);
  assert.match(clientNameError("A".repeat(CLIENT_NAME_MAX_LENGTH + 1)) ?? "", /không được dài quá/);
});

test("only Admin and Account can create clients from a project", () => {
  assert.equal(canCreateClient("ADMIN"), true);
  assert.equal(canCreateClient("ACCOUNT"), true);
  assert.equal(canCreateClient("USER"), false);
  assert.equal(canCreateClient(""), false);
});
