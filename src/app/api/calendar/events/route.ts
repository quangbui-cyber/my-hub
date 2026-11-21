import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  decryptGoogleTokens,
  encryptGoogleTokens,
  GOOGLE_TOKENS_COOKIE_NAME,
  isGoogleOAuthConfigured,
  refreshGoogleAccessToken,
  type GoogleTokens,
} from "@/lib/auth";

export type CalendarMeetingEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  meetingUrl: string | null;
  platform: "meet" | "zoom" | "teams" | null;
  meetingCode: string | null;
  attendees: string[];
  description: string;
  htmlLink: string | null;
};

type GoogleCalendarItem = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
  attendees?: { displayName?: string; email?: string; self?: boolean }[];
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function extractMeetingInfoFromEvent(item: GoogleCalendarItem): {
  meetingUrl: string | null;
  platform: "meet" | "zoom" | "teams" | null;
  meetingCode: string | null;
} {
  const candidates: string[] = [];
  if (item.hangoutLink) candidates.push(item.hangoutLink);
  if (item.conferenceData?.entryPoints) {
    for (const ep of item.conferenceData.entryPoints) {
      if (ep.uri) candidates.push(ep.uri);
    }
  }
  const blob = [item.location ?? "", item.description ?? ""].join(" ");
  const urlMatches = blob.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];
  candidates.push(...urlMatches);

  for (const raw of candidates) {
    const clean = raw.trim().replace(/[.,;:!?\])}]+$/, "");
    // 1. Google Meet
    const meetMatch = /meet\.google\.com\/(?:_meet\/|lookup\/)?([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})/i.exec(clean);
    if (meetMatch) {
      const code = meetMatch[1].toLowerCase();
      return { meetingUrl: `https://meet.google.com/${code}`, platform: "meet", meetingCode: code };
    }
    // 2. Zoom
    const zoomMatch =
      /(?:[a-zA-Z0-9-]+\.)?zoom\.us\/(?:j|s|w|wc\/(?:join|start)|my)\/([a-zA-Z0-9._-]+)(?:\?[^\s"'<>]*)?/i.exec(clean);
    if (zoomMatch) {
      return { meetingUrl: clean, platform: "zoom", meetingCode: zoomMatch[1] };
    }
    // 3. Microsoft Teams
    const teamsMatch =
      /(?:[a-zA-Z0-9-]+\.)?teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet)\/[^\s"'<>]+/i.exec(clean);
    if (teamsMatch) {
      const idMatch = /meet\/([a-zA-Z0-9_-]+)/i.exec(clean) || /meeting_([a-zA-Z0-9_-]+)/i.exec(clean);
      return {
        meetingUrl: clean,
        platform: "teams",
        meetingCode: idMatch ? idMatch[1].slice(0, 12) : "teams",
      };
    }
  }
  return { meetingUrl: null, platform: null, meetingCode: null };
}

async function getValidGoogleTokens(): Promise<{
  tokens: GoogleTokens | null;
  refreshed: boolean;
}> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GOOGLE_TOKENS_COOKIE_NAME)?.value;
  let tokens = decryptGoogleTokens(raw);
  if (!tokens) return { tokens: null, refreshed: false };

  // Nếu sắp hết hạn trong 2 phút và có refreshToken thì tự làm mới
  if (tokens.expiresAt < Date.now() + 120_000 && tokens.refreshToken) {
    const next = await refreshGoogleAccessToken(tokens.refreshToken);
    if (next) {
      tokens = next;
      return { tokens, refreshed: true };
    }
  }
  return { tokens, refreshed: false };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days") || 7)));

  const { tokens, refreshed } = await getValidGoogleTokens();
  if (!tokens) {
    return NextResponse.json(
      {
        connected: false,
        googleConfigured: isGoogleOAuthConfigured(),
        events: [],
      },
      { headers: CORS_HEADERS }
    );
  }

  const now = new Date();
  const timeMin = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // bao gồm cuộc họp đang diễn ra từ 2 tiếng trước
  const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  const calUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  calUrl.searchParams.set("timeMin", timeMin);
  calUrl.searchParams.set("timeMax", timeMax);
  calUrl.searchParams.set("singleEvents", "true");
  calUrl.searchParams.set("orderBy", "startTime");
  calUrl.searchParams.set("maxResults", "25");

  try {
    const res = await fetch(calUrl.toString(), {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json(
        {
          connected: false,
          needsReconnect: true,
          googleConfigured: isGoogleOAuthConfigured(),
          events: [],
          error: "Phiên Google Calendar đã hết hạn hoặc chưa cấp quyền Lịch. Bấm kết nối lại Google.",
        },
        { headers: CORS_HEADERS }
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { connected: true, events: [], error: `Google Calendar API lỗi (${res.status})` },
        { status: 502, headers: CORS_HEADERS }
      );
    }

    const data = (await res.json()) as { items?: GoogleCalendarItem[] };
    const events: CalendarMeetingEvent[] = (data.items ?? []).map((item) => {
      const info = extractMeetingInfoFromEvent(item);
      const attendees = (item.attendees ?? [])
        .map((a) => a.displayName?.trim() || a.email?.split("@")[0] || "")
        .filter(Boolean);
      const startAt = item.start?.dateTime || item.start?.date || "";
      const endAt = item.end?.dateTime || item.end?.date || "";
      return {
        id: item.id || `${startAt}-${item.summary}`,
        title: item.summary?.trim() || "(Không tiêu đề)",
        startAt,
        endAt,
        allDay: Boolean(!item.start?.dateTime && item.start?.date),
        meetingUrl: info.meetingUrl,
        platform: info.platform,
        meetingCode: info.meetingCode,
        attendees,
        description: (item.description ?? "").slice(0, 300),
        htmlLink: item.htmlLink || null,
      };
    });

    const response = NextResponse.json(
      { connected: true, googleConfigured: true, events },
      { headers: CORS_HEADERS }
    );
    if (refreshed) {
      response.cookies.set(GOOGLE_TOKENS_COOKIE_NAME, encryptGoogleTokens(tokens), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
    }
    return response;
  } catch {
    return NextResponse.json(
      { connected: true, events: [], error: "Không kết nối được Google Calendar." },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * Tạo nhanh một cuộc họp mới trên Google Calendar (tự động gắn link Google Meet!)
 */
export async function POST(req: Request) {
  const { tokens, refreshed } = await getValidGoogleTokens();
  if (!tokens) {
    return NextResponse.json(
      { error: "Vui lòng đăng nhập Google OAuth để tạo cuộc họp trên Google Calendar." },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const body = (await req.json()) as {
      title?: string;
      startAt?: string;
      endAt?: string;
      attendees?: string[];
      withMeet?: boolean;
    };

    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Vui lòng nhập tên cuộc họp." }, { status: 400, headers: CORS_HEADERS });
    }

    const start = body.startAt ? new Date(body.startAt) : new Date(Date.now() + 15 * 60 * 1000);
    const end = body.endAt ? new Date(body.endAt) : new Date(start.getTime() + 60 * 60 * 1000);

    const attendeesPayload = (body.attendees ?? [])
      .map((s) => s.trim())
      .filter((s) => s.includes("@"))
      .map((email) => ({ email }));

    const eventBody: Record<string, unknown> = {
      summary: title,
      start: { dateTime: start.toISOString(), timeZone: "Asia/Ho_Chi_Minh" },
      end: { dateTime: end.toISOString(), timeZone: "Asia/Ho_Chi_Minh" },
      ...(attendeesPayload.length > 0 ? { attendees: attendeesPayload } : {}),
    };

    if (body.withMeet !== false) {
      eventBody.conferenceData = {
        createRequest: {
          requestId: `myhub-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      };
    }

    const createRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Không tạo được sự kiện trên Google Calendar (${createRes.status}): ${errText.slice(0, 140)}` },
        { status: createRes.status, headers: CORS_HEADERS }
      );
    }

    const created = (await createRes.json()) as GoogleCalendarItem;
    const info = extractMeetingInfoFromEvent(created);

    const event: CalendarMeetingEvent = {
      id: created.id || `cal_${Date.now()}`,
      title: created.summary || title,
      startAt: created.start?.dateTime || start.toISOString(),
      endAt: created.end?.dateTime || end.toISOString(),
      allDay: false,
      meetingUrl: info.meetingUrl,
      platform: info.platform,
      meetingCode: info.meetingCode,
      attendees: (created.attendees ?? []).map((a) => a.displayName || a.email || "").filter(Boolean),
      description: created.description || "",
      htmlLink: created.htmlLink || null,
    };

    const response = NextResponse.json({ ok: true, event }, { headers: CORS_HEADERS });
    if (refreshed) {
      response.cookies.set(GOOGLE_TOKENS_COOKIE_NAME, encryptGoogleTokens(tokens), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
    }
    return response;
  } catch {
    return NextResponse.json(
      { error: "Có lỗi khi tạo lịch họp trên Google Calendar." },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
