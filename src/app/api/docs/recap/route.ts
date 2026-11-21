import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  decryptGoogleTokens,
  encryptGoogleTokens,
  GOOGLE_TOKENS_COOKIE_NAME,
  refreshGoogleAccessToken,
  type GoogleTokens,
} from "@/lib/auth";
import { parseRecapSections } from "@/lib/meetingRecap";

type DocActionItem = {
  task?: string;
  title?: string;
  owner?: string | null;
  due?: string | null;
  dueDate?: string | null;
  done?: boolean;
};

type CreateRecapDocBody = {
  title?: string;
  date?: string;
  attendees?: string[];
  content?: string;
  actionItems?: DocActionItem[];
  transcript?: string;
  meetingUrl?: string | null;
};

async function getValidGoogleTokens(): Promise<{
  tokens: GoogleTokens | null;
  refreshed: boolean;
}> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(GOOGLE_TOKENS_COOKIE_NAME)?.value;
  let tokens = decryptGoogleTokens(raw);
  if (!tokens) return { tokens: null, refreshed: false };

  if (tokens.expiresAt < Date.now() + 120_000 && tokens.refreshToken) {
    const next = await refreshGoogleAccessToken(tokens.refreshToken);
    if (next) {
      tokens = next;
      return { tokens, refreshed: true };
    }
  }
  return { tokens, refreshed: false };
}

type StyledLine = {
  text: string;
  style?: "TITLE" | "SUBTITLE" | "HEADING_1" | "HEADING_2" | "NORMAL_TEXT";
  bullet?: boolean;
  bold?: boolean;
};

function buildDocumentLines(body: CreateRecapDocBody): StyledLine[] {
  const lines: StyledLine[] = [];
  const title = (body.title || "Biên bản cuộc họp").trim();
  const formattedDate = body.date
    ? new Date(body.date).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleString("vi-VN");

  lines.push({ text: title, style: "TITLE" });

  const metaParts = [`Thời gian: ${formattedDate}`];
  if (body.attendees && body.attendees.length > 0) {
    metaParts.push(`Người tham dự: ${body.attendees.join(", ")}`);
  }
  if (body.meetingUrl) {
    metaParts.push(`Link phòng họp: ${body.meetingUrl}`);
  }
  lines.push({ text: metaParts.join("  |  "), style: "SUBTITLE" });
  lines.push({ text: "", style: "NORMAL_TEXT" });

  const sections = parseRecapSections(body.content || "");
  for (const section of sections) {
    if (section.title) {
      lines.push({ text: section.title, style: "HEADING_1" });
    }
    for (const p of section.paragraphs) {
      lines.push({ text: p, style: "NORMAL_TEXT" });
    }
    for (const item of section.items) {
      lines.push({ text: item, style: "NORMAL_TEXT", bullet: true });
    }
    for (const topic of section.topics) {
      lines.push({ text: topic.title, style: "HEADING_2" });
      for (const pt of topic.points) {
        lines.push({ text: pt, style: "NORMAL_TEXT", bullet: true });
      }
      for (const note of topic.notes) {
        lines.push({ text: note, style: "NORMAL_TEXT" });
      }
      if (topic.conclusion) {
        lines.push({ text: `Kết luận: ${topic.conclusion}`, style: "NORMAL_TEXT", bold: true });
      }
    }
  }

  const actions = Array.isArray(body.actionItems) ? body.actionItems : [];
  if (actions.length > 0) {
    lines.push({ text: "Việc cần làm (Action Items)", style: "HEADING_1" });
    for (const a of actions) {
      const label = a.task || a.title || "";
      if (!label) continue;
      const owner = a.owner && a.owner !== "Chưa rõ" ? a.owner : "Chưa rõ";
      const due = a.dueDate || (a.due && a.due !== "Chưa rõ" ? a.due : "Chưa rõ");
      const prefix = a.done ? "[Đã xong] " : "";
      lines.push({
        text: `${prefix}${label} — Phụ trách: ${owner} — Hạn: ${due}`,
        style: "NORMAL_TEXT",
        bullet: true,
      });
    }
  }

  if (body.transcript?.trim()) {
    lines.push({ text: "Bản chép lời đầy đủ (Transcript)", style: "HEADING_1" });
    const rawLines = body.transcript.trim().slice(0, 40_000).split(/\r?\n/);
    for (const tl of rawLines) {
      if (tl.trim()) lines.push({ text: tl.trim(), style: "NORMAL_TEXT" });
    }
  }

  return lines;
}

function buildBatchUpdateRequests(lines: StyledLine[]) {
  const fullText = lines.map((l) => `${l.text}\n`).join("");
  const requests: Record<string, unknown>[] = [
    {
      insertText: {
        location: { index: 1 },
        text: fullText,
      },
    },
  ];

  let cursor = 1;
  for (const line of lines) {
    const startIndex = cursor;
    const endIndex = cursor + line.text.length + 1;
    cursor = endIndex;

    if (line.style && line.style !== "NORMAL_TEXT") {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex, endIndex },
          paragraphStyle: { namedStyleType: line.style },
          fields: "namedStyleType",
        },
      });
    }

    if (line.bullet && line.text.length > 0) {
      requests.push({
        createParagraphBullets: {
          range: { startIndex, endIndex },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    }

    if (line.bold && line.text.length > 0) {
      requests.push({
        updateTextStyle: {
          range: { startIndex, endIndex: endIndex - 1 },
          textStyle: { bold: true },
          fields: "bold",
        },
      });
    }
  }

  return requests;
}

export async function POST(req: Request) {
  const { tokens, refreshed } = await getValidGoogleTokens();
  if (!tokens) {
    return NextResponse.json(
      {
        error:
          "Bạn chưa kết nối tài khoản Google có quyền Google Docs. Hãy đăng nhập lại bằng Google OAuth để cấp quyền.",
        needsAuth: true,
      },
      { status: 401 }
    );
  }

  try {
    const body = (await req.json()) as CreateRecapDocBody;
    const docTitle = `[Biên bản họp] ${(body.title || "Cuộc họp").trim()}`;

    // 1. Tạo tài liệu Google Doc mới
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: docTitle }),
    });

    if (createRes.status === 401 || createRes.status === 403) {
      return NextResponse.json(
        {
          error:
            "Chưa có quyền tạo Google Docs (hoặc chưa bật Google Docs API trên Google Cloud Console). Hãy bấm kết nối lại Google để cấp quyền Google Docs.",
          needsAuth: true,
        },
        { status: createRes.status }
      );
    }

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      return NextResponse.json(
        { error: `Không tạo được Google Doc (${createRes.status}): ${errText.slice(0, 160)}` },
        { status: createRes.status }
      );
    }

    const created = (await createRes.json()) as { documentId?: string };
    const documentId = created.documentId;
    if (!documentId) {
      return NextResponse.json({ error: "Google Docs không trả về mã tài liệu." }, { status: 502 });
    }

    // 2. Đổ nội dung biên bản có định dạng Heading / Bullet vào Google Doc
    const lines = buildDocumentLines(body);
    const requests = buildBatchUpdateRequests(lines);

    const batchRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!batchRes.ok) {
      const errText = await batchRes.text().catch(() => "");
      return NextResponse.json(
        {
          error: `Đã tạo file Google Doc nhưng ghi nội dung bị lỗi (${batchRes.status}): ${errText.slice(0, 160)}`,
          docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
        },
        { status: 502 }
      );
    }

    const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
    const response = NextResponse.json({ ok: true, documentId, docUrl });

    if (refreshed) {
      response.cookies.set(GOOGLE_TOKENS_COOKIE_NAME, encryptGoogleTokens(tokens), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
    }

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Lỗi khi tạo Google Doc: ${msg}` }, { status: 500 });
  }
}
