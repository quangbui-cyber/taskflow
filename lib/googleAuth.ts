import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

const OAUTH_COOKIE = "google_oauth";
const LINK_COOKIE = "google_link";
const OAUTH_MAX_AGE = 10 * 60;
const GOOGLE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
);

export function googleAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim() &&
    process.env.SESSION_SECRET?.trim()
  );
}

export function googleClientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function oauthSecret() {
  const raw = process.env.SESSION_SECRET;
  if (!raw) throw new Error("SESSION_SECRET is required for Google login.");
  return new TextEncoder().encode(raw);
}

export function googleOauthCookieName() {
  return OAUTH_COOKIE;
}

export function googleLinkCookieName() {
  return LINK_COOKIE;
}

export function googleOauthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: OAUTH_MAX_AGE,
    path: "/",
  };
}

export function newGoogleOauthAttempt(redirectUri: string) {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, nonce, verifier, challenge, redirectUri };
}

export async function signGoogleOauthAttempt(attempt: {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
}) {
  return new SignJWT(attempt)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mycreative")
    .setAudience("google-oauth")
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_MAX_AGE}s`)
    .sign(oauthSecret());
}

export async function verifyGoogleOauthAttempt(cookie: string) {
  const { payload } = await jwtVerify(cookie, oauthSecret(), {
    issuer: "mycreative",
    audience: "google-oauth",
  });
  const { state, nonce, verifier, redirectUri } = payload;
  if (
    typeof state !== "string" ||
    typeof nonce !== "string" ||
    typeof verifier !== "string" ||
    typeof redirectUri !== "string"
  ) {
    throw new Error("Invalid Google OAuth attempt.");
  }
  return { state, nonce, verifier, redirectUri };
}

export async function verifyGoogleIdToken(idToken: string, nonce: string) {
  const client = googleClientCredentials();
  if (!client) throw new Error("Google login is not configured.");
  const { payload } = await jwtVerify(idToken, GOOGLE_KEYS, {
    audience: client.clientId,
    issuer: ["https://accounts.google.com", "accounts.google.com"],
  });
  if (
    payload.nonce !== nonce ||
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.email_verified !== true
  ) {
    throw new Error("Invalid Google identity.");
  }
  const email = payload.email.trim().toLowerCase();
  return {
    sub: payload.sub,
    email,
    // Google warns that a verified third-party address can later change owner.
    // Gmail and Workspace addresses are authoritative; others require password linking once.
    authoritativeEmail: email.endsWith("@gmail.com") || typeof payload.hd === "string",
  };
}

export async function signGoogleLink(identity: { sub: string; email: string }) {
  return new SignJWT(identity)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mycreative")
    .setAudience("google-link")
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_MAX_AGE}s`)
    .sign(oauthSecret());
}

export async function verifyGoogleLink(cookie: string) {
  const { payload } = await jwtVerify(cookie, oauthSecret(), {
    issuer: "mycreative",
    audience: "google-link",
  });
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new Error("Invalid Google account link.");
  }
  return { sub: payload.sub, email: payload.email };
}
