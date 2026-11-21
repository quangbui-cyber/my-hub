"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  BookText,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  ExternalLink,
  FileAudio,
  FileSpreadsheet,
  FileText,
  ListPlus,
  Loader2,
  Mic,
  Pencil,
  Puzzle,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import GoogleCalendarPanel from "@/components/GoogleCalendarPanel";
import MeetingRecorder from "@/components/MeetingRecorder";
import RecapContentView from "@/components/RecapContentView";
import { RecapGlossaryManager, RecapGlossarySuggestions } from "@/components/RecapGlossary";
import {
  RECAP_AUDIO_ACCEPT,
  RECAP_UNCLEAR_TEXT,
  formatClock,
  normalizeRecapContent,
  recapExportContent,
  renderRecapContent,
  unclearTranscriptStats,
  type RecapSummary,
} from "@/lib/meetingRecap";
import {
  mergeGlossarySuggestions,
  suggestGlossaryFromEdit,
} from "@/lib/recapGlossary";
import { useStore, type ActionItem, type Meeting } from "@/lib/store";

type InputMode = "record" | "upload" | "transcript";

const SAMPLE = `[00:05] Lan: Ok mọi người, sync nhanh dự án Q4 nhé. Mục tiêu hôm nay là chốt ngày ra mắt landing page và ngân sách marketing.
[00:22] Minh: Thiết kế landing page bên mình làm gần xong rồi, phần responsive trên mobile đang test nốt, mình cần chốt bản cuối trước ngày 25/11.
[00:45] Lan: Vậy quyết định Minh hoàn tất và chốt thiết kế landing page trước 25/11 nhé. Mình chốt ngày chính thức ra mắt sản phẩm là 30/11.
[01:10] Huy: Về phần quảng cáo, ngân sách marketing tháng này mình đề xuất tăng 10% để đẩy mạnh kênh TikTok và Facebook.
[01:28] Lan: Đồng ý tăng 10% ngân sách marketing. Huy gọi lại khách hàng A để lấy phản hồi bản demo trước thứ Tư tuần này nhé. Còn chi phí thuê KOL bên agency báo giá bao nhiêu thì mình chưa chốt được, để họp tuần sau bàn tiếp.`;

type ApiRecapResponse = RecapSummary & {
  summary: string;
  content: string;
  transcript: string;
  audioSeconds?: number | null;
  audioName?: string | null;
  error?: string;
};

export default function MeetingsPage() {
  const { meetings, glossary, addMeeting, updateMeeting, removeMeeting, addTask } = useStore();
  const [mode, setMode] = useState<InputMode>("record");
  const [title, setTitle] = useState("");
  const [attendeesInput, setAttendeesInput] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showGlossary, setShowGlossary] = useState(false);
  const [showExtensionGuide, setShowExtensionGuide] = useState(false);

  // State sửa biên bản & copy
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [exportingDocId, setExportingDocId] = useState<string | null>(null);

  function buildGlossaryPayload() {
    return {
      terms: glossary.filter((g) => g.kind === "TERM").map((g) => ({ text: g.text, heardAs: g.heardAs })),
      rules: glossary.filter((g) => g.kind === "RULE").map((g) => g.text),
    };
  }

  function mapApiToMeeting(data: ApiRecapResponse, fallbackAttendees: string[]): Omit<Meeting, "id"> {
    const actionItems: ActionItem[] = (data.actionItems ?? []).map((item, idx) => ({
      id: `${Date.now()}-${idx}`,
      title: item.task,
      task: item.task,
      owner: item.owner,
      due: item.due,
      dueDate: item.dueDate,
      done: false,
      pushedToTask: false,
    }));
    return {
      title: data.title || title.trim() || "Biên bản cuộc họp",
      date: new Date().toISOString(),
      summary: data.summary || (data.overview ?? []).join(" "),
      overview: data.overview ?? [],
      topics: data.topics ?? [],
      decisions: data.decisions ?? [],
      actionItems,
      openQuestions: data.openQuestions ?? [],
      content: data.content,
      transcript: data.transcript,
      attendees: fallbackAttendees,
      audioName: data.audioName ?? null,
      audioSeconds: data.audioSeconds ?? null,
      glossarySuggestions: [],
    };
  }

  async function submitTranscript() {
    if (!transcript.trim()) {
      setError("Dán bản chép lời (transcript) cuộc họp trước.");
      return;
    }
    setLoading(true);
    setError("");
    const attendees = attendeesInput
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await fetch("/api/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          attendees,
          transcript,
          glossary: buildGlossaryPayload(),
        }),
      });
      const data = (await res.json()) as ApiRecapResponse;
      if (!res.ok) throw new Error(data.error ?? "Có lỗi xảy ra");
      addMeeting(mapApiToMeeting(data, attendees));
      setTranscript("");
      setTitle("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function submitAudioFile(file: File) {
    setLoading(true);
    setError("");
    const attendees = attendeesInput
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const form = new FormData();
      form.append("file", file);
      if (title.trim()) form.append("title", title.trim());
      if (attendees.length > 0) form.append("attendees", attendees.join(", "));
      form.append("glossary", JSON.stringify(buildGlossaryPayload()));

      const res = await fetch("/api/recap", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as ApiRecapResponse;
      if (!res.ok) throw new Error(data.error ?? "Có lỗi xảy ra khi xử lý file ghi âm");
      addMeeting(mapApiToMeeting(data, attendees));
      setAudioFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTitle("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }

  async function regenerateMeeting(m: Meeting) {
    if (!m.transcript?.trim()) return;
    setRegeneratingId(m.id);
    setError("");
    try {
      const res = await fetch("/api/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: m.title,
          attendees: m.attendees ?? [],
          transcript: m.transcript,
          glossary: buildGlossaryPayload(),
        }),
      });
      const data = (await res.json()) as ApiRecapResponse;
      if (!res.ok) throw new Error(data.error ?? "Không viết lại được biên bản");
      const mapped = mapApiToMeeting(data, m.attendees ?? []);
      updateMeeting(m.id, {
        summary: mapped.summary,
        overview: mapped.overview,
        topics: mapped.topics,
        decisions: mapped.decisions,
        actionItems: mapped.actionItems,
        openQuestions: mapped.openQuestions,
        content: mapped.content,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegeneratingId(null);
    }
  }

  function getMeetingContent(m: Meeting): string {
    if (m.content) return m.content;
    return renderRecapContent({
      title: m.title,
      overview: m.overview?.length ? m.overview : m.summary ? [m.summary] : [],
      topics: m.topics ?? [],
      decisions: m.decisions ?? [],
      actionItems: (m.actionItems ?? []).map((a) => ({
        task: a.task || a.title,
        owner: a.owner || "Chưa rõ",
        due: a.due || "Chưa rõ",
        dueDate: a.dueDate || "",
      })),
      openQuestions: m.openQuestions ?? [],
    });
  }

  function startEditing(m: Meeting) {
    setEditingId(m.id);
    setEditDraft(getMeetingContent(m));
  }

  function saveEditing(m: Meeting) {
    const previous = getMeetingContent(m);
    const cleaned = normalizeRecapContent(editDraft);
    if (!cleaned) return;
    const incoming = suggestGlossaryFromEdit(previous, cleaned);
    const knownTerms = glossary.filter((g) => g.kind === "TERM").map((g) => g.text);
    const nextSuggestions = mergeGlossarySuggestions(m.glossarySuggestions ?? [], incoming, knownTerms);
    updateMeeting(m.id, {
      content: cleaned,
      glossarySuggestions: nextSuggestions,
    });
    setEditingId(null);
  }

  function copyRecap(m: Meeting) {
    const content = getMeetingContent(m);
    const exportText = recapExportContent(
      content,
      (m.actionItems ?? []).map((a) => ({
        task: a.task || a.title,
        owner: a.owner || "Chưa rõ",
        due: a.due || "Chưa rõ",
        dueDate: a.dueDate || "",
        done: a.done,
      }))
    );
    void navigator.clipboard.writeText(`# ${m.title}\n\n${exportText}`);
    setCopiedId(m.id);
    setTimeout(() => setCopiedId((cur) => (cur === m.id ? null : cur)), 2000);
  }

  async function exportToGoogleDoc(m: Meeting) {
    setExportingDocId(m.id);
    setError("");
    try {
      const res = await fetch("/api/docs/recap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: m.title,
          date: m.date,
          attendees: m.attendees ?? [],
          content: getMeetingContent(m),
          actionItems: m.actionItems ?? [],
          transcript: m.transcript ?? "",
          meetingUrl: m.meetingUrl ?? null,
        }),
      });
      const data = (await res.json()) as { docUrl?: string; error?: string; needsAuth?: boolean };
      if (!res.ok) {
        if (data.needsAuth) {
          if (
            window.confirm(
              `${data.error || "Cần cấp quyền Google Docs."}\n\nBấm OK để chuyển sang trang đăng nhập Google và cấp quyền Google Calendar + Google Docs ngay.`
            )
          ) {
            window.location.href = "/api/auth/google";
          }
          return;
        }
        throw new Error(data.error || "Không tạo được Google Doc");
      }
      if (data.docUrl) {
        updateMeeting(m.id, { googleDocUrl: data.docUrl });
        window.open(data.docUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportingDocId(null);
    }
  }

  function toggleActionDone(meeting: Meeting, index: number) {
    const updated = meeting.actionItems.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    updateMeeting(meeting.id, { actionItems: updated });
  }

  function pushSingleTask(meeting: Meeting, index: number) {
    const item = meeting.actionItems[index];
    if (!item || item.pushedToTask) return;
    const ownerLabel = item.owner && item.owner !== "Chưa rõ" ? ` (${item.owner})` : "";
    const dueIso = item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : undefined;
    addTask({
      title: `${item.task || item.title}${ownerLabel}`,
      due: dueIso,
      fromAI: true,
    });
    const updated = meeting.actionItems.map((a, i) => (i === index ? { ...a, pushedToTask: true } : a));
    updateMeeting(meeting.id, { actionItems: updated });
  }

  function pushAllTasks(meeting: Meeting) {
    meeting.actionItems.forEach((item) => {
      if (item.pushedToTask) return;
      const ownerLabel = item.owner && item.owner !== "Chưa rõ" ? ` (${item.owner})` : "";
      const dueIso = item.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ? item.dueDate : undefined;
      addTask({
        title: `${item.task || item.title}${ownerLabel}`,
        due: dueIso,
        fromAI: true,
      });
    });
    updateMeeting(meeting.id, {
      actionItems: meeting.actionItems.map((a) => ({ ...a, pushedToTask: true })),
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Meeting Recap</h1>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/my-hub-recorder-extension.zip"
            download="my-hub-recorder-extension.zip"
            className="btn-primary"
          >
            <Download size={16} />
            Tải Chrome Extension (.zip)
          </a>
          <button
            type="button"
            onClick={() => setShowExtensionGuide((s) => !s)}
            className={showExtensionGuide ? "btn-primary" : "btn-ghost"}
          >
            <Puzzle size={16} />
            Cách cài Extension
          </button>
          <button
            type="button"
            onClick={() => setShowGlossary((s) => !s)}
            className={showGlossary ? "btn-primary" : "btn-ghost"}
          >
            <BookText size={16} />
            Từ điển AI ({glossary.length})
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showExtensionGuide && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="card space-y-3 border-brand-200 bg-brand-50/40 dark:border-brand-900/50 dark:bg-brand-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Puzzle size={18} className="text-brand-600" />
                  My Hub Recorder — Extension bắt link & ghi âm Google Meet, Zoom, Microsoft Teams
                </h2>
                <a
                  href="/my-hub-recorder-extension.zip"
                  download="my-hub-recorder-extension.zip"
                  className="btn-primary !px-3 !py-1.5 text-xs"
                >
                  <Download size={14} />
                  Tải về my-hub-recorder-extension.zip
                </a>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-5 text-ink">
                <li>
                  Bấm <strong>Tải Chrome Extension (.zip)</strong> và giải nén file{" "}
                  <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono dark:bg-black/30">
                    my-hub-recorder-extension.zip
                  </code>{" "}
                  ra máy.
                </li>
                <li>
                  Mở Chrome, vào địa chỉ{" "}
                  <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono dark:bg-black/30">
                    chrome://extensions
                  </code>{" "}
                  và bật <strong>Chế độ dành cho nhà phát triển (Developer mode)</strong> ở góc trên bên phải.
                </li>
                <li>
                  Bấm <strong>Tải tiện ích đã giải nén (Load unpacked)</strong> rồi chọn thư mục{" "}
                  <code className="rounded bg-white/80 px-1.5 py-0.5 font-mono dark:bg-black/30">extension</code> vừa giải nén.
                </li>
                <li>
                  Bấm vào biểu tượng ⚙️ <strong>Cài đặt</strong> trong Extension → bấm <strong>Cấp quyền Micro</strong> 1 lần duy nhất để thu cả giọng nói của bạn cùng âm thanh tab họp.
                </li>
              </ol>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showGlossary && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <RecapGlossaryManager />
          </motion.div>
        )}
      </AnimatePresence>

      <GoogleCalendarPanel
        onSelectForRecap={(ev) => {
          setTitle(ev.title);
          if (ev.attendees.length > 0) setAttendeesInput(ev.attendees.join(", "));
          setMode("record");
          setError("");
        }}
      />

      <div className="card space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Tên cuộc họp</label>
            <input
              className="input"
              placeholder="Ví dụ: Họp kế hoạch Marketing Q4"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Người tham dự</label>
            <input
              className="input"
              placeholder="Ví dụ: Lan Nguyễn, Minh Trần, Huy Lê"
              value={attendeesInput}
              onChange={(e) => setAttendeesInput(e.target.value)}
            />
          </div>
        </div>

        {/* 3 chế độ đầu vào với Sliding Pill */}
        <div className="flex flex-wrap gap-1.5 border-b border-line pb-3">
          {(
            [
              { key: "record", icon: Mic, label: "Ghi âm trực tiếp" },
              { key: "upload", icon: Upload, label: "Tải file ghi âm" },
              { key: "transcript", icon: FileText, label: "Dán bản chép lời" },
            ] as const
          ).map((tab) => {
            const active = mode === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setMode(tab.key);
                  setError("");
                }}
                className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active ? "text-white" : "text-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="meeting-input-mode-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}
                    className="absolute inset-0 rounded-xl bg-gradient-to-b from-brand-500 to-brand-600 shadow-xs"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <tab.icon size={15} />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        {mode === "record" && <MeetingRecorder onSubmitAudio={submitAudioFile} />}

        {mode === "upload" && (
          <div className="space-y-3">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-brand-50/20 px-4 py-8 text-center transition hover:border-brand-400 dark:bg-brand-950/10">
              <FileAudio size={28} className="text-brand-600" />
              <span className="text-sm font-medium text-ink">
                {audioFile ? audioFile.name : "Chọn file ghi âm hoặc video cuộc họp"}
              </span>
              {audioFile && (
                <span className="text-xs text-muted">
                  {(audioFile.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={RECAP_AUDIO_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  setAudioFile(e.target.files?.[0] ?? null);
                  setError("");
                }}
              />
            </label>
            <button
              type="button"
              disabled={!audioFile || loading}
              onClick={() => audioFile && void submitAudioFile(audioFile)}
              className="btn-primary"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Groq đang chép lời & Gemini viết biên bản…" : "Tải lên & Tạo biên bản AI"}
            </button>
          </div>
        )}

        {mode === "transcript" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="tr" className="text-sm font-medium">
                Bản chép lời cuộc họp
              </label>
              <button
                type="button"
                onClick={() => {
                  setTitle("Sync nhanh dự án Q4");
                  setAttendeesInput("Lan, Minh, Huy");
                  setTranscript(SAMPLE);
                  setError("");
                }}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Dùng mẫu thử
              </button>
            </div>
            <textarea
              id="tr"
              rows={7}
              className="input resize-y font-mono text-xs leading-6"
              placeholder="Dán nội dung cuộc họp (từ Google Meet, Zoom, hoặc bản ghi chép) vào đây…"
              value={transcript}
              onChange={(e) => {
                setTranscript(e.target.value);
                setError("");
              }}
            />
            <button type="button" onClick={() => void submitTranscript()} disabled={loading} className="btn-primary">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {loading ? "Gemini đang tổng hợp biên bản…" : "Viết biên bản bằng AI"}
            </button>
          </div>
        )}

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      {/* Danh sách biên bản họp đã tạo */}
      {meetings.map((m) => {
        const content = getMeetingContent(m);
        const isEditing = editingId === m.id;
        const isRegenerating = regeneratingId === m.id;
        const allPushed = m.actionItems.length > 0 && m.actionItems.every((a) => a.pushedToTask);
        const unclear = m.transcript ? unclearTranscriptStats(m.transcript) : { count: 0, seconds: 0 };

        return (
          <article key={m.id} className="card space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
              <div>
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
                  <Sparkles size={18} className="text-brand-600" />
                  {m.title}
                  {m.platform && (
                    <span className="rounded-md bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                      {m.platform === "meet" ? "Google Meet" : m.platform === "zoom" ? "Zoom" : "Microsoft Teams"}
                      {m.meetingCode ? ` · ${m.meetingCode}` : ""}
                    </span>
                  )}
                  {m.fromExtension && (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
                      Chrome Extension
                    </span>
                  )}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(m.date).toLocaleString("vi-VN")}
                  {m.attendees && m.attendees.length > 0 ? ` · Tham dự: ${m.attendees.join(", ")}` : ""}
                  {m.audioSeconds ? ` · Ghi âm ${formatClock(m.audioSeconds)}` : ""}
                  {m.meetingUrl && (
                    <>
                      {" · "}
                      <a
                        href={m.meetingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-600 hover:underline"
                      >
                        Link phòng họp
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {m.googleDocUrl ? (
                  <a
                    href={m.googleDocUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary !px-2.5 !py-1.5 text-xs"
                    title="Mở biên bản trên Google Docs"
                  >
                    <ExternalLink size={14} />
                    Mở Google Doc
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled={exportingDocId === m.id}
                    onClick={() => void exportToGoogleDoc(m)}
                    className="btn-primary !px-2.5 !py-1.5 text-xs"
                    title="Tạo file Google Doc chứa toàn bộ biên bản & action items"
                  >
                    {exportingDocId === m.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FileSpreadsheet size={14} />
                    )}
                    {exportingDocId === m.id ? "Đang tạo Google Doc…" : "Tạo Google Doc"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copyRecap(m)}
                  className="btn-ghost !px-2.5 !py-1.5 text-xs"
                  title="Sao chép biên bản"
                >
                  {copiedId === m.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                  {copiedId === m.id ? "Đã chép" : "Sao chép"}
                </button>
                <button
                  type="button"
                  onClick={() => (isEditing ? setEditingId(null) : startEditing(m))}
                  className="btn-ghost !px-2.5 !py-1.5 text-xs"
                >
                  <Pencil size={14} />
                  {isEditing ? "Huỷ sửa" : "Sửa biên bản"}
                </button>
                {m.transcript && (
                  <button
                    type="button"
                    disabled={isRegenerating}
                    onClick={() => void regenerateMeeting(m)}
                    className="btn-ghost !px-2.5 !py-1.5 text-xs"
                  >
                    <RefreshCw size={14} className={isRegenerating ? "animate-spin" : ""} />
                    {isRegenerating ? "Đang viết lại…" : "Viết lại"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeMeeting(m.id)}
                  aria-label="Xoá biên bản"
                  className="btn-ghost !px-2.5 !py-1.5 text-xs text-muted hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </header>

            {isEditing ? (
              <div className="space-y-3">
                <textarea
                  rows={14}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  className="input text-sm leading-6"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => saveEditing(m)} className="btn-primary !px-3.5 !py-1.5 text-xs">
                    Lưu biên bản
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="btn-ghost !px-3.5 !py-1.5 text-xs"
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            ) : (
              <RecapContentView content={content} />
            )}

            {m.glossarySuggestions && m.glossarySuggestions.length > 0 && (
              <RecapGlossarySuggestions meetingId={m.id} suggestions={m.glossarySuggestions} />
            )}

            {/* Việc cần làm (Action Items) tách riêng giống Taskflow */}
            {m.actionItems.length > 0 && (
              <section className="space-y-2.5 border-t border-line pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-muted">
                    Việc cần làm ({m.actionItems.filter((a) => a.done).length}/{m.actionItems.length})
                  </h3>
                  <button
                    type="button"
                    disabled={allPushed}
                    onClick={() => pushAllTasks(m)}
                    className="btn-ghost !px-3 !py-1 text-xs"
                  >
                    <ListPlus size={14} />
                    {allPushed ? "Đã chuyển hết sang Công việc" : "Thêm tất cả vào Công việc"}
                  </button>
                </div>

                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line text-sm">
                  {m.actionItems.map((a, i) => {
                    const label = a.task || a.title;
                    const owner = a.owner && a.owner !== "Chưa rõ" ? a.owner : null;
                    const dueLabel =
                      a.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)
                        ? new Date(a.dueDate).toLocaleDateString("vi-VN")
                        : a.due && a.due !== "Chưa rõ"
                        ? a.due
                        : null;
                    return (
                      <li key={a.id ?? i} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleActionDone(m, i)}
                          className="text-brand-600"
                          aria-label="Đánh dấu hoàn thành"
                        >
                          {a.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className={`font-medium ${a.done ? "text-muted line-through" : "text-ink"}`}>{label}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span>Phụ trách: {owner ?? "Chưa rõ"}</span>
                            {dueLabel && <span>· Hạn: {dueLabel}</span>}
                          </div>
                        </div>
                        {owner && (
                          <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                            {owner}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={a.pushedToTask}
                          onClick={() => pushSingleTask(m, i)}
                          className="btn-ghost !px-2.5 !py-1 text-xs"
                        >
                          {a.pushedToTask ? "Đã tạo Task" : "+ Tạo Task"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* Bản chép lời đầy đủ (TranscriptDetails) giống Taskflow */}
            {m.transcript && (
              <details className="border-t border-line pt-3">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">
                  Bản chép lời đầy đủ
                  {m.audioSeconds ? ` · ${formatClock(m.audioSeconds)}` : ""}
                  {m.audioName ? ` · ${m.audioName}` : ""}
                  {unclear.count > 0 && (
                    <span className="ml-1 text-amber-600">
                      · {unclear.count} đoạn không nghe rõ ({formatClock(unclear.seconds)})
                    </span>
                  )}
                </summary>
                {unclear.count > 0 && (
                  <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Máy không chép được {unclear.count} đoạn ({formatClock(unclear.seconds)}). Biên bản đã tự động bỏ qua
                      những đoạn này để tránh đoán mò.
                    </span>
                  </p>
                )}
                <pre className="mt-2.5 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-brand-50/40 p-3 font-mono text-xs leading-6 text-ink dark:bg-brand-950/20">
                  {m.transcript.split("\n").map((line, idx) => (
                    <span key={idx} className={line.endsWith(RECAP_UNCLEAR_TEXT) ? "text-amber-600" : undefined}>
                      {line}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </details>
            )}
          </article>
        );
      })}
    </motion.div>
  );
}
