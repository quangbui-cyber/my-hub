"use client";

import { useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flag,
  GanttChart,
  List,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useStore, type Task } from "@/lib/store";

type Filter = "all" | "open" | "done";
type ViewMode = "gantt" | "calendar" | "list";

const BAR_PALETTE = [
  "bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-600/25",
  "bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-sm shadow-violet-600/25",
  "bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-sm shadow-indigo-600/25",
  "bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow-sm shadow-fuchsia-600/25",
  "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm shadow-blue-600/25",
  "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm shadow-amber-600/25",
];

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(d: Date, delta: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + delta);
  return next;
}

function formatShortVN(iso?: string): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function resolveTaskRange(t: Task, fallbackIso: string): { start: string; end: string } {
  const rawStart = t.startDate || t.due || fallbackIso;
  const rawEnd = t.due || t.startDate || fallbackIso;
  return rawStart <= rawEnd
    ? { start: rawStart, end: rawEnd }
    : { start: rawEnd, end: rawStart };
}

export default function TasksPage() {
  const { tasks, addTask, updateTask, toggleTask, removeTask } = useStore();
  const todayIso = useMemo(() => toIsoDate(new Date()), []);

  const [view, setView] = useState<ViewMode>("gantt");
  const [filter, setFilter] = useState<Filter>("all");

  // Form thêm nhanh
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(todayIso);
  const [due, setDue] = useState("");
  const [error, setError] = useState("");

  // Điều hướng thời gian cho Gantt (cửa sổ 14 ngày) & Calendar (tháng)
  const [ganttOffsetDays, setGanttOffsetDays] = useState(-3);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Modal chỉnh sửa chi tiết hoặc thêm công việc theo ngày trên lịch
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDue, setQuickDue] = useState("");

  const shown = useMemo(
    () =>
      tasks.filter((t) =>
        filter === "all" ? true : filter === "done" ? t.done : !t.done
      ),
    [tasks, filter]
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Nhập tên công việc trước");
    const effectiveStart = startDate || due || todayIso;
    const effectiveDue = due || startDate || todayIso;
    const [s, d] =
      effectiveStart <= effectiveDue
        ? [effectiveStart, effectiveDue]
        : [effectiveDue, effectiveStart];
    addTask({
      title: title.trim(),
      startDate: s,
      due: d,
    });
    setTitle("");
    setDue("");
    setError("");
  }

  function submitQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickAddDate || !quickTitle.trim()) return;
    const end = quickDue && quickDue >= quickAddDate ? quickDue : quickAddDate;
    addTask({
      title: quickTitle.trim(),
      startDate: quickAddDate,
      due: end,
    });
    setQuickTitle("");
    setQuickDue("");
    setQuickAddDate(null);
  }

  // Danh sách 14 ngày cho biểu đồ Gantt
  const ganttDays = useMemo(() => {
    const base = addDays(parseIsoDate(todayIso), ganttOffsetDays);
    const dowLabels = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
    return Array.from({ length: 14 }, (_, i) => {
      const dt = addDays(base, i);
      const iso = toIsoDate(dt);
      const dow = dt.getDay();
      return {
        iso,
        dayNum: dt.getDate(),
        monthNum: dt.getMonth() + 1,
        dowLabel: dowLabels[dow],
        isToday: iso === todayIso,
        isWeekend: dow === 0 || dow === 6,
      };
    });
  }, [todayIso, ganttOffsetDays]);

  // Lưới ngày cho chế độ Lịch (Calendar)
  const calendarCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = addDays(firstDay, -startOffset);
    const lastOfMonth = new Date(year, month + 1, 0);
    const totalNeeded = startOffset + lastOfMonth.getDate() > 35 ? 42 : 35;

    return Array.from({ length: totalNeeded }, (_, i) => {
      const dt = addDays(gridStart, i);
      const iso = toIsoDate(dt);
      return {
        iso,
        dayNum: dt.getDate(),
        monthNum: dt.getMonth() + 1,
        inCurrentMonth: dt.getMonth() === month,
        isToday: iso === todayIso,
      };
    });
  }, [calMonth, todayIso]);

  const ganttRangeLabel = useMemo(() => {
    if (ganttDays.length === 0) return "";
    const first = ganttDays[0];
    const last = ganttDays[ganttDays.length - 1];
    return `${first.dayNum}/${first.monthNum} – ${last.dayNum}/${last.monthNum}`;
  }, [ganttDays]);

  const calMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("vi-VN", {
        month: "long",
        year: "numeric",
      }).format(calMonth),
    [calMonth]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="space-y-5"
    >
      {/* Header + Notion View Switcher với Sliding Pill */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Công việc</h1>

        {/* Notion-style View Tabs */}
        <div className="flex items-center gap-1 rounded-xl border border-line bg-panel/90 p-1 shadow-xs">
          {(
            [
              { id: "gantt", label: "Biểu đồ Gantt", icon: GanttChart },
              { id: "calendar", label: "Lịch", icon: CalendarIcon },
              { id: "list", label: "Danh sách", icon: List },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? "text-white" : "text-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="tasks-view-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}
                    className="absolute inset-0 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600 shadow-xs"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Icon size={14} />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Form Thêm Công Việc */}
      <form
        onSubmit={submit}
        className="card flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted">
            Tên công việc
          </label>
          <input
            className="input"
            placeholder="Ví dụ: Gửi báo giá cho khách hàng B"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setError("");
            }}
          />
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
        <div className="sm:w-40">
          <label className="mb-1 block text-xs font-medium text-muted">
            Ngày bắt đầu
          </label>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="sm:w-40">
          <label className="mb-1 block text-xs font-medium text-muted">
            Hạn chót (Due)
          </label>
          <input
            type="date"
            className="input"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
        <button className="btn-primary justify-center sm:h-[38px]">
          <Plus size={16} /> Thêm việc
        </button>
      </form>

      {/* Thanh Filter & Điều hướng thời gian */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-panel/80 p-1">
          {(["all", "open", "done"] as Filter[]).map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`relative cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "text-brand-800 dark:text-brand-100"
                    : "text-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="tasks-filter-pill"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-lg bg-brand-100 dark:bg-brand-900/60"
                  />
                )}
                <span className="relative z-10">
                  {f === "open"
                    ? `Đang làm (${tasks.filter((t) => !t.done).length})`
                    : f === "done"
                    ? `Đã xong (${tasks.filter((t) => t.done).length})`
                    : `Tất cả (${tasks.length})`}
                </span>
              </button>
            );
          })}
        </div>

        {view === "gantt" && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="mr-1 tabular-nums text-muted">{ganttRangeLabel}</span>
            <button
              type="button"
              onClick={() => setGanttOffsetDays((d) => d - 7)}
              className="btn-ghost !px-2 !py-1 text-xs"
              title="Lùi 1 tuần"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setGanttOffsetDays(-3)}
              className="btn-ghost !px-2.5 !py-1 text-xs"
            >
              Hôm nay
            </button>
            <button
              type="button"
              onClick={() => setGanttOffsetDays((d) => d + 7)}
              className="btn-ghost !px-2 !py-1 text-xs"
              title="Tiến 1 tuần"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {view === "calendar" && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="mr-1 font-medium capitalize text-ink">
              {calMonthLabel}
            </span>
            <button
              type="button"
              onClick={() =>
                setCalMonth(
                  (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)
                )
              }
              className="btn-ghost !px-2 !py-1 text-xs"
              title="Tháng trước"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCalMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }}
              className="btn-ghost !px-2.5 !py-1 text-xs"
            >
              Tháng này
            </button>
            <button
              type="button"
              onClick={() =>
                setCalMonth(
                  (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)
                )
              }
              className="btn-ghost !px-2 !py-1 text-xs"
              title="Tháng sau"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ==================== CHUYỂN ĐỔI MƯỢT GIỮA 3 CHẾ ĐỘ XEM ==================== */}
      <AnimatePresence mode="wait">
        {view === "gantt" && (
          <motion.div
            key="view-gantt"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="card overflow-hidden p-0"
          >
            <div className="grid grid-cols-12 text-xs">
              {/* Cột trái: Danh sách đầu việc */}
              <div className="col-span-12 border-b border-line md:col-span-4 md:border-b-0 md:border-r">
                <div className="flex h-12 items-center justify-between border-b border-line bg-brand-50/40 px-4 font-medium text-muted dark:bg-brand-950/20">
                  <span>Công việc ({shown.length})</span>
                  <span>Thời hạn</span>
                </div>
                <div className="divide-y divide-line">
                  {shown.length === 0 && (
                    <div className="p-5 text-sm text-muted">
                      Không có công việc nào ở bộ lọc này.
                    </div>
                  )}
                  {shown.map((t) => {
                    const range = resolveTaskRange(t, todayIso);
                    return (
                      <div
                        key={t.id}
                        className="flex h-11 items-center justify-between gap-2 px-4 transition hover:bg-brand-50/30 dark:hover:bg-brand-950/20"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <motion.button
                            whileTap={{ scale: 0.8 }}
                            type="button"
                            onClick={() => toggleTask(t.id)}
                            className="shrink-0 text-brand-600"
                            aria-label="Đánh dấu xong"
                          >
                            {t.done ? (
                              <CheckCircle2 size={17} />
                            ) : (
                              <Circle size={17} />
                            )}
                          </motion.button>
                          <button
                            type="button"
                            onClick={() => setEditingTask(t)}
                            className={`truncate text-left hover:underline ${
                              t.done ? "text-muted line-through" : "font-medium"
                            }`}
                            title="Bấm để chỉnh ngày bắt đầu / hạn chót"
                          >
                            {t.title}
                          </button>
                          {t.fromAI && (
                            <span className="chip shrink-0 bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                              AI
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 tabular-nums text-[11px] text-muted">
                          {formatShortVN(range.start)}
                          {range.end !== range.start
                            ? `→${formatShortVN(range.end)}`
                            : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cột phải: Lưới Timeline 14 ngày */}
              <div className="col-span-12 overflow-x-auto md:col-span-8">
                <div className="min-w-[560px]">
                  {/* Header ngày */}
                  <div
                    className="grid h-12 border-b border-line bg-brand-50/40 dark:bg-brand-950/20"
                    style={{
                      gridTemplateColumns: `repeat(${ganttDays.length}, minmax(40px, 1fr))`,
                    }}
                  >
                    {ganttDays.map((day) => (
                      <div
                        key={day.iso}
                        className={`flex flex-col items-center justify-center border-r border-line last:border-r-0 ${
                          day.isToday
                            ? "bg-brand-100/70 font-semibold dark:bg-brand-900/40"
                            : day.isWeekend
                            ? "opacity-60"
                            : ""
                        }`}
                      >
                        <span className="text-[10px] text-muted">
                          {day.dowLabel}
                        </span>
                        <span
                          className={`mt-0.5 text-xs ${
                            day.isToday
                              ? "rounded-full bg-brand-600 px-1.5 py-0.2 text-white shadow-xs"
                              : ""
                          }`}
                        >
                          {day.dayNum}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Các dòng thanh tiến độ Gantt */}
                  <div className="divide-y divide-line">
                    {shown.length === 0 && (
                      <div className="flex h-24 items-center justify-center text-xs text-muted">
                        Thêm công việc với ngày bắt đầu và hạn chót để hiển thị trên biểu đồ Gantt.
                      </div>
                    )}
                    {shown.map((t, idx) => {
                      const range = resolveTaskRange(t, todayIso);
                      const winStart = ganttDays[0].iso;
                      const winEnd = ganttDays[ganttDays.length - 1].iso;
                      const visible =
                        range.end >= winStart && range.start <= winEnd;

                      const clampedStart =
                        range.start < winStart ? winStart : range.start;
                      const clampedEnd = range.end > winEnd ? winEnd : range.end;

                      const startIndex = ganttDays.findIndex(
                        (d) => d.iso === clampedStart
                      );
                      const endIndex = ganttDays.findIndex(
                        (d) => d.iso === clampedEnd
                      );

                      const leftPct =
                        startIndex >= 0
                          ? (startIndex / ganttDays.length) * 100
                          : 0;
                      const span =
                        startIndex >= 0 && endIndex >= startIndex
                          ? endIndex - startIndex + 1
                          : 1;
                      const widthPct = (span / ganttDays.length) * 100;
                      const barColor =
                        BAR_PALETTE[idx % BAR_PALETTE.length];

                      return (
                        <div
                          key={t.id}
                          className="relative grid h-11 items-center"
                          style={{
                            gridTemplateColumns: `repeat(${ganttDays.length}, minmax(40px, 1fr))`,
                          }}
                        >
                          {ganttDays.map((day) => (
                            <div
                              key={day.iso}
                              className={`h-full border-r border-line last:border-r-0 ${
                                day.isToday
                                  ? "bg-brand-100/30 dark:bg-brand-900/20"
                                  : ""
                              }`}
                            />
                          ))}

                          {visible && startIndex >= 0 && (
                            <motion.button
                              initial={{ opacity: 0, scaleX: 0.4 }}
                              animate={{ opacity: 1, scaleX: 1 }}
                              whileHover={{ scale: 1.015, y: -1 }}
                              transition={{
                                duration: 0.35,
                                delay: idx * 0.04,
                                ease: "easeOut",
                              }}
                              style={{
                                transformOrigin: "left center",
                                left: `calc(${leftPct}% + 3px)`,
                                width: `calc(${widthPct}% - 6px)`,
                              }}
                              type="button"
                              onClick={() => setEditingTask(t)}
                              title={`${t.title} (${formatShortVN(
                                range.start
                              )} → ${formatShortVN(range.end)}) — Bấm để sửa`}
                              className={`absolute flex h-7 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-lg px-2.5 text-xs font-medium transition ${
                                t.done
                                  ? "bg-neutral-400/70 text-white line-through dark:bg-neutral-600"
                                  : barColor
                              }`}
                            >
                              <span className="truncate">
                                {t.done ? "✓ " : ""}
                                {t.title}
                              </span>
                            </motion.button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ==================== 2. CHẾ ĐỘ LỊCH (NOTION CALENDAR) ==================== */}
        {view === "calendar" && (
          <motion.div
            key="view-calendar"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="card overflow-hidden p-0"
          >
            {/* Header Thứ trong tuần */}
            <div className="grid grid-cols-7 border-b border-line bg-brand-50/40 text-xs font-medium text-muted dark:bg-brand-950/20">
              {["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "CN"].map(
                (d) => (
                  <div
                    key={d}
                    className="border-r border-line py-2.5 text-center last:border-r-0"
                  >
                    {d}
                  </div>
                )
              )}
            </div>

            {/* Lưới các ô ngày */}
            <div className="grid grid-cols-7 divide-x divide-y divide-line">
              {calendarCells.map((cell) => {
                const dayTasks = shown.filter((t) => {
                  const range = resolveTaskRange(t, todayIso);
                  return range.start <= cell.iso && range.end >= cell.iso;
                });

                return (
                  <div
                    key={cell.iso}
                    className={`group flex min-h-28 flex-col gap-1 p-1.5 transition ${
                      cell.isToday
                        ? "bg-brand-50/70 dark:bg-brand-950/30"
                        : !cell.inCurrentMonth
                        ? "bg-neutral-50/60 opacity-55 dark:bg-neutral-900/30"
                        : "hover:bg-brand-50/20 dark:hover:bg-brand-950/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs font-medium ${
                          cell.isToday
                            ? "rounded-md bg-brand-600 px-1.5 py-0.5 text-white shadow-xs"
                            : "text-muted"
                        }`}
                      >
                        {cell.dayNum}
                        {cell.dayNum === 1 ? `/${cell.monthNum}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickAddDate(cell.iso);
                          setQuickDue(cell.iso);
                          setQuickTitle("");
                        }}
                        title={`Thêm việc ngày ${formatShortVN(cell.iso)}`}
                        className="rounded p-0.5 text-muted opacity-0 transition hover:bg-brand-100 hover:text-brand-700 group-hover:opacity-100 dark:hover:bg-brand-900/50"
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    <div className="mt-0.5 space-y-1">
                      {dayTasks.map((t) => {
                        const range = resolveTaskRange(t, todayIso);
                        const isDueDay = range.end === cell.iso;
                        return (
                          <motion.div
                            layout
                            whileHover={{ scale: 1.02 }}
                            key={t.id}
                            onClick={() => setEditingTask(t)}
                            title={`${t.title} (${formatShortVN(
                              range.start
                            )} → ${formatShortVN(range.end)})`}
                            className={`flex cursor-pointer items-center gap-1 truncate rounded-md border px-1.5 py-1 text-[11px] transition ${
                              t.done
                                ? "border-line bg-neutral-100/80 text-muted line-through dark:bg-neutral-800/50"
                                : "border-brand-200 bg-brand-50 text-brand-900 shadow-2xs dark:border-brand-800 dark:bg-brand-900/50 dark:text-brand-100"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTask(t.id);
                              }}
                              className="shrink-0 text-brand-600"
                            >
                              {t.done ? (
                                <CheckCircle2 size={12} />
                              ) : (
                                <Circle size={12} />
                              )}
                            </button>
                            <span className="truncate font-medium">
                              {t.title}
                            </span>
                            {isDueDay && !t.done && (
                              <Flag
                                size={10}
                                className="ml-auto shrink-0 text-brand-600"
                              />
                            )}
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ==================== 3. CHẾ ĐỘ DANH SÁCH (LIST) ==================== */}
        {view === "list" && (
          <motion.ul
            key="view-list"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="card divide-y divide-line overflow-hidden p-0"
          >
            {shown.length === 0 && (
              <li className="p-5 text-sm text-muted">
                Không có công việc nào ở đây.
              </li>
            )}
            <AnimatePresence initial={false}>
              {shown.map((t) => {
                const range = resolveTaskRange(t, todayIso);
                return (
                  <motion.li
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{ duration: 0.18 }}
                    key={t.id}
                    className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-brand-50/30 dark:hover:bg-brand-950/20"
                  >
                    <motion.button
                      whileTap={{ scale: 0.8 }}
                      onClick={() => toggleTask(t.id)}
                      aria-label="Đánh dấu xong"
                      className="text-brand-600"
                    >
                      {t.done ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        <Circle size={20} />
                      )}
                    </motion.button>
                    <button
                      type="button"
                      onClick={() => setEditingTask(t)}
                      className={`flex-1 text-left hover:underline ${
                        t.done ? "text-muted line-through" : "font-medium"
                      }`}
                    >
                      {t.title}
                    </button>
                    {t.fromAI && (
                      <span className="chip bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                        AI
                      </span>
                    )}
                    {(t.startDate || t.due) && (
                      <span className="tabular-nums text-xs text-muted">
                        {formatShortVN(range.start)}
                        {range.end !== range.start
                          ? ` → ${formatShortVN(range.end)}`
                          : ""}
                      </span>
                    )}
                    <button
                      onClick={() => removeTask(t.id)}
                      aria-label="Xoá"
                      className="text-muted transition hover:scale-110 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </AnimatePresence>

      {/* Modal Thêm nhanh công việc khi bấm nút + trên ô Lịch */}
      <AnimatePresence>
        {quickAddDate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          >
            <motion.form
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              onSubmit={submitQuickAdd}
              className="card w-full max-w-md space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">
                  Thêm việc ngày {formatShortVN(quickAddDate)}
                </h3>
                <button
                  type="button"
                  onClick={() => setQuickAddDate(null)}
                  className="text-muted hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Tên công việc
                  </label>
                  <input
                    autoFocus
                    className="input"
                    placeholder="Nhập tên công việc..."
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Ngày bắt đầu
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={quickAddDate}
                      onChange={(e) => setQuickAddDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Hạn chót
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={quickDue}
                      onChange={(e) => setQuickDue(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setQuickAddDate(null)}
                  className="btn-ghost"
                >
                  Huỷ
                </button>
                <button type="submit" className="btn-primary">
                  Lưu công việc
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Chỉnh sửa chi tiết Task */}
      <AnimatePresence>
        {editingTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 10 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="card w-full max-w-md space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Chi tiết công việc</h3>
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="text-muted hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Tên công việc
                  </label>
                  <input
                    className="input"
                    value={editingTask.title}
                    onChange={(e) =>
                      setEditingTask({ ...editingTask, title: e.target.value })
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Ngày bắt đầu
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={
                        editingTask.startDate || editingTask.due || todayIso
                      }
                      onChange={(e) =>
                        setEditingTask({
                          ...editingTask,
                          startDate: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">
                      Hạn chót (Due)
                    </label>
                    <input
                      type="date"
                      className="input"
                      value={
                        editingTask.due || editingTask.startDate || todayIso
                      }
                      onChange={(e) =>
                        setEditingTask({ ...editingTask, due: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      toggleTask(editingTask.id);
                      setEditingTask({
                        ...editingTask,
                        done: !editingTask.done,
                      });
                    }}
                    className="btn-ghost !px-3 !py-1.5 text-xs"
                  >
                    {editingTask.done ? "Đánh dấu chưa xong" : "✓ Hoàn thành"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      removeTask(editingTask.id);
                      setEditingTask(null);
                    }}
                    className="btn-ghost !px-3 !py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} /> Xoá
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const s =
                      editingTask.startDate || editingTask.due || todayIso;
                    const d =
                      editingTask.due || editingTask.startDate || todayIso;
                    updateTask(editingTask.id, {
                      title: editingTask.title.trim() || "Công việc",
                      startDate: s <= d ? s : d,
                      due: d >= s ? d : s,
                    });
                    setEditingTask(null);
                  }}
                  className="btn-primary !px-4 !py-1.5 text-xs"
                >
                  Lưu thay đổi
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
