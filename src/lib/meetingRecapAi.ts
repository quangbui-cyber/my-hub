import {
  RECAP_SUMMARY_SCHEMA,
  parseRecapSummary,
  type RecapSummary,
  type TranscriptSegment,
} from "@/lib/meetingRecap";

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const RECAP_SUMMARY_MAX_OUTPUT_TOKENS = 24_576;
const OUTPUT_TOKENS_RANGE = { min: 4_096, max: 65_536 };
export const RECAP_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type RecapThinkingLevel = (typeof RECAP_THINKING_LEVELS)[number];

/** Lỗi đã có câu báo tiếng Việt, hiện thẳng cho người dùng. */
export class RecapServiceError extends Error {}

export function recapModels(env: NodeJS.ProcessEnv = process.env) {
  return {
    transcribe: env.RECAP_TRANSCRIBE_MODEL?.trim() || "whisper-large-v3",
    summary: env.RECAP_SUMMARY_MODEL?.trim() || "gemini-2.5-flash",
  };
}

export function recapSummarySettings(env: NodeJS.ProcessEnv = process.env) {
  const level = env.RECAP_SUMMARY_THINKING?.trim().toLowerCase() ?? "";
  const thinkingLevel: RecapThinkingLevel = (RECAP_THINKING_LEVELS as readonly string[]).includes(level)
    ? (level as RecapThinkingLevel)
    : "medium";
  const tokens = Number(env.RECAP_SUMMARY_MAX_OUTPUT_TOKENS);
  const maxOutputTokens =
    Number.isInteger(tokens) && tokens >= OUTPUT_TOKENS_RANGE.min && tokens <= OUTPUT_TOKENS_RANGE.max
      ? tokens
      : RECAP_SUMMARY_MAX_OUTPUT_TOKENS;
  return { thinkingLevel, maxOutputTokens };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isTimeout = (error: unknown) =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

function groqError(status: number): RecapServiceError {
  if (status === 401 || status === 403)
    return new RecapServiceError("Groq từ chối API key. Hãy kiểm tra GROQ_API_KEY trong file .env.local.");
  if (status === 413) return new RecapServiceError("File ghi âm quá lớn so với gói Groq hiện tại.");
  if (status === 429) return new RecapServiceError("Groq đang quá tải hoặc đã hết hạn mức. Thử lại sau ít phút.");
  if (status === 400) return new RecapServiceError("Groq không đọc được file ghi âm này. Thử đổi sang mp3 hoặc m4a.");
  return new RecapServiceError(`Groq gặp lỗi (${status}). Thử lại sau ít phút.`);
}

/**
 * Chép lời một file ghi âm qua Groq Whisper (nếu có GROQ_API_KEY)
 * hoặc tự động dùng Gemini Multimodal Audio (nếu chỉ có GEMINI_API_KEY).
 */
export async function transcribeAudioFile({
  file,
  prompt,
  env = process.env,
  timeoutMs = 180_000,
}: {
  file: Blob | File;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{ segments: TranscriptSegment[]; duration: number }> {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return transcribeAudioWithGemini({ file, prompt, env, timeoutMs });
  }
  const deadline = Date.now() + timeoutMs;
  const fileName = file instanceof File && file.name ? file.name : "recording.webm";

  for (let attempt = 1; ; attempt++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft < 10_000) throw new RecapServiceError("Groq xử lý quá lâu. Thử lại với file ngắn hơn.");
    const form = new FormData();
    form.append("model", recapModels(env).transcribe);
    form.append("file", file, fileName);
    form.append("language", "vi");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    if (prompt) form.append("prompt", prompt);

    let res: Response;
    try {
      res = await fetch(GROQ_TRANSCRIBE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeLeft),
      });
    } catch (error) {
      if (isTimeout(error)) throw new RecapServiceError("Groq xử lý quá lâu. Thử lại với file ngắn hơn.");
      if (attempt < 3) {
        await wait(attempt * 3000);
        continue;
      }
      throw new RecapServiceError("Không kết nối được Groq. Thử lại sau ít phút.");
    }

    if (res.ok) {
      const data = (await res.json()) as { duration?: number; text?: string; segments?: TranscriptSegment[] };
      const segments = Array.isArray(data.segments)
        ? data.segments
        : [{ start: 0, text: String(data.text ?? "") }];
      return { segments, duration: Number(data.duration) || segments.at(-1)?.end || 0 };
    }

    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await wait(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 5000, 20_000));
      continue;
    }
    throw groqError(res.status);
  }
}

async function transcribeAudioWithGemini({
  file,
  prompt,
  env = process.env,
  timeoutMs = 180_000,
}: {
  file: Blob | File;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<{ segments: TranscriptSegment[]; duration: number }> {
  const geminiKey = env.GEMINI_API_KEY?.trim();
  if (!geminiKey) {
    throw new RecapServiceError("Chưa cấu hình GROQ_API_KEY hoặc GEMINI_API_KEY trong file .env.local.");
  }
  const model = recapModels(env).summary;
  const arrayBuffer = await file.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = (file.type || "audio/webm").split(";")[0].trim();

  const res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "Bạn là máy chép lời cuộc họp tiếng Việt chính xác. Chép nguyên văn lời nói theo từng đoạn kèm mốc thời gian giây (start, end). " +
              (prompt ? `Từ điển gợi ý tên riêng/thuật ngữ: ${prompt}` : ""),
          },
        ],
      },
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            { text: "Hãy chép lời file ghi âm này thành danh sách các đoạn theo đúng cấu trúc JSON." },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            segments: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  start: { type: "NUMBER", description: "Thời điểm bắt đầu đoạn nói (tính bằng giây, ví dụ 0, 12, 45)" },
                  end: { type: "NUMBER", description: "Thời điểm kết thúc đoạn nói (tính bằng giây)" },
                  text: { type: "STRING", description: "Lời nói tiếng Việt có dấu" },
                },
                required: ["start", "end", "text"],
              },
            },
          },
          required: ["segments"],
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new RecapServiceError(`Không chép lời được bằng Gemini (${res.status}).`);
  }
  const data = (await res.json()) as GeminiResponse;
  const text =
    data.candidates?.[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("") ?? "";
  let parsed: { segments?: TranscriptSegment[] } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {};
  }
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
  const duration = segments.at(-1)?.end || segments.at(-1)?.start || 0;
  return { segments, duration };
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

export const RECAP_SUMMARY_TIMEOUT_MS = 150_000;
const MIN_SUMMARY_ATTEMPT_MS = 20_000;
const SUMMARY_TOO_SLOW = "AI xử lý quá lâu. Thử bấm Viết lại sau ít phút.";

/** Viết biên bản có cấu trúc từ bản chép lời bằng Gemini (hoặc fallback sang Anthropic nếu chưa có GEMINI_API_KEY). */
export async function summarizeTranscript({
  system,
  user,
  fallbackTitle,
  env = process.env,
  timeoutMs = RECAP_SUMMARY_TIMEOUT_MS,
}: {
  system: string;
  user: string;
  fallbackTitle?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Promise<RecapSummary> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new RecapServiceError(
      "Chưa cấu hình GEMINI_API_KEY. Hãy thêm GEMINI_API_KEY vào file .env.local rồi khởi động lại app."
    );
  }
  const model = recapModels(env).summary;
  const { thinkingLevel, maxOutputTokens } = recapSummarySettings(env);
  const deadline = Date.now() + timeoutMs;
  const isGemini3 = /^gemini-3/i.test(model);

  for (let attempt = 1; ; attempt++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft < MIN_SUMMARY_ATTEMPT_MS) throw new RecapServiceError(SUMMARY_TOO_SLOW);
    let res: Response;
    try {
      res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            ...(isGemini3 ? { thinkingConfig: { thinkingLevel } } : {}),
            maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: RECAP_SUMMARY_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(timeLeft),
      });
    } catch (error) {
      if (isTimeout(error)) throw new RecapServiceError(SUMMARY_TOO_SLOW);
      if (attempt < 3) {
        await wait(attempt * 3000);
        continue;
      }
      throw new RecapServiceError("Không kết nối được Gemini. Thử lại sau ít phút.");
    }

    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await wait(attempt * 5000);
        continue;
      }
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        throw new RecapServiceError(
          `Gemini từ chối yêu cầu (${res.status}). Hãy kiểm tra GEMINI_API_KEY và RECAP_SUMMARY_MODEL (${model}).`
        );
      }
      if (res.status === 429)
        throw new RecapServiceError("Gemini đang quá tải hoặc đã hết hạn mức. Thử lại sau ít phút.");
      throw new RecapServiceError(`Gemini gặp lỗi (${res.status}). Thử lại sau ít phút.`);
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const text =
      candidate?.content?.parts
        ?.filter((part) => !part.thought)
        .map((part) => part.text ?? "")
        .join("") ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const summary = parseRecapSummary(parsed, fallbackTitle);
    if (summary) return summary;
    if (candidate?.finishReason === "MAX_TOKENS") {
      throw new RecapServiceError("AI dùng hết giới hạn token trước khi viết xong biên bản.");
    }
    if (attempt < 2) continue;
    if (data.promptFeedback?.blockReason) {
      throw new RecapServiceError("Gemini từ chối nội dung cuộc họp này. Thử viết lại hoặc tự soạn biên bản.");
    }
    throw new RecapServiceError("AI không viết được biên bản từ bản chép lời này. Thử bấm Viết lại.");
  }
}
