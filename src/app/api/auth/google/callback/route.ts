import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE_NAME,
  type AuthUser,
} from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(error || "missing_code")}`, url.origin)
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  if (!savedState || savedState !== state) {
    return NextResponse.redirect(new URL("/?auth_error=invalid_state", url.origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || `${url.origin}/api/auth/google/callback`;

  try {
    // 1. Đổi authorization code lấy access_token từ Google
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      return NextResponse.redirect(new URL("/?auth_error=token_exchange_failed", url.origin));
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL("/?auth_error=no_access_token", url.origin));
    }

    // 2. Lấy thông tin hồ sơ người dùng Google
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      return NextResponse.redirect(new URL("/?auth_error=userinfo_failed", url.origin));
    }

    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    if (!profile.email) {
      return NextResponse.redirect(new URL("/?auth_error=missing_email", url.origin));
    }

    const user: AuthUser = {
      id: profile.sub || profile.email,
      email: profile.email.toLowerCase(),
      name: profile.name || profile.email.split("@")[0],
      picture: profile.picture || null,
      provider: "google",
    };

    const sessionToken = createSessionToken(user);
    const res = NextResponse.redirect(new URL("/", url.origin));
    res.cookies.delete(OAUTH_STATE_COOKIE);
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL("/?auth_error=server_error", url.origin));
  }
}
