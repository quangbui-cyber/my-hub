"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { CashflowChart } from "@/components/CashflowChart";
import { thisMonth, useStore, vnd } from "@/lib/store";

const CATEGORIES = ["Ăn uống", "Nhà cửa", "Di chuyển", "Mua sắm", "Giải trí", "Sức khoẻ", "Thu nhập", "Khác"];

export default function FinancePage() {
  const { transactions, addTransaction, removeTransaction, monthlyBudget, setBudget } = useStore();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"chi" | "thu">("chi");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [error, setError] = useState("");

  const personalTransactions = transactions.filter((t) => t.category !== "Dự án");
  const month = personalTransactions.filter((t) => thisMonth(t.date));
  const income = month.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spent = -month.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const pct = Math.min(100, Math.round((spent / Math.max(1, monthlyBudget)) * 100));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount.replace(/[^\d]/g, ""));
    if (!title.trim()) return setError("Nhập nội dung khoản tiền");
    if (!n) return setError("Nhập số tiền lớn hơn 0");
    addTransaction({
      title: title.trim(),
      amount: kind === "chi" ? -n : n,
      category: kind === "thu" ? "Thu nhập" : category,
      date: new Date().toISOString().slice(0, 10),
    });
    setTitle("");
    setAmount("");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="space-y-6"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Tài chính cá nhân</h1>

      <section className="grid gap-4 sm:grid-cols-3">
        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
        >
          <p className="text-sm text-muted">Thu tháng này</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{vnd(income)}</p>
        </motion.div>
        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
        >
          <p className="text-sm text-muted">Chi tháng này</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-800 dark:text-brand-200">{vnd(spent)}</p>
        </motion.div>
        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
        >
          <label className="text-sm text-muted" htmlFor="budget">
            Ngân sách tháng
          </label>
          <input
            id="budget"
            className="input mt-1 tabular-nums"
            inputMode="numeric"
            value={monthlyBudget.toLocaleString("vi-VN")}
            onChange={(e) => setBudget(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
          />
        </motion.div>
      </section>

      <div className="card">
        <div className="mb-2 flex justify-between text-sm">
          <span>Đã dùng {pct}% ngân sách</span>
          <span className="tabular-nums text-muted">Còn {vnd(monthlyBudget - spent)}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-brand-50 dark:bg-brand-950/50">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            className={`h-3 rounded-full ${
              pct >= 90
                ? "bg-gradient-to-r from-red-500 to-rose-600"
                : "bg-gradient-to-r from-brand-500 to-brand-600"
            }`}
          />
        </div>
      </div>

      {/* Biểu đồ dòng tiền theo tháng */}
      <CashflowChart />

      <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-[110px_1fr_160px_150px_auto]">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "chi" | "thu")}>
          <option value="chi">Chi</option>
          <option value="thu">Thu</option>
        </select>
        <input
          className="input"
          placeholder="Cà phê với team"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />
        <input
          className="input tabular-nums"
          inputMode="numeric"
          placeholder="50.000"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError("");
          }}
        />
        <select
          className="input"
          value={category}
          disabled={kind === "thu"}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.filter((c) => c !== "Thu nhập").map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="btn-primary justify-center">
          <Plus size={16} /> Thêm
        </button>
        {error && <p className="text-xs text-red-600 sm:col-span-5">{error}</p>}
      </form>

      <ul className="card divide-y divide-line overflow-hidden p-0">
        <AnimatePresence initial={false}>
          {personalTransactions.map((t) => (
            <motion.li
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.2 }}
              key={t.id}
              className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-brand-50/30 dark:hover:bg-brand-950/20"
            >
              <div className="flex-1">
                <p className="font-medium">{t.title}</p>
                <p className="text-xs text-muted">
                  {t.category} · {new Date(t.date).toLocaleDateString("vi-VN")}
                </p>
              </div>
              <span
                className={`tabular-nums font-medium ${
                  t.amount > 0 ? "text-emerald-600" : ""
                }`}
              >
                {t.amount > 0 ? "+" : ""}
                {vnd(t.amount)}
              </span>
              <button
                onClick={() => removeTransaction(t.id)}
                aria-label="Xoá"
                className="text-muted transition hover:scale-110 hover:text-red-600"
              >
                <Trash2 size={16} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.div>
  );
}
