import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { test } from "node:test";
import { isPushEndpoint, notificationDestination, parsePushRegistration } from "../lib/pushPolicy";

function registration() {
  const curve = createECDH("prime256v1");
  return { endpoint: "https://fcm.googleapis.com/fcm/send/test", keys: { p256dh: curve.generateKeys().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

test("push subscriptions accept real browser keys and known HTTPS push providers", () => {
  const sub = registration();
  assert.deepEqual(parsePushRegistration(sub), sub);
  for (const endpoint of ["https://fcm.googleapis.com/wp/token", "https://updates.push.services.mozilla.com/wpush/v2/token", "https://web.push.apple.com/token", "https://a.notify.windows.com/token"]) assert.ok(isPushEndpoint(endpoint));
});

test("submitted endpoints cannot proxy private networks, arbitrary hosts or deceptive credentials", () => {
  for (const endpoint of ["http://fcm.googleapis.com/send/token", "https://127.0.0.1/token", "https://169.254.169.254/latest/meta-data", "https://example.com/token", "https://fcm.googleapis.com.evil.test/token", "https://fcm.googleapis.com@evil.test/token", "https://user:pass@fcm.googleapis.com/token", "https://fcm.googleapis.com:8443/token", "https://fcm.googleapis.com/token#fragment", "https://fcm.googleapis.com/", "invalid"]) {
    assert.equal(isPushEndpoint(endpoint), false, endpoint);
    assert.equal(parsePushRegistration({ ...registration(), endpoint }), null);
  }
});

test("malformed encryption material is rejected before persistence or delivery", () => {
  const sub = registration();
  for (const keys of [null, {}, { ...sub.keys, p256dh: "bad" }, { ...sub.keys, auth: "bad" }, { ...sub.keys, p256dh: Buffer.alloc(65, 4).toString("base64url") }]) assert.equal(parsePushRegistration({ ...sub, keys }), null);
  assert.equal(parsePushRegistration(null), null);
});

test("notification destinations open the relevant task, recognition or bell without untrusted URL injection", () => {
  assert.equal(notificationDestination({ projectId: "p1", taskId: "t1" }), "/projects/p1?task=t1");
  assert.equal(notificationDestination({ projectId: "p?evil=x", taskId: "a&b" }), "/projects/p%3Fevil%3Dx?task=a%26b");
  assert.equal(notificationDestination({ recognitionId: "r1" }), "/recognition?focus=r1#recognition-r1");
  assert.equal(notificationDestination({}), "/notifications");
});
