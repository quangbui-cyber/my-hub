"use client";

import Link from "next/link";
import { CheckCircle2, Circle, Mic, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { CashflowChart } from "@/components/CashflowChart";
import { thisMonth, useStore, vnd } from "@/lib/store";

export default function Dashboard() {
  const { tasks, transactions, projects, meetings, monthlyBudget, toggleTask } = useStore();
  const monthTx = transactions.filter((t) => thisMonth(t.date));
  const spent = -monthTx.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const left = monthlyBudget - spent;
  const doneCount = tasks.filter((t) => t.done).length;

  const byCat = Object.entries(
    monthTx
      .filter((t) => t.amount < 0)
      .reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.category]: (acc[t.category] ?? 0) - t.amount }), {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxCat = byCat[0]?.[1] ?? 1;
  const latest = meetings[0];

  const date = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="space-y-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Xin chào 👋</h1>
          <p className="text-sm capitalize text-muted">{date}</p>
        </div>
        <Link href="/meetings" className="btn-primary">
          <Mic size={16} /> Recap meeting mới
        </Link>
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <Stat index={0} label="Dự án đang chạy" value={`${(projects ?? []).filter((p) => p.status === "Đang triển khai" || p.status === "Chờ nghiệm thu").length} / ${(projects ?? []).length}`} />
        <Stat index={1} label="Task đã xong" value={`${doneCount} / ${tasks.length}`} />
        <Stat index={2} label="Chi tháng này" value={vnd(spent)} />
        <Stat index={3} label="Ngân sách còn" value={vnd(left)} tone={left >= 0 ? "good" : "bad"} />
      </section>

      <CashflowChart compact />

      <section className="grid gap-4 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.3 }}
          className="card"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Công việc</h2>
            <Link href="/tasks" className="text-sm text-brand-600 hover:underline">
              Xem tất cả
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {tasks.slice(0, 5).map((t) => (
              <motion.li
                layout
                key={t.id}
                className="flex items-center gap-3 py-2.5 text-sm"
              >
                <motion.button
                  whileTap={{ scale: 0.8 }}
                  onClick={() => toggleTask(t.id)}
                  aria-label="Đánh dấu xong"
                  className="text-brand-600"
                >
                  {t.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                </motion.button>
                <span className={t.done ? "text-muted line-through transition" : "transition"}>
                  {t.title}
                </span>
                {t.fromAI && (
                  <span className="chip ml-auto bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                    AI
                  </span>
                )}
              </motion.li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.3 }}
          className="card"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Chi tiêu theo danh mục</h2>
            <Link href="/finance" className="text-sm text-brand-600 hover:underline">
              Chi tiết
            </Link>
          </div>
          <div className="space-y-3">
            {byCat.length === 0 && (
              <p className="text-sm text-muted">Chưa có khoản chi nào trong tháng.</p>
            )}
            {byCat.map(([cat, v], i) => (
              <div key={cat} className="text-sm">
                <div className="mb-1 flex justify-between">
                  <span>{cat}</span>
                  <span className="tabular-nums text-muted">{vnd(v)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-brand-50 dark:bg-brand-950/50">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(v / maxCat) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.15 + i * 0.06, ease: "easeOut" }}
                    className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                  />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.3 }}
        className="card"
      >
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Sparkles size={18} className="text-brand-600" /> Recap meeting gần nhất
        </h2>
        {latest ? (
          <>
            <p className="font-medium">{latest.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">{latest.summary}</p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Chưa có meeting nào.{" "}
            <Link href="/meetings" className="text-brand-600 hover:underline">
              Ghi âm hoặc dán transcript đầu tiên
            </Link>{" "}
            để AI tóm tắt và tạo task.
          </p>
        )}
      </motion.section>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  tone,
  index,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.28 }}
      whileHover={{ y: -2 }}
      className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs transition-shadow hover:shadow-md hover:shadow-brand-500/5 dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
    >
      <p className="text-sm text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "good"
            ? "text-emerald-600"
            : tone === "bad"
            ? "text-red-600"
            : "text-brand-800 dark:text-brand-200"
        }`}
      >
        {value}
      </p>
    </motion.div>
  );
}
