import { NextResponse } from "next/server";
import {
  generateOAuthState,
  isGoogleOAuthConfigured,
  OAUTH_STATE_COOKIE,
} from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!isGoogleOAuthConfigured()) {
    return NextResponse.redirect(new URL("/?auth=setup_google", url.origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${url.origin}/api/auth/google/callback`;
  const state = generateOAuthState();

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", clientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("prompt", "select_account");
  googleAuthUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(googleAuthUrl.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
