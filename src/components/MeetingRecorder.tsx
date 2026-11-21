"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, Loader2, Mic, Pause, Play, Sparkles, Square, Trash2, Video } from "lucide-react";
import { formatClock } from "@/lib/meetingRecap";
import {
  NO_TAB_AUDIO_MESSAGE,
  RECORDING_BITS_PER_SECOND,
  RECORDING_CHUNK_MS,
  SILENCE_STOP_MS,
  SILENCE_TRIM_KEEP_MS,
  SILENCE_WARN_MS,
  SPEECH_RMS_THRESHOLD,
  canRecordTabAudio,
  displayCaptureErrorMessage,
  micOptions,
  microphoneErrorMessage,
  pickRecordingMimeType,
  preferredMicId,
  recordingFileName,
  recordingFileType,
  rms,
  shouldAutoSubmitRecording,
  trimChunks,
  type MicOption,
  type RecordingSource,
} from "@/lib/meetingRecorder";
import {
  clearRecording,
  loadRecording,
  saveRecordingChunk,
  saveRecordingMeta,
  type RecordingMeta,
} from "@/lib/recordingStore";

type Phase = "loading" | "idle" | "requesting" | "recording" | "paused" | "stopped" | "uploading";

type SavedRecording = {
  blob: Blob;
  mimeType: string;
  startedAt: number;
  durationMs: number;
  recovered: boolean;
};

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};
const MIC_STORAGE_KEY = "my-hub-mic-id";
const SESSION_KEY = "current-session";

function micConstraints(deviceId: string): MediaTrackConstraints {
  return deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS;
}

function readSavedMic(): string | null {
  try {
    return window.localStorage.getItem(MIC_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveMic(deviceId: string) {
  try {
    window.localStorage.setItem(MIC_STORAGE_KEY, deviceId);
  } catch {}
}

export default function MeetingRecorder({
  onSubmitAudio,
}: {
  onSubmitAudio: (file: File) => Promise<void>;
}) {
  const autoSubmitRef = useRef(false);
  const autoSubmitMessageRef = useRef<string | null>(null);
  const lastSoundAtRef = useRef(0);
  const soundAtDurationRef = useRef(0);
  const trimToMsRef = useRef<number | null>(null);
  const [silenceLeftMs, setSilenceLeftMs] = useState<number | null>(null);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [canOnline, setCanOnline] = useState(false);
  const [source, setSource] = useState<RecordingSource>("mic");
  const [liveLabel, setLiveLabel] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [saved, setSaved] = useState<SavedRecording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mics, setMics] = useState<MicOption[]>([]);
  const [micId, setMicId] = useState("");
  const [switchingMic, setSwitchingMic] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const mixCtxRef = useRef<AudioContext | null>(null);
  const mixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micNodesRef = useRef<AudioNode[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const chunkEndsRef = useRef<number[]>([]);
  const seqRef = useRef(0);
  const metaRef = useRef<RecordingMeta | null>(null);
  const accumulatedRef = useRef(0);
  const runStartRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const currentDuration = () =>
    accumulatedRef.current + (runStartRef.current === null ? 0 : performance.now() - runStartRef.current);

  useEffect(() => {
    const canRecord =
      typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
    const tabAudio = canRecord && canRecordTabAudio(navigator.userAgent, Boolean(navigator.mediaDevices?.getDisplayMedia));
    let cancelled = false;
    loadRecording(SESSION_KEY).then((found) => {
      if (cancelled) return;
      setSupported(canRecord);
      setCanOnline(tabAudio);
      if (found) {
        setSaved({
          blob: new Blob(found.chunks, { type: recordingFileType(found.meta.mimeType).type }),
          mimeType: found.meta.mimeType,
          startedAt: found.meta.startedAt,
          durationMs: found.meta.durationMs,
          recovered: true,
        });
        setElapsedMs(found.meta.durationMs);
        setPhase("stopped");
      } else {
        setPhase("idle");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshMics = useCallback(async (): Promise<MicOption[]> => {
    try {
      const options = micOptions(await navigator.mediaDevices.enumerateDevices());
      setMics(options);
      setMicId((current) =>
        current && options.some((option) => option.deviceId === current) ? current : preferredMicId(options, readSavedMic())
      );
      return options;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const onChange = () => void refreshMics();
    const first = window.setTimeout(onChange, 0);
    navigator.mediaDevices.addEventListener?.("devicechange", onChange);
    return () => {
      window.clearTimeout(first);
      navigator.mediaDevices.removeEventListener?.("devicechange", onChange);
    };
  }, [refreshMics]);

  const stopMeter = useCallback(() => {
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);
  }, []);

  const releaseDevices = useCallback(() => {
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    mixCtxRef.current?.close().catch(() => {});
    mixCtxRef.current = null;
    mixDestRef.current = null;
    micNodesRef.current = [];
    stopMeter();
  }, [stopMeter]);

  const stopRecording = useCallback((message?: string) => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (runStartRef.current !== null) {
      accumulatedRef.current += performance.now() - runStartRef.current;
      runStartRef.current = null;
    }
    if (message) setNotice(message);
    recorder.stop();
  }, []);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      releaseDevices();
    },
    [releaseDevices]
  );

  function startMeter(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      void ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const l = rms(event.inputBuffer.getChannelData(0));
        if (l > SPEECH_RMS_THRESHOLD) {
          lastSoundAtRef.current = Date.now();
          soundAtDurationRef.current = currentDuration();
        }
        setLevel(Math.min(1, l * 4));
      };
      src.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);
      audioCtxRef.current = ctx;
    } catch {}
  }

  async function openMic(deviceId: string): Promise<MediaStream> {
    let id = deviceId;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(id) });
    } catch (err) {
      if (!id) throw err;
      id = "";
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints("") });
    }
    const options = await refreshMics();
    if (!id) {
      const better = preferredMicId(options, null);
      if (better) {
        try {
          const real = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(better) });
          stream.getTracks().forEach((track) => track.stop());
          stream = real;
          id = better;
        } catch {}
      }
    }
    setMicId(id);
    return stream;
  }

  async function acquireMicStream(): Promise<MediaStream | null> {
    try {
      const mic = await openMic(micId);
      streamRef.current = mic;
      return mic;
    } catch (err) {
      setError(microphoneErrorMessage(err));
      return null;
    }
  }

  function attachMicToMix(mic: MediaStream) {
    const ctx = mixCtxRef.current;
    const dest = mixDestRef.current;
    if (!ctx || !dest) return;
    micNodesRef.current.forEach((node) => node.disconnect());
    const src = ctx.createMediaStreamSource(mic);
    src.connect(dest);
    micNodesRef.current = [src];
  }

  async function chooseMic(deviceId: string) {
    setMicId(deviceId);
    saveMic(deviceId);
    const ctx = mixCtxRef.current;
    if (source !== "online" || !ctx) return;
    setSwitchingMic(true);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(deviceId) });
      if (mixCtxRef.current !== ctx) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = next;
      attachMicToMix(next);
      setLiveLabel("tab họp + micro");
      setNotice(null);
    } catch (err) {
      setError(microphoneErrorMessage(err));
    } finally {
      setSwitchingMic(false);
    }
  }

  async function revealMics() {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((track) => track.stop());
      await refreshMics();
    } catch (err) {
      setError(microphoneErrorMessage(err));
    }
  }

  async function acquireOnlineStream(): Promise<MediaStream | null> {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
    } catch (err) {
      setError(displayCaptureErrorMessage(err));
      return null;
    }
    if (display.getAudioTracks().length === 0) {
      display.getTracks().forEach((track) => track.stop());
      setError(NO_TAB_AUDIO_MESSAGE);
      return null;
    }
    displayStreamRef.current = display;

    let mic: MediaStream | null = null;
    try {
      mic = await openMic(micId);
      streamRef.current = mic;
    } catch {
      setNotice("Không bật được micro nên chỉ ghi tiếng từ tab cuộc họp (không có giọng của bạn).");
    }

    try {
      const ctx = new AudioContext();
      await ctx.resume().catch(() => {});
      const mixed = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(mixed);
      mixCtxRef.current = ctx;
      mixDestRef.current = mixed;
      if (mic) attachMicToMix(mic);
      return mixed.stream;
    } catch {
      releaseDevices();
      setError("Không trộn được âm thanh tab và micro. Tải lại trang rồi thử lại.");
      return null;
    }
  }

  async function submit(recording: SavedRecording | null = saved) {
    if (!recording) return;
    setError(null);
    setPhase("uploading");
    try {
      const { type } = recordingFileType(recording.mimeType);
      const file = new File([recording.blob], recordingFileName(recording.mimeType, new Date(recording.startedAt)), {
        type,
      });
      await onSubmitAudio(file);
      await clearRecording(SESSION_KEY);
      setSaved(null);
      setElapsedMs(0);
      setNotice(null);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("stopped");
    }
  }

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });

  async function start() {
    setError(null);
    setNotice(null);
    const mimeType = pickRecordingMimeType((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setError("Trình duyệt này không ghi âm được. Hãy dùng Chrome, Edge hoặc Safari mới, hoặc tải file lên.");
      return;
    }

    setPhase("requesting");
    const acquired = source === "online" ? await acquireOnlineStream() : await acquireMicStream();
    if (!acquired) {
      setPhase("idle");
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(acquired, { mimeType, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
    } catch {
      releaseDevices();
      setError("Trình duyệt này không ghi âm được.");
      setPhase("idle");
      return;
    }

    recorderRef.current = recorder;
    setLiveLabel(source === "online" ? (streamRef.current ? "tab họp + micro" : "chỉ tab họp") : null);
    chunksRef.current = [];
    chunkEndsRef.current = [];
    seqRef.current = 0;
    accumulatedRef.current = 0;
    runStartRef.current = performance.now();
    const meta: RecordingMeta = {
      meetingId: SESSION_KEY,
      mimeType: recorder.mimeType || mimeType,
      startedAt: Date.now(),
      durationMs: 0,
      updatedAt: Date.now(),
    };
    metaRef.current = meta;

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      chunksRef.current.push(event.data);
      chunkEndsRef.current.push(currentDuration());
      const seq = seqRef.current++;
      const snapshot = { ...meta, durationMs: currentDuration(), updatedAt: Date.now() };
      void saveRecordingChunk(snapshot, seq, event.data);
    };
    recorder.onerror = () => stopRecording("Ghi âm bị gián đoạn. Phần đã ghi vẫn được giữ.");
    recorder.onstop = () => {
      let durationMs = accumulatedRef.current;
      const trimTo = trimToMsRef.current;
      trimToMsRef.current = null;
      if (trimTo !== null && trimTo < durationMs && chunkEndsRef.current.length === chunksRef.current.length) {
        const trimmed = trimChunks(chunkEndsRef.current, trimTo);
        if (trimmed.keep < chunksRef.current.length) {
          chunksRef.current = chunksRef.current.slice(0, trimmed.keep);
          chunkEndsRef.current = chunkEndsRef.current.slice(0, trimmed.keep);
          durationMs = Math.min(durationMs, trimmed.durationMs);
        }
      }
      releaseDevices();
      void saveRecordingMeta({ ...meta, durationMs: accumulatedRef.current, updatedAt: Date.now() });
      const recording: SavedRecording = {
        blob: new Blob(chunksRef.current, { type: recordingFileType(meta.mimeType).type }),
        mimeType: meta.mimeType,
        startedAt: meta.startedAt,
        durationMs,
        recovered: false,
      };
      setSaved(recording);
      setElapsedMs(durationMs);
      setPhase("stopped");

      if (autoSubmitRef.current) {
        autoSubmitRef.current = false;
        const message =
          autoSubmitMessageRef.current ??
          "Cuộc họp online đã kết thúc (tab họp đã đóng). App đã dừng ghi và đang tạo biên bản…";
        autoSubmitMessageRef.current = null;
        if (shouldAutoSubmitRecording(durationMs)) {
          setNotice(message);
          void submitRef.current(recording);
        } else {
          setNotice("App đã dừng ghi. Bản ghi dưới 30 giây nên chưa tự tạo biên bản.");
        }
      }
    };

    if (source === "online") {
      displayStreamRef.current?.getTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          autoSubmitRef.current = true;
          stopRecording();
        })
      );
    } else {
      streamRef.current?.getAudioTracks()[0]?.addEventListener("ended", () =>
        stopRecording("Micro đã bị ngắt. Phần đã ghi vẫn được giữ.")
      );
    }

    recorder.start(RECORDING_CHUNK_MS);
    setElapsedMs(0);
    setPhase("recording");
    startMeter(acquired);
    lastSoundAtRef.current = Date.now();
    soundAtDurationRef.current = 0;
    trimToMsRef.current = null;
    setSilenceLeftMs(null);

    tickRef.current = window.setInterval(() => {
      const duration = currentDuration();
      setElapsedMs(duration);
      if (recorderRef.current?.state === "paused") return;
      const silentFor = Date.now() - lastSoundAtRef.current;
      if (silentFor >= SILENCE_STOP_MS) {
        trimToMsRef.current = soundAtDurationRef.current + SILENCE_TRIM_KEEP_MS;
        autoSubmitRef.current = true;
        autoSubmitMessageRef.current =
          "Không nghe thấy tiếng nói trong 10 phút nên app tự dừng ghi, bỏ đoạn im lặng ở cuối và đang tạo biên bản…";
        stopRecording();
      } else if (silentFor >= SILENCE_WARN_MS) {
        setSilenceLeftMs(SILENCE_STOP_MS - silentFor);
      } else {
        setSilenceLeftMs(null);
      }
    }, 500);
  }

  function pause() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    if (runStartRef.current !== null) accumulatedRef.current += performance.now() - runStartRef.current;
    runStartRef.current = null;
    setElapsedMs(accumulatedRef.current);
    setPhase("paused");
    if (metaRef.current) {
      void saveRecordingMeta({ ...metaRef.current, durationMs: accumulatedRef.current, updatedAt: Date.now() });
    }
  }

  function resume() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    runStartRef.current = performance.now();
    lastSoundAtRef.current = Date.now();
    soundAtDurationRef.current = currentDuration();
    setPhase("recording");
  }

  async function discard() {
    await clearRecording(SESSION_KEY);
    setSaved(null);
    setElapsedMs(0);
    setNotice(null);
    setError(null);
    setPhase("idle");
  }

  const playUrl = useMemo(() => (saved ? URL.createObjectURL(saved.blob) : null), [saved]);
  useEffect(
    () => () => {
      if (playUrl) URL.revokeObjectURL(playUrl);
    },
    [playUrl]
  );

  if (phase === "loading" || supported === null) {
    return <p className="py-4 text-sm text-muted">Đang kiểm tra micro…</p>;
  }

  const live = phase === "recording" || phase === "paused";
  const micValue = micId || mics[0]?.deviceId || "";
  const micPicker =
    mics.length > 0 ? (
      <div className="relative min-w-0">
        <select
          aria-label="Micro dùng để ghi"
          value={micValue}
          disabled={phase === "requesting" || switchingMic}
          onChange={(event) => void chooseMic(event.target.value)}
          className="input appearance-none pr-10"
        >
          {mics.map((mic) => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
    ) : (
      <button type="button" onClick={() => void revealMics()} className="btn-ghost !px-3 !py-1.5 text-xs">
        <Mic size={14} /> Chọn micro
      </button>
    );

  return (
    <div className="space-y-3">
      {(phase === "idle" || phase === "requesting") && supported && (
        <>
          {canOnline && (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Loại cuộc họp">
              {(
                [
                  { key: "mic", icon: Mic, title: "Họp trực tiếp (Micro)" },
                  { key: "online", icon: Video, title: "Họp online (Google Meet, Zoom…)" },
                ] as const
              ).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={source === option.key}
                  disabled={phase === "requesting"}
                  onClick={() => setSource(option.key)}
                  className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition ${
                    source === option.key
                      ? "border-brand-500 bg-brand-50/70 ring-1 ring-brand-400 dark:bg-brand-950/40"
                      : "border-line hover:border-brand-300"
                  }`}
                >
                  <option.icon size={18} className="shrink-0 text-brand-600" />
                  <span className="text-sm font-medium text-ink">{option.title}</span>
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted">Micro</p>
            {micPicker}
          </div>

          <button
            type="button"
            onClick={() => void start()}
            disabled={phase === "requesting"}
            className="btn-primary"
          >
            <Mic size={16} />
            {phase === "requesting" ? "Đang bật micro…" : "Bắt đầu ghi âm"}
          </button>
        </>
      )}

      {live && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 dark:border-red-900/50 dark:bg-red-950/20">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`h-3 w-3 shrink-0 rounded-full bg-red-500 ${
                phase === "recording" ? "animate-pulse" : "opacity-40"
              }`}
            />
            <span className="text-sm font-medium text-red-700 dark:text-red-300">
              {phase === "recording" ? "Đang ghi âm" : "Đã tạm dừng"}
              {liveLabel && <span className="font-normal"> · {liveLabel}</span>}
            </span>
            <span className="ml-auto font-mono text-2xl tabular-nums text-ink">{formatClock(elapsedMs / 1000)}</span>
          </div>
          <div className="mt-3 flex h-10 items-center justify-center gap-1 rounded-xl bg-white/70 px-3 py-1.5 dark:bg-black/30">
            {Array.from({ length: 28 }, (_, i) => {
              const centerDist = Math.abs(i - 13.5) / 13.5;
              const wave = Math.sin(i * 0.85 + elapsedMs * 0.015) * 0.25 + 0.75;
              const activeLevel = phase === "recording" ? Math.max(0.1, level * (1 - centerDist * 0.55) * wave) : 0.08;
              const pct = Math.min(100, Math.round(activeLevel * 100));
              return (
                <span
                  key={i}
                  className="w-1 rounded-full bg-gradient-to-t from-red-500 to-brand-500 transition-all duration-75"
                  style={{ height: `${Math.max(14, pct)}%` }}
                />
              );
            })}
          </div>
          {source === "online" && <div className="mt-3">{micPicker}</div>}
          {silenceLeftMs !== null && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              Không nghe thấy tiếng nói — sẽ tự dừng và tạo biên bản sau {formatClock(silenceLeftMs / 1000)}.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {phase === "recording" ? (
              <button type="button" onClick={pause} className="btn-ghost bg-panel">
                <Pause size={15} /> Tạm dừng
              </button>
            ) : (
              <button type="button" onClick={resume} className="btn-ghost bg-panel">
                <Play size={15} /> Tiếp tục
              </button>
            )}
            <button type="button" onClick={() => stopRecording()} className="btn-primary bg-red-600 hover:bg-red-700">
              <Square size={15} /> Dừng ghi
            </button>
          </div>
        </div>
      )}

      {(phase === "stopped" || phase === "uploading") && saved && (
        <div className="space-y-3 rounded-xl border border-line bg-brand-50/30 p-4 dark:bg-brand-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-ink">
              {saved.recovered ? "Bản ghi khôi phục từ phiên trước" : "Đã ghi âm xong"} ·{" "}
              {formatClock(saved.durationMs / 1000)}
            </span>
            <span className="text-xs text-muted">{(saved.blob.size / (1024 * 1024)).toFixed(2)} MB</span>
          </div>
          {playUrl && <audio controls src={playUrl} className="h-10 w-full" />}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={phase === "uploading"}
              onClick={() => void submit(saved)}
              className="btn-primary"
            >
              {phase === "uploading" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {phase === "uploading" ? "Groq đang chép lời & Gemini viết biên bản…" : "Chép lời & Tạo biên bản AI"}
            </button>
            {playUrl && (
              <a
                href={playUrl}
                download={recordingFileName(saved.mimeType, new Date(saved.startedAt))}
                className="btn-ghost"
              >
                <Download size={16} /> Tải file ghi âm
              </a>
            )}
            <button
              type="button"
              disabled={phase === "uploading"}
              onClick={() => void discard()}
              className="btn-ghost text-red-600 hover:bg-red-50"
            >
              <Trash2 size={16} /> Xoá bản ghi
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
