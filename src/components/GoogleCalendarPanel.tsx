"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  ExternalLink,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Users,
  Video,
  X,
} from "lucide-react";
import type { CalendarMeetingEvent } from "@/app/api/calendar/events/route";

function formatEventTime(ev: CalendarMeetingEvent): string {
  if (ev.allDay) {
    return new Date(ev.startAt).toLocaleDateString("vi-VN", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
  }
  const start = new Date(ev.startAt);
  const end = ev.endAt ? new Date(ev.endAt) : null;
  const now = new Date();
  const isToday =
    start.getDate() === now.getDate() &&
    start.getMonth() === now.getMonth() &&
    start.getFullYear() === now.getFullYear();

  const timeStart = start.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const timeEnd = end ? end.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";
  const dayLabel = isToday
    ? "Hôm nay"
    : start.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });

  return `${dayLabel} · ${timeStart}${timeEnd ? ` – ${timeEnd}` : ""}`;
}

function platformBadge(platform: CalendarMeetingEvent["platform"]) {
  if (platform === "meet") {
    return (
      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
        Google Meet
      </span>
    );
  }
  if (platform === "zoom") {
    return (
      <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
        Zoom
      </span>
    );
  }
  if (platform === "teams") {
    return (
      <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200">
        Teams
      </span>
    );
  }
  return null;
}

export default function GoogleCalendarPanel({
  compact = false,
  onSelectForRecap,
}: {
  compact?: boolean;
  onSelectForRecap?: (event: CalendarMeetingEvent) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [events, setEvents] = useState<CalendarMeetingEvent[]>([]);
  const [error, setError] = useState("");

  // Form tạo lịch họp nhanh + link Meet
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newStart, setNewStart] = useState(() => {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [newAttendees, setNewAttendees] = useState("");
  const [creating, setCreating] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/calendar/events?days=${compact ? 3 : 7}`, { cache: "no-store" });
      const data = (await res.json()) as {
        connected?: boolean;
        googleConfigured?: boolean;
        events?: CalendarMeetingEvent[];
        error?: string;
      };
      setConnected(Boolean(data.connected));
      setGoogleConfigured(Boolean(data.googleConfigured));
      const list = Array.isArray(data.events) ? data.events : [];
      setEvents(list);
      if (data.error) setError(data.error);

      // Đồng bộ danh sách lịch họp sang Chrome Extension (để Extension tự nhận tên & người tham dự khi vào Meet/Zoom/Teams)
      if (list.length > 0 && typeof window !== "undefined") {
        window.postMessage(
          { type: "MYHUB_CALENDAR_EVENTS_SYNC", events: list },
          window.location.origin
        );
      }
    } catch {
      setError("Không tải được lịch từ Google Calendar.");
    } finally {
      setLoading(false);
    }
  }, [compact]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  async function createCalendarMeeting(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setError("");
    try {
      const startDate = new Date(newStart);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      const attendees = newAttendees
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          startAt: startDate.toISOString(),
          endAt: endDate.toISOString(),
          attendees,
          withMeet: true,
        }),
      });
      const data = (await res.json()) as { event?: CalendarMeetingEvent; error?: string };
      if (!res.ok) throw new Error(data.error || "Không tạo được cuộc họp");
      setNewTitle("");
      setNewAttendees("");
      setShowCreate(false);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi khi tạo cuộc họp");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Calendar size={18} className="text-brand-600" />
          Lịch họp Google Calendar
          {connected && (
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
              Đã liên kết
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          {connected && !compact && (
            <button
              type="button"
              onClick={() => setShowCreate((s) => !s)}
              className="btn-primary !px-3 !py-1.5 text-xs"
            >
              {showCreate ? <X size={14} /> : <Plus size={14} />}
              {showCreate ? "Đóng" : "Tạo lịch + Google Meet"}
            </button>
          )}
          {connected ? (
            <button
              type="button"
              onClick={() => void loadEvents()}
              disabled={loading}
              className="btn-ghost !px-2.5 !py-1.5 text-xs"
              title="Làm mới lịch họp"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Làm mới
            </button>
          ) : (
            <a href="/api/auth/google" className="btn-primary !px-3 !py-1.5 text-xs">
              <Calendar size={14} />
              Liên kết Google Calendar
            </a>
          )}
        </div>
      </div>

      {showCreate && connected && (
        <form
          onSubmit={(e) => void createCalendarMeeting(e)}
          className="space-y-2.5 rounded-xl border border-brand-200 bg-brand-50/40 p-3.5 dark:border-brand-900/50 dark:bg-brand-950/20"
        >
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Tên cuộc họp</label>
              <input
                required
                className="input"
                placeholder="VD: Sync tiến độ dự án Q4"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Thời gian bắt đầu (mặc định 1 tiếng)</label>
              <input
                type="datetime-local"
                required
                className="input"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Email khách mời (cách nhau dấu phẩy, tuỳ chọn — tự động tạo kèm link Google Meet)
            </label>
            <input
              className="input"
              placeholder="lan@gmail.com, minh@gmail.com"
              value={newAttendees}
              onChange={(e) => setNewAttendees(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost !px-3 !py-1.5 text-xs">
              Huỷ
            </button>
            <button type="submit" disabled={creating} className="btn-primary !px-3.5 !py-1.5 text-xs">
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Video size={14} />}
              {creating ? "Đang tạo..." : "Tạo sự kiện & Sinh link Meet"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-3 text-xs text-muted">
          <Loader2 size={15} className="animate-spin" />
          Đang tải lịch họp từ Google Calendar...
        </div>
      ) : !connected ? (
        <div className="rounded-xl border border-dashed border-line bg-brand-50/20 p-4 text-xs leading-relaxed text-muted dark:bg-brand-950/10">
          {googleConfigured ? (
            <p>
              Bấm nút <strong>Liên kết Google Calendar</strong> ở góc trên để tự động kéo lịch họp Google Meet / Zoom / Teams hôm nay & tuần này, tự điền tên + người tham dự khi ghi biên bản AI và đồng bộ sang Chrome Extension.
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="font-medium text-ink">Chưa cấu hình Google OAuth Client để đọc Google Calendar thật:</p>
              <p>
                1. Vào Google Cloud Console → bật <strong>Google Calendar API</strong> → tạo OAuth 2.0 Client ID (Redirect URI:{" "}
                <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-ink dark:bg-black/30">
                  http://localhost:3000/api/auth/google/callback
                </code>
                ).
              </p>
              <p>
                2. Điền <code className="font-mono text-ink">GOOGLE_CLIENT_ID</code> và{" "}
                <code className="font-mono text-ink">GOOGLE_CLIENT_SECRET</code> vào file{" "}
                <code className="font-mono text-ink">.env.local</code>, khởi động lại app rồi bấm{" "}
                <strong>Liên kết Google Calendar</strong>.
              </p>
            </div>
          )}
        </div>
      ) : events.length === 0 ? (
        <p className="py-2 text-xs text-muted">
          Không có lịch họp nào trong {compact ? "3" : "7"} ngày tới trên Google Calendar.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {(compact ? events.slice(0, 4) : events).map((ev) => (
            <li
              key={ev.id}
              className="flex flex-wrap items-center justify-between gap-3 bg-white/60 px-3.5 py-2.5 text-sm dark:bg-zinc-900/40"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-ink">{ev.title}</span>
                  {platformBadge(ev.platform)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{formatEventTime(ev)}</span>
                  {ev.attendees.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      · <Users size={12} /> {ev.attendees.slice(0, 3).join(", ")}
                      {ev.attendees.length > 3 ? ` +${ev.attendees.length - 3}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {ev.meetingUrl && (
                  <a
                    href={ev.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-ghost !px-2.5 !py-1 text-xs"
                  >
                    <ExternalLink size={13} />
                    Vào họp
                  </a>
                )}
                {onSelectForRecap && (
                  <button
                    type="button"
                    onClick={() => onSelectForRecap(ev)}
                    className="btn-primary !px-2.5 !py-1 text-xs"
                  >
                    <Mic size={13} />
                    Chọn để Recap
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
