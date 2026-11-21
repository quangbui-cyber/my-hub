import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  provider: "google" | "local";
};

export const SESSION_COOKIE_NAME = "myhub_session";
export const OAUTH_STATE_COOKIE = "myhub_google_oauth_state";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 ngày

function getSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "my-hub-local-dev-secret-key-2026"
  );
}

function signPayload(payloadB64: string): string {
  return createHmac("sha256", getSecret()).update(payloadB64).digest("base64url");
}

export function createSessionToken(user: AuthUser): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payloadB64 = Buffer.from(JSON.stringify({ user, exp }), "utf8").toString("base64url");
  const sig = signPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): AuthUser | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = signPayload(payloadB64);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      user?: AuthUser;
      exp?: number;
    };
    if (!decoded?.user?.email || typeof decoded.exp !== "number") return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded.user;
  } catch {
    return null;
  }
}

export function generateOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()
  );
}
