import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  decryptGoogleTokens,
  GOOGLE_TOKENS_COOKIE_NAME,
  isGoogleOAuthConfigured,
  SESSION_COOKIE_NAME,
  verifySessionToken,
  type AuthUser,
} from "@/lib/auth";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = verifySessionToken(token);
  const googleTokens = decryptGoogleTokens(cookieStore.get(GOOGLE_TOKENS_COOKIE_NAME)?.value);

  return NextResponse.json({
    user: user
      ? {
          ...user,
          calendarConnected: Boolean(user.calendarConnected && googleTokens?.accessToken),
          docsConnected: Boolean(user.docsConnected && googleTokens?.accessToken),
        }
      : null,
    googleConfigured: isGoogleOAuthConfigured(),
    calendarConnected: Boolean(googleTokens?.accessToken),
    docsConnected: Boolean(user?.docsConnected && googleTokens?.accessToken),
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      email?: string;
      name?: string;
      picture?: string | null;
    };
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Vui lòng nhập địa chỉ email Google hợp lệ." }, { status: 400 });
    }
    const name = String(body.name ?? "").trim() || email.split("@")[0];
    const user: AuthUser = {
      id: `google_${email}`,
      email,
      name,
      picture: body.picture || null,
      provider: "google",
      calendarConnected: false,
    };
    const sessionToken = createSessionToken(user);
    const res = NextResponse.json({ user });
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Không thể tạo phiên đăng nhập." }, { status: 500 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  res.cookies.delete(GOOGLE_TOKENS_COOKIE_NAME);
  return res;
}
