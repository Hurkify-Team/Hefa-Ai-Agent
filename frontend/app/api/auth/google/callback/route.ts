import { NextResponse } from "next/server";

import { authenticateGoogleUser, setAuthSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

const googleStateCookie = "hefamaa_google_oauth_state";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  id_token?: string;
};

type GoogleUserInfo = {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  sub?: string;
};

function baseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return url.origin;
}

function redirectUri(request: Request) {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || baseUrl(request) + "/api/auth/google/callback";
}

function decodeState(state: string) {
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as { next?: string };
  } catch {
    return {};
  }
}

function errorRedirect(request: Request, message: string) {
  const url = new URL("/sign-in", baseUrl(request));
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw new Error(label + " failed: " + (text || response.statusText));
  if (!text) throw new Error(label + " failed: empty response");
  return JSON.parse(text) as T;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const savedState = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(googleStateCookie + "="))?.split("=").slice(1).join("=");

  if (!code || !state || !savedState || decodeURIComponent(savedState) !== state) {
    return errorRedirect(request, "Google sign-in session expired. Please try again.");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return errorRedirect(request, "Google sign-in is not configured.");
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(request),
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const token = await readJsonResponse<GoogleTokenResponse>(tokenResponse, "Google token exchange");

    if (!token.access_token) {
      throw new Error(token.error_description || token.error || "Google did not return an access token.");
    }

    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: "Bearer " + token.access_token },
    });
    const profile = await readJsonResponse<GoogleUserInfo>(profileResponse, "Google profile lookup");

    if (!profile.sub || !profile.email || profile.email_verified === false) {
      throw new Error("Google account email could not be verified.");
    }

    const user = authenticateGoogleUser({
      avatarUrl: profile.picture,
      email: profile.email,
      googleSub: profile.sub,
      name: profile.name || profile.email,
    });
    const parsedState = decodeState(state);
    const next = parsedState.next?.startsWith("/") ? parsedState.next : "/dashboard";
    const response = NextResponse.redirect(new URL(next, baseUrl(request)));
    response.cookies.set(googleStateCookie, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    setAuthSessionCookie(response, user);
    return response;
  } catch (error) {
    console.error("[/api/auth/google/callback] failed", error);
    return errorRedirect(request, error instanceof Error ? error.message : "Google sign-in failed.");
  }
}
