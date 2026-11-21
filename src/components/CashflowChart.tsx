"use client";

import { useMemo, useState } from "react";
import { BarChart3, TrendingUp } from "lucide-react";
import { motion } from "motion/react";
import { useStore, vnd } from "@/lib/store";

type ChartMode = "bars" | "net";

function getRecentMonths(count = 6, futureOffset = 0): { key: string; label: string }[] {
  const now = new Date();
  const list: { key: string; label: string }[] = [];
  const startOffset = -(count - 1 - futureOffset);
  for (let offset = startOffset; offset <= futureOffset; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const key = `${y}-${m}`;
    const shortYear = String(y).slice(2);
    list.push({
      key,
      label: `T${d.getMonth() + 1}/${shortYear}`,
    });
  }
  return list;
}

/**
 * Biểu đồ Dòng tiền Cá nhân (chỉ tính Thu nhập & Chi tiêu cá nhân, tách biệt hoàn toàn với Dự án)
 */
export function CashflowChart({ compact = false }: { compact?: boolean }) {
  const { transactions } = useStore();
  const [mode, setMode] = useState<ChartMode>("bars");

  const months = useMemo(() => getRecentMonths(6, 0), []);
  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const series = useMemo(() => {
    return months.map((m) => {
      const monthTx = transactions.filter(
        (t) => t.date.slice(0, 7) === m.key && t.category !== "Dự án"
      );
      const income = monthTx
        .filter((t) => t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);
      const expense = -monthTx
        .filter((t) => t.amount < 0)
        .reduce((s, t) => s + t.amount, 0);
      const net = income - expense;

      return {
        ...m,
        income,
        expense,
        net,
        isCurrent: m.key === currentMonthKey,
      };
    });
  }, [months, transactions, currentMonthKey]);

  const defaultIdx = useMemo(() => {
    const idx = series.findIndex((s) => s.isCurrent);
    return idx >= 0 ? idx : series.length - 1;
  }, [series]);

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const selected = series[activeIdx ?? defaultIdx] ?? series[0];

  const maxBarValue = useMemo(() => {
    const peak = Math.max(
      1_000_000,
      ...series.map((s) => Math.max(s.income, s.expense, Math.abs(s.net)))
    );
    return peak * 1.15;
  }, [series]);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Dòng tiền cá nhân theo tháng</h2>

        <div className="flex items-center gap-1 rounded-xl border border-line bg-panel p-1">
          {(
            [
              { id: "bars", label: "Thu – Chi", icon: BarChart3 },
              { id: "net", label: "Tích lũy ròng", icon: TrendingUp },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`relative inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  active ? "text-white" : "text-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId={compact ? "cf-personal-compact" : "cf-personal-full"}
                    transition={{ type: "spring", stiffness: 420, damping: 30 }}
                    className="absolute inset-0 rounded-lg bg-gradient-to-b from-brand-500 to-brand-600"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  <Icon size={13} />
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thanh chỉ số của tháng đang chọn */}
      {selected && (
        <div className="grid grid-cols-3 gap-2.5 text-xs">
          <div className="rounded-xl border border-line bg-brand-50/40 px-3 py-2 dark:bg-brand-950/20">
            <span className="text-muted">Số dư ròng ({selected.label})</span>
            <p
              className={`mt-0.5 text-sm font-semibold tabular-nums ${
                selected.net >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {selected.net >= 0 ? "+" : ""}
              {vnd(selected.net)}
            </p>
          </div>

          <div className="rounded-xl border border-line bg-panel px-3 py-2">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Thu cá nhân
            </span>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {vnd(selected.income)}
            </p>
          </div>

          <div className="rounded-xl border border-line bg-panel px-3 py-2">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="h-2 w-2 rounded-full bg-rose-500" />
              Chi cá nhân
            </span>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-rose-600">
              -{vnd(selected.expense)}
            </p>
          </div>
        </div>
      )}

      {/* Khu vực Biểu đồ */}
      {mode === "bars" ? (
        <div className="pt-2">
          <div className="grid h-44 grid-cols-6 items-end gap-2 border-b border-line px-2 pb-2 sm:gap-4">
            {series.map((s, idx) => {
              const incPct = Math.round((s.income / maxBarValue) * 100);
              const expPct = Math.round((s.expense / maxBarValue) * 100);
              const isSelected = (activeIdx ?? defaultIdx) === idx;

              return (
                <div
                  key={s.key}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => setActiveIdx(idx)}
                  className={`group flex h-full cursor-pointer flex-col justify-end rounded-xl px-1.5 pt-2 transition ${
                    isSelected
                      ? "bg-brand-50/70 dark:bg-brand-950/30"
                      : "hover:bg-brand-50/30 dark:hover:bg-brand-950/15"
                  }`}
                >
                  <div className="flex h-full items-end justify-center gap-1.5 sm:gap-2">
                    <div className="flex h-full w-4 sm:w-6 flex-col justify-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{
                          height: `${s.income > 0 ? Math.max(4, incPct) : 2}%`,
                        }}
                        transition={{ duration: 0.45, delay: idx * 0.04 }}
                        title={`Thu cá nhân: ${vnd(s.income)}`}
                        className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-500"
                      />
                    </div>
                    <div className="flex h-full w-4 sm:w-6 flex-col justify-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{
                          height: `${s.expense > 0 ? Math.max(4, expPct) : 2}%`,
                        }}
                        transition={{ duration: 0.45, delay: idx * 0.04 + 0.05 }}
                        title={`Chi cá nhân: ${vnd(s.expense)}`}
                        className="w-full rounded-t-md bg-gradient-to-t from-rose-600 to-rose-400"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 grid grid-cols-6 text-center text-xs">
            {series.map((s, idx) => {
              const isSelected = (activeIdx ?? defaultIdx) === idx;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className={`cursor-pointer tabular-nums transition ${
                    isSelected
                      ? "font-semibold text-brand-700 dark:text-brand-300"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {s.label}
                  {s.isCurrent ? " •" : ""}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="pt-2">
          <div className="relative h-44 w-full">
            <svg
              viewBox="0 0 600 180"
              className="h-full w-full overflow-visible"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="personalNetGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {(() => {
                const pts = series.map((s, i) => {
                  const x = 50 + i * (500 / Math.max(1, series.length - 1));
                  const clamped = Math.max(0, s.net);
                  const y = 155 - (clamped / maxBarValue) * 130;
                  return { x, y, s, i };
                });
                const linePath = pts
                  .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
                  .join(" ");
                const areaPath = `${linePath} L ${pts[pts.length - 1].x} 165 L ${
                  pts[0].x
                } 165 Z`;

                return (
                  <>
                    <path d={areaPath} fill="url(#personalNetGrad)" />
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {pts.map((p) => {
                      const isSelected = (activeIdx ?? defaultIdx) === p.i;
                      return (
                        <g
                          key={p.s.key}
                          className="cursor-pointer"
                          onMouseEnter={() => setActiveIdx(p.i)}
                          onClick={() => setActiveIdx(p.i)}
                        >
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={isSelected ? 6 : 4.5}
                            fill={isSelected ? "#10b981" : "#7c3aed"}
                            stroke="#ffffff"
                            strokeWidth="2"
                          />
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </svg>
          </div>

          <div className="mt-2 grid grid-cols-6 text-center text-xs">
            {series.map((s, idx) => {
              const isSelected = (activeIdx ?? defaultIdx) === idx;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className={`cursor-pointer tabular-nums transition ${
                    isSelected
                      ? "font-semibold text-brand-700 dark:text-brand-300"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {s.label}
                  {s.isCurrent ? " •" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Biểu đồ Dòng tiền Dự án riêng biệt (đặt trong tab Dự án /projects)
 * Hiển thị Đã thực thu từ HĐ vs. Còn phải thu theo tháng thu tiền (paymentDate)
 */
export function ProjectCashflowChart() {
  const { projects } = useStore();
  const months = useMemo(() => getRecentMonths(6, 2), []);
  const currentMonthKey = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const series = useMemo(() => {
    return months.map((m) => {
      const monthProjects = (projects ?? []).filter(
        (p) => p.paymentDate && p.paymentDate.slice(0, 7) === m.key
      );
      const collected = monthProjects.reduce((s, p) => s + (p.paidAmount || 0), 0);
      const expected = monthProjects.reduce(
        (s, p) => s + Math.max(0, (p.contractValue || 0) - (p.paidAmount || 0)),
        0
      );
      const totalContract = collected + expected;
      return {
        ...m,
        collected,
        expected,
        totalContract,
        count: monthProjects.length,
        isCurrent: m.key === currentMonthKey,
      };
    });
  }, [months, projects, currentMonthKey]);

  const defaultIdx = useMemo(() => {
    const idx = series.findIndex((s) => s.isCurrent);
    return idx >= 0 ? idx : 0;
  }, [series]);

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const selected = series[activeIdx ?? defaultIdx] ?? series[0];

  const maxBarValue = useMemo(() => {
    const peak = Math.max(1_000_000, ...series.map((s) => s.totalContract));
    return peak * 1.15;
  }, [series]);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Dòng tiền dự án theo tháng thu tiền</h2>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            Đã thu / Đã cọc
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" />
            Chờ thu theo hạn HĐ
          </span>
        </div>
      </div>

      {selected && (
        <div className="grid grid-cols-3 gap-2.5 text-xs">
          <div className="rounded-xl border border-line bg-brand-50/40 px-3 py-2 dark:bg-brand-950/20">
            <span className="text-muted">
              Tổng HĐ ({selected.label} · {selected.count} dự án)
            </span>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
              {vnd(selected.totalContract)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-panel px-3 py-2">
            <span className="text-muted">Đã thực thu</span>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600">
              {vnd(selected.collected)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-panel px-3 py-2">
            <span className="text-muted">Còn phải thu</span>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-brand-700 dark:text-brand-300">
              {vnd(selected.expected)}
            </p>
          </div>
        </div>
      )}

      <div className="pt-2">
        <div className="grid h-40 grid-cols-6 items-end gap-2 border-b border-line px-2 pb-2 sm:gap-4">
          {series.map((s, idx) => {
            const colPct = Math.round((s.collected / maxBarValue) * 100);
            const expPct = Math.round((s.expected / maxBarValue) * 100);
            const isSelected = (activeIdx ?? defaultIdx) === idx;

            return (
              <div
                key={s.key}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => setActiveIdx(idx)}
                className={`flex h-full cursor-pointer flex-col justify-end rounded-xl px-1.5 pt-2 transition ${
                  isSelected
                    ? "bg-brand-50/70 dark:bg-brand-950/30"
                    : "hover:bg-brand-50/30 dark:hover:bg-brand-950/15"
                }`}
              >
                <div className="mx-auto flex h-full w-6 sm:w-9 flex-col justify-end">
                  {expPct > 0 && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(5, expPct)}%` }}
                      transition={{ duration: 0.45, delay: idx * 0.04 }}
                      title={`Còn phải thu: ${vnd(s.expected)}`}
                      className="w-full rounded-t-md bg-gradient-to-t from-brand-500 to-brand-400"
                    />
                  )}
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{
                      height: `${s.collected > 0 ? Math.max(5, colPct) : s.expected > 0 ? 0 : 2}%`,
                    }}
                    transition={{ duration: 0.45, delay: idx * 0.04 }}
                    title={`Đã thu: ${vnd(s.collected)}`}
                    className={`w-full bg-gradient-to-t from-emerald-600 to-emerald-500 ${
                      expPct === 0 ? "rounded-t-md" : ""
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 grid grid-cols-6 text-center text-xs">
          {series.map((s, idx) => {
            const isSelected = (activeIdx ?? defaultIdx) === idx;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`cursor-pointer tabular-nums transition ${
                  isSelected
                    ? "font-semibold text-brand-700 dark:text-brand-300"
                    : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
                {s.isCurrent ? " •" : ""}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
