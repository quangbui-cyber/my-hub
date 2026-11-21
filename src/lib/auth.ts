import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture?: string | null;
  provider: "google" | "local";
  calendarConnected?: boolean;
  docsConnected?: boolean;
};

export type GoogleTokens = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: number; // unix timestamp ms
};

export const SESSION_COOKIE_NAME = "myhub_session";
export const GOOGLE_TOKENS_COOKIE_NAME = "myhub_google_tokens";
export const OAUTH_STATE_COOKIE = "myhub_google_oauth_state";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 ngày

function getSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    "my-hub-local-dev-secret-key-2026"
  );
}

function getAesKey(): Buffer {
  return createHash("sha256").update(getSecret()).digest();
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

export function encryptGoogleTokens(tokens: GoogleTokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getAesKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(tokens), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptGoogleTokens(raw: string | undefined | null): GoogleTokens | null {
  if (!raw || typeof raw !== "string") return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], "base64url");
    const tag = Buffer.from(parts[1], "base64url");
    const data = Buffer.from(parts[2], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", getAesKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(decrypted) as GoogleTokens;
    if (!parsed?.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<GoogleTokens | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    return {
      accessToken: data.access_token,
      refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
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
