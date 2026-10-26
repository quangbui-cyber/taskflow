import { type NextRequest, NextResponse } from "next/server";
import {
  googleAuthConfigured,
  googleClientCredentials,
  googleLinkCookieName,
  googleOauthCookieName,
  googleOauthCookieOptions,
  newGoogleOauthAttempt,
  signGoogleOauthAttempt,
} from "@/lib/googleAuth";

export async function GET(request: NextRequest) {
  if (!googleAuthConfigured()) {
    return NextResponse.redirect(new URL("/login?google=unavailable", request.url));
  }

  const client = googleClientCredentials()!;
  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();
  const attempt = newGoogleOauthAttempt(redirectUri);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: attempt.state,
    nonce: attempt.nonce,
    code_challenge: attempt.challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.delete(googleLinkCookieName());
  response.cookies.set(
    googleOauthCookieName(),
    await signGoogleOauthAttempt(attempt),
    googleOauthCookieOptions()
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
