import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const googleStateCookie = "hefamaa_google_oauth_state";

function baseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return url.origin;
}

function redirectUri(request: Request) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || baseUrl(request) + "/api/auth/google/callback";
}

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();

  if (!clientId) {
    return NextResponse.json({ ok: false, success: false, error: "GOOGLE_OAUTH_CLIENT_ID is not configured" }, { status: 500 });
  }

  const requestUrl = new URL(request.url);
  const next = requestUrl.searchParams.get("next")?.startsWith("/") ? requestUrl.searchParams.get("next") : "/dashboard";
  const nonce = randomBytes(18).toString("base64url");
  const state = Buffer.from(JSON.stringify({ next, nonce })).toString("base64url");
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri(request));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(googleStateCookie, state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
