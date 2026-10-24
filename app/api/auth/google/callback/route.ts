import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import {
  googleClientCredentials,
  googleLinkCookieName,
  googleOauthCookieName,
  googleOauthCookieOptions,
  signGoogleLink,
  verifyGoogleIdToken,
  verifyGoogleOauthAttempt,
} from "@/lib/googleAuth";

function loginResult(request: NextRequest, result: string) {
  const response = NextResponse.redirect(new URL(`/login?google=${result}`, request.url));
  response.cookies.delete(googleOauthCookieName());
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const client = googleClientCredentials();
  const cookie = request.cookies.get(googleOauthCookieName())?.value;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!client || !cookie || !code || !state) return loginResult(request, "failed");

  let attempt: Awaited<ReturnType<typeof verifyGoogleOauthAttempt>>;
  try {
    attempt = await verifyGoogleOauthAttempt(cookie);
    if (attempt.state !== state) return loginResult(request, "failed");
    if (new URL(attempt.redirectUri).origin !== request.nextUrl.origin) {
      return loginResult(request, "failed");
    }
  } catch {
    return loginResult(request, "failed");
  }

  let identity: { sub: string; email: string; authoritativeEmail: boolean };
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: attempt.redirectUri,
        grant_type: "authorization_code",
        code_verifier: attempt.verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) return loginResult(request, "failed");
    const tokens: unknown = await tokenResponse.json();
    if (
      !tokens ||
      typeof tokens !== "object" ||
      !("id_token" in tokens) ||
      typeof tokens.id_token !== "string"
    ) {
      return loginResult(request, "failed");
    }
    identity = await verifyGoogleIdToken(tokens.id_token, attempt.nonce);
  } catch {
    return loginResult(request, "failed");
  }

  try {
    let user = await prisma.user.findUnique({
      where: { googleSub: identity.sub },
      select: { id: true, isActive: true, sessionVersion: true },
    });
    if (!user) {
      const matchingEmail = await prisma.user.findUnique({
        where: { email: identity.email },
        select: { id: true, googleSub: true, isActive: true, sessionVersion: true },
      });
      if (!matchingEmail || !matchingEmail.isActive || matchingEmail.googleSub) {
        return loginResult(request, "no-account");
      }
      if (!identity.authoritativeEmail) {
        const response = loginResult(request, "link-required");
        response.cookies.set(
          googleLinkCookieName(),
          await signGoogleLink(identity),
          googleOauthCookieOptions()
        );
        return response;
      }
      const linked = await prisma.user.updateMany({
        where: { id: matchingEmail.id, googleSub: null, isActive: true },
        data: { googleSub: identity.sub },
      });
      if (linked.count !== 1) return loginResult(request, "failed");
      user = matchingEmail;
    }
    if (!user.isActive) return loginResult(request, "no-account");
    await createSession(user.id, user.sessionVersion);
  } catch {
    return loginResult(request, "failed");
  }

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.delete(googleOauthCookieName());
  response.cookies.delete(googleLinkCookieName());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
