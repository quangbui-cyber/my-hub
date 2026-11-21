"use client";

import { useState } from "react";
import { ArrowRight, BookPlus, BookText, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type { GlossarySuggestion } from "@/lib/recapGlossary";

export function RecapGlossaryManager() {
  const { glossary, addGlossaryEntry, removeGlossaryEntry } = useStore();
  const [kind, setKind] = useState<"TERM" | "RULE">("TERM");
  const [text, setText] = useState("");
  const [heardAs, setHeardAs] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    addGlossaryEntry({
      kind,
      text: text.trim(),
      heardAs: kind === "TERM" ? heardAs.trim() : null,
    });
    setText("");
    setHeardAs("");
  }

  const terms = glossary.filter((entry) => entry.kind === "TERM");
  const rules = glossary.filter((entry) => entry.kind === "RULE");

  return (
    <section className="card space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-950/60 dark:text-brand-200">
          <BookText size={18} />
        </span>
        <h2 className="font-semibold">Từ điển biên bản họp</h2>
      </div>

      <form onSubmit={submit} className="grid gap-2.5 sm:grid-cols-[9.5rem_1fr_1fr_auto]">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value === "RULE" ? "RULE" : "TERM")}
          className="input"
          aria-label="Loại mục"
        >
          <option value="TERM">Tên, thuật ngữ</option>
          <option value="RULE">Quy tắc viết</option>
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`input ${kind === "RULE" ? "sm:col-span-2" : ""}`}
          placeholder={kind === "RULE" ? "Gọi là nhóm Strategy, không dịch sang Chiến lược" : "Tuyết Lê, Taskflow, KPI…"}
          maxLength={240}
          required
        />
        {kind === "TERM" && (
          <input
            value={heardAs}
            onChange={(e) => setHeardAs(e.target.value)}
            className="input"
            placeholder="Hay bị chép thành: Tuy L (tuỳ chọn)"
            maxLength={120}
          />
        )}
        <button type="submit" className="btn-primary justify-center">
          <Plus size={16} /> Thêm
        </button>
      </form>

      {glossary.length === 0 ? (
        <p className="py-2 text-center text-sm text-muted">Chưa có mục nào.</p>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line">
          {[
            { label: "Tên, thuật ngữ", rows: terms },
            { label: "Quy tắc viết", rows: rules },
          ]
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <div key={group.label} className="px-4 py-3">
                <h3 className="mb-1.5 text-xs font-medium text-muted">
                  {group.label} ({group.rows.length})
                </h3>
                <ul className="divide-y divide-line/60">
                  {group.rows.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-1.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-ink">{entry.text}</span>
                        {entry.heardAs && <span className="ml-2 text-muted">← {entry.heardAs}</span>}
                      </span>
                      {entry.kind === "TERM" && entry.useCount > 0 && (
                        <span className="text-xs text-muted">{entry.useCount} lần học</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeGlossaryEntry(entry.id)}
                        className="text-muted hover:text-red-600"
                        aria-label={`Xoá ${entry.text}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

export function RecapGlossarySuggestions({
  meetingId,
  suggestions,
}: {
  meetingId: string;
  suggestions: GlossarySuggestion[];
}) {
  const { acceptGlossarySuggestions, dismissGlossarySuggestions } = useStore();
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  if (!suggestions || suggestions.length === 0) return null;

  const keyOf = (item: GlossarySuggestion) => `${item.wrong}\u0000${item.right}`;
  const picked = suggestions.filter((item) => !unchecked.has(keyOf(item)));

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-900/60 dark:bg-brand-950/30">
      <p className="flex items-center gap-2 text-sm font-medium text-ink">
        <BookPlus size={16} className="text-brand-600" />
        Phát hiện từ vừa sửa — thêm {suggestions.length} từ vào từ điển để lần sau AI viết chuẩn luôn?
      </p>
      <ul className="mt-2.5 space-y-1">
        {suggestions.map((item) => {
          const key = keyOf(item);
          return (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1 text-sm hover:bg-panel">
                <input
                  type="checkbox"
                  checked={!unchecked.has(key)}
                  onChange={() =>
                    setUnchecked((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                />
                <span className="text-muted line-through">{item.wrong}</span>
                <ArrowRight size={14} className="shrink-0 text-muted" />
                <span className="font-medium text-ink">{item.right}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={picked.length === 0}
          className="btn-primary !px-3 !py-1.5 text-xs"
          onClick={() => acceptGlossarySuggestions(meetingId, picked)}
        >
          Thêm {picked.length} từ vào từ điển
        </button>
        <button
          type="button"
          className="btn-ghost !px-3 !py-1.5 text-xs"
          onClick={() => dismissGlossarySuggestions(meetingId)}
        >
          Bỏ qua
        </button>
      </div>
    </div>
  );
}
