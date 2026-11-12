import assert from "node:assert/strict";
import { test } from "node:test";
import { crmViewCookieValue, resolveCrmView } from "../lib/crm/viewPreference";

test("URL view wins, cookie fills a missing view only for the same user, default otherwise", () => {
  assert.equal(resolveCrmView("clients", undefined, undefined, "u1"), "map");
  assert.equal(resolveCrmView("opportunities", undefined, undefined, "u1"), "board");
  assert.equal(resolveCrmView("clients", "table", crmViewCookieValue("u1", "cards"), "u1"), "table");
  assert.equal(resolveCrmView("clients", undefined, crmViewCookieValue("u1", "cards"), "u1"), "cards");
  assert.equal(resolveCrmView("clients", undefined, crmViewCookieValue("u2", "cards"), "u1"), "map");
  assert.equal(resolveCrmView("clients", "board", crmViewCookieValue("u1", "bogus"), "u1"), "map");
  assert.equal(resolveCrmView("opportunities", ["list"], undefined, "u1"), "board");
});
