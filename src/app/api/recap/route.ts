import {
  RECAP_MAX_AUDIO_BYTES,
  badTranscriptWindows,
  buildRecapPrompt,
  buildTranscriptionPrompt,
  cleanTranscriptSegments,
  formatTranscript,
  limitTranscriptForSummary,
  mergeRecoveredSegments,
  renderRecapContent,
  transcriptionHintWords,
} from "@/lib/meetingRecap";
import { RecapServiceError, summarizeTranscript, transcribeAudioFile } from "@/lib/meetingRecapAi";
import type { GlossaryTerm } from "@/lib/recapGlossary";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function jsonWithCors(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...(init?.headers ?? {}),
    },
  });
}

type GlossaryPayload = {
  terms?: GlossaryTerm[];
  rules?: string[];
};

function parseGlossary(raw: unknown): { terms: GlossaryTerm[]; rules: string[] } {
  if (!raw || typeof raw !== "object") return { terms: [], rules: [] };
  const obj = raw as GlossaryPayload;
  const terms = Array.isArray(obj.terms)
    ? obj.terms
        .map((t) => ({
          text: typeof t?.text === "string" ? t.text.trim() : "",
          heardAs: typeof t?.heardAs === "string" && t.heardAs.trim() ? t.heardAs.trim() : null,
        }))
        .filter((t) => t.text)
    : [];
  const rules = Array.isArray(obj.rules)
    ? obj.rules.map((r) => (typeof r === "string" ? r.trim() : "")).filter(Boolean)
    : [];
  return { terms, rules };
}

function parseAttendees(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let transcript = "";
    let title = "";
    let attendees: string[] = [];
    let glossary: { terms: GlossaryTerm[]; rules: string[] } = { terms: [], rules: [] };
    let audioSeconds: number | null = null;
    let audioName: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      title = String(form.get("title") ?? "").trim();
      attendees = parseAttendees(form.get("attendees"));
      try {
        const glossaryStr = form.get("glossary");
        if (typeof glossaryStr === "string" && glossaryStr) {
          glossary = parseGlossary(JSON.parse(glossaryStr));
        }
      } catch {
        // ignore invalid glossary JSON
      }

      if (!(file instanceof Blob) || file.size === 0) {
        return jsonWithCors({ error: "Không tìm thấy file ghi âm để xử lý." }, { status: 400 });
      }
      if (file.size > RECAP_MAX_AUDIO_BYTES) {
        return jsonWithCors({ error: "File ghi âm vượt quá giới hạn 100 MB." }, { status: 400 });
      }

      audioName = file instanceof File && file.name ? file.name : "recording.webm";
      const hintWords = transcriptionHintWords(title, attendees);
      const whisperPrompt = buildTranscriptionPrompt(
        title,
        attendees,
        glossary.terms.map((t) => t.text)
      );

      const firstPass = await transcribeAudioFile({ file, prompt: whisperPrompt });
      const primary = cleanTranscriptSegments(firstPass.segments);
      let merged = mergeRecoveredSegments(primary, hintWords);

      // Nếu lần chép đầu có đoạn hỏng (echo gợi ý hoặc rơi dấu), chép lại lần 2 không kèm gợi ý để cứu các đoạn đó
      if (badTranscriptWindows(primary, hintWords).length > 0) {
        try {
          const retry = await transcribeAudioFile({ file, prompt: "" });
          const recovered = cleanTranscriptSegments(retry.segments);
          if (recovered.length > 0) {
            merged = mergeRecoveredSegments(primary, hintWords, recovered);
          }
        } catch {
          // Giữ bản chép lần đầu nếu lần 2 lỗi
        }
      }

      transcript = formatTranscript(merged);
      audioSeconds = Math.round(firstPass.duration);
    } else {
      const body = (await req.json().catch(() => ({}))) as {
        transcript?: string;
        title?: string;
        attendees?: string[] | string;
        glossary?: unknown;
      };
      transcript = String(body.transcript ?? "").trim();
      title = String(body.title ?? "").trim();
      attendees = parseAttendees(body.attendees);
      glossary = parseGlossary(body.glossary);
    }

    if (!transcript.trim()) {
      return jsonWithCors(
        { error: "Không nghe được lời nói nào hoặc chưa có transcript cuộc họp." },
        { status: 400 }
      );
    }

    const when = new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());

    const prompt = buildRecapPrompt(
      {
        title: title || undefined,
        when: `${when} (giờ Việt Nam)`,
        attendees,
      },
      limitTranscriptForSummary(transcript),
      glossary
    );

    const summary = await summarizeTranscript({
      ...prompt,
      fallbackTitle: title || "Biên bản cuộc họp",
    });

    const content = renderRecapContent(summary);

    return jsonWithCors({
      title: title || summary.title,
      summary: summary.overview.join(" "),
      overview: summary.overview,
      topics: summary.topics,
      decisions: summary.decisions,
      actionItems: summary.actionItems,
      openQuestions: summary.openQuestions,
      content,
      transcript,
      audioSeconds,
      audioName,
    });
  } catch (error) {
    if (error instanceof RecapServiceError) {
      return jsonWithCors({ error: error.message }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : String(error);
    return jsonWithCors({ error: `Không tạo được biên bản: ${msg}` }, { status: 500 });
  }
}
