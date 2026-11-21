/**
 * Phần thuần của chức năng ghi âm trong app (không đụng trình duyệt).
 */

export const RECORDING_CHUNK_MS = 5000;
export const RECORDING_BITS_PER_SECOND = 48_000;

export const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
] as const;

export function pickRecordingMimeType(isTypeSupported: (type: string) => boolean): string | null {
  for (const type of RECORDING_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {
      // Một số trình duyệt ném lỗi với chuỗi lạ — bỏ qua và thử loại tiếp theo.
    }
  }
  return null;
}

export function recordingFileType(mimeType: string): { type: string; extension: string } {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "video/mp4") return { type: "audio/mp4", extension: ".m4a" };
  if (base === "audio/ogg") return { type: "audio/ogg", extension: ".ogg" };
  return { type: "audio/webm", extension: ".webm" };
}

export function recordingFileName(mimeType: string, startedAt: Date): string {
  const vn = new Date(startedAt.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}-${pad(
    vn.getUTCHours()
  )}${pad(vn.getUTCMinutes())}`;
  return `ghi-am-${stamp}${recordingFileType(mimeType).extension}`;
}

export function microphoneErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Trình duyệt chưa cho dùng micro. Bấm biểu tượng ổ khoá cạnh địa chỉ trang, cho phép Micro rồi thử lại.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Không tìm thấy micro. Kiểm tra tai nghe hoặc micro đã cắm chưa rồi thử lại.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Micro đang bị ứng dụng khác dùng (Zoom, Meet…). Tắt ứng dụng đó hoặc chọn micro khác rồi thử lại.";
  }
  return "Không bật được micro. Tải lại trang rồi thử lại.";
}

export type RecordingSource = "mic" | "online";

export function canRecordTabAudio(userAgent: string, hasGetDisplayMedia: boolean): boolean {
  if (!hasGetDisplayMedia) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return false;
  if (/Firefox\//.test(userAgent)) return false;
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent);
}

export const NO_TAB_AUDIO_MESSAGE =
  "Chưa lấy được âm thanh của tab họp. Bấm Bắt đầu lại, chọn tab cuộc họp và bật “Chia sẻ âm thanh của tab” trước khi bấm Chia sẻ.";

export function displayCaptureErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return "Bạn chưa chọn tab cuộc họp để chia sẻ. Bấm Bắt đầu ghi âm, chọn tab Google Meet/Zoom rồi bấm Chia sẻ.";
  }
  if (name === "NotSupportedError" || name === "TypeError") {
    return "Trình duyệt này không chia sẻ được âm thanh tab. Hãy dùng Chrome hoặc Edge trên máy tính.";
  }
  return "Không chia sẻ được tab cuộc họp. Tải lại trang rồi thử lại.";
}

export type MicOption = { deviceId: string; label: string };

const VIRTUAL_MIC = /zoom|teams|blackhole|loopback|soundflower|virtual|\bobs\b|\bndi\b|aggregate|ecamm|camo/i;

export function isVirtualMic(label: string): boolean {
  return VIRTUAL_MIC.test(label);
}

export function micOptions(
  devices: readonly { kind: string; deviceId: string; label: string }[]
): MicOption[] {
  return devices
    .filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "communications")
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label.trim() || `Micro ${index + 1}` }));
}

export function preferredMicId(options: readonly MicOption[], savedId: string | null): string {
  if (savedId && options.some((option) => option.deviceId === savedId)) return savedId;
  const fallback = options.find((option) => option.deviceId === "default") ?? options[0];
  if (!fallback || !isVirtualMic(fallback.label)) return "";
  const real = options.find((option) => option.deviceId !== "default" && !isVirtualMic(option.label));
  return real?.deviceId ?? "";
}

export const AUTO_SUBMIT_MIN_MS = 30_000;

export function shouldAutoSubmitRecording(durationMs: number): boolean {
  return durationMs >= AUTO_SUBMIT_MIN_MS;
}

export const SILENCE_STOP_MS = 10 * 60 * 1000;
export const SILENCE_WARN_MS = 7 * 60 * 1000;
export const SPEECH_RMS_THRESHOLD = 0.012;
export const SILENCE_TRIM_KEEP_MS = 30 * 1000;

export function trimChunks(
  chunkEndsMs: readonly number[],
  keepUntilMs: number
): { keep: number; durationMs: number } {
  if (chunkEndsMs.length === 0) return { keep: 0, durationMs: 0 };
  let keep = chunkEndsMs.findIndex((end) => end >= keepUntilMs) + 1;
  if (keep === 0) keep = chunkEndsMs.length;
  keep = Math.max(1, keep);
  return { keep, durationMs: chunkEndsMs[keep - 1] };
}

export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
