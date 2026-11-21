"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  addHeardAs,
  type GlossaryEntry,
  type GlossarySuggestion,
} from "@/lib/recapGlossary";
import type { RecapTopic } from "@/lib/meetingRecap";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  startDate?: string;
  due?: string;
  fromAI?: boolean;
};

export type Transaction = {
  id: string;
  title: string;
  amount: number; // dương = thu, âm = chi
  category: string;
  date: string;
};

export type ProjectStatus = "Đang triển khai" | "Chờ nghiệm thu" | "Hoàn thành" | "Tạm dừng";
export type ContractStatus = "Đang soạn" | "Chờ ký" | "Đã ký" | "Đã thanh lý";
export type PaymentStatus = "Chưa thu" | "Đã cọc" | "Đã thu đủ";

export type Project = {
  id: string;
  name: string;
  client: string;
  status: ProjectStatus;
  contractStatus: ContractStatus;
  acceptanceDate: string;
  paymentDate: string;
  paymentStatus: PaymentStatus;
  contractValue: number;
  paidAmount: number;
};

export type ActionItem = {
  id?: string;
  title: string;
  task?: string;
  owner?: string | null;
  due?: string | null;
  dueDate?: string | null;
  done?: boolean;
  pushedToTask?: boolean;
};

export type Meeting = {
  id: string;
  title: string;
  date: string;
  summary: string;
  overview?: string[];
  topics?: RecapTopic[];
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions?: string[];
  content?: string;
  transcript: string;
  attendees?: string[];
  audioName?: string | null;
  audioSeconds?: number | null;
  meetingUrl?: string | null;
  platform?: "meet" | "zoom" | "teams" | null;
  meetingCode?: string | null;
  fromExtension?: boolean;
  glossarySuggestions?: GlossarySuggestion[];
};

type Data = {
  tasks: Task[];
  transactions: Transaction[];
  projects: Project[];
  meetings: Meeting[];
  glossary: GlossaryEntry[];
  monthlyBudget: number;
};

const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10);

const seed: Data = {
  monthlyBudget: 12_000_000,
  tasks: [
    { id: uid(), title: "Gửi báo cáo tuần", done: true, startDate: "2026-11-18", due: "2026-11-20" },
    { id: uid(), title: "Chốt thiết kế landing page", done: false, startDate: "2026-11-20", due: "2026-11-25", fromAI: true },
    { id: uid(), title: "Gọi lại khách hàng A", done: false, startDate: today(), due: "2026-11-24", fromAI: true },
    { id: uid(), title: "Đóng tiền internet", done: false, startDate: today(), due: today() },
  ],
  transactions: [
    { id: uid(), title: "Lương tháng 9", amount: 25_000_000, category: "Thu nhập", date: "2026-09-05" },
    { id: uid(), title: "Chi phí sinh hoạt T9", amount: -8_500_000, category: "Nhà cửa", date: "2026-09-15" },
    { id: uid(), title: "Lương tháng 10", amount: 25_000_000, category: "Thu nhập", date: "2026-10-05" },
    { id: uid(), title: "Chi phí sinh hoạt T10", amount: -9_200_000, category: "Nhà cửa", date: "2026-10-18" },
    { id: uid(), title: "Lương tháng 11", amount: 25_000_000, category: "Thu nhập", date: "2026-11-05" },
    { id: uid(), title: "Tiền nhà", amount: -2_500_000, category: "Nhà cửa", date: "2026-11-01" },
    { id: uid(), title: "Đi chợ", amount: -1_200_000, category: "Ăn uống", date: "2026-11-10" },
    { id: uid(), title: "Ăn tối cùng bạn", amount: -850_000, category: "Ăn uống", date: "2026-11-15" },
    { id: uid(), title: "Grab", amount: -420_000, category: "Di chuyển", date: "2026-11-18" },
  ],
  projects: [
    {
      id: uid(),
      name: "Landing Page & Branding Q4",
      client: "NovaTech",
      status: "Đang triển khai",
      contractStatus: "Đã ký",
      acceptanceDate: "2026-11-25",
      paymentDate: "2026-11-30",
      paymentStatus: "Đã cọc",
      contractValue: 60_000_000,
      paidAmount: 30_000_000,
    },
    {
      id: uid(),
      name: "Hệ thống CRM nội bộ",
      client: "An Phát Corp",
      status: "Chờ nghiệm thu",
      contractStatus: "Đã ký",
      acceptanceDate: "2026-11-22",
      paymentDate: "2026-11-26",
      paymentStatus: "Đã cọc",
      contractValue: 95_000_000,
      paidAmount: 45_000_000,
    },
    {
      id: uid(),
      name: "Tối ưu SEO & Content AI",
      client: "GreenMart",
      status: "Đang triển khai",
      contractStatus: "Chờ ký",
      acceptanceDate: "2026-12-10",
      paymentDate: "2026-12-15",
      paymentStatus: "Chưa thu",
      contractValue: 35_000_000,
      paidAmount: 0,
    },
    {
      id: uid(),
      name: "Thiết kế App Đặt lịch Spa",
      client: "Lumiere Beauty",
      status: "Hoàn thành",
      contractStatus: "Đã thanh lý",
      acceptanceDate: "2026-11-10",
      paymentDate: "2026-11-15",
      paymentStatus: "Đã thu đủ",
      contractValue: 50_000_000,
      paidAmount: 50_000_000,
    },
  ],
  meetings: [],
  glossary: [],
};

const KEY = "my-hub-data-v1";

type Store = Data & {
  ready: boolean;
  addTask: (t: Omit<Task, "id" | "done">) => void;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  addTransaction: (t: Omit<Transaction, "id">) => void;
  removeTransaction: (id: string) => void;
  setBudget: (n: number) => void;
  addProject: (p: Omit<Project, "id">) => void;
  updateProject: (id: string, patch: Partial<Omit<Project, "id">>) => void;
  removeProject: (id: string) => void;
  recordProjectPayment: (id: string) => void;
  addMeeting: (m: Omit<Meeting, "id">) => Meeting;
  updateMeeting: (id: string, patch: Partial<Meeting>) => void;
  removeMeeting: (id: string) => void;
  addGlossaryEntry: (entry: { kind: "TERM" | "RULE"; text: string; heardAs?: string | null }) => void;
  removeGlossaryEntry: (id: string) => void;
  acceptGlossarySuggestions: (meetingId: string, picked: GlossarySuggestion[]) => void;
  dismissGlossarySuggestions: (meetingId: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data>(seed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setData({
          ...seed,
          ...parsed,
          projects: Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : seed.projects,
          glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
        });
      }
    } catch {}
    setReady(true);
  }, []);

  // Lắng nghe biên bản gửi từ Chrome Extension (qua content-sync.js hoặc tab khác)
  useEffect(() => {
    function handleWindowMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const msg = event.data;
      if (!msg || msg.type !== "MYHUB_EXTENSION_RECAP_SYNC" || !msg.meeting) return;
      const incoming = msg.meeting as Meeting;
      setData((d) => {
        if (d.meetings.some((m) => m.id === incoming.id)) return d;
        return { ...d, meetings: [incoming, ...d.meetings] };
      });
      window.postMessage({ type: "MYHUB_EXTENSION_RECAP_SYNC_ACK", id: incoming.id }, window.location.origin);
    }

    function handleStorageChange(event: StorageEvent) {
      if (event.key !== KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        setData((d) => ({
          ...d,
          ...parsed,
          glossary: Array.isArray(parsed.glossary) ? parsed.glossary : d.glossary,
        }));
      } catch {}
    }

    window.addEventListener("message", handleWindowMessage);
    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("message", handleWindowMessage);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  }, [data, ready]);

  const store: Store = {
    ...data,
    ready,
    addTask: (t) =>
      setData((d) => ({
        ...d,
        tasks: [
          {
            ...t,
            startDate: t.startDate || (t.due ? (t.due < today() ? t.due : today()) : today()),
            id: uid(),
            done: false,
          },
          ...d.tasks,
        ],
      })),
    updateTask: (id, patch) =>
      setData((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })),
    toggleTask: (id) =>
      setData((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
    removeTask: (id) => setData((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) })),
    addTransaction: (t) => setData((d) => ({ ...d, transactions: [{ ...t, id: uid() }, ...d.transactions] })),
    removeTransaction: (id) => setData((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) })),
    setBudget: (n) => setData((d) => ({ ...d, monthlyBudget: n })),
    addProject: (p) =>
      setData((d) => ({
        ...d,
        projects: [{ ...p, id: uid() }, ...(d.projects ?? [])],
      })),
    updateProject: (id, patch) =>
      setData((d) => ({
        ...d,
        projects: (d.projects ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      })),
    removeProject: (id) =>
      setData((d) => ({
        ...d,
        projects: (d.projects ?? []).filter((p) => p.id !== id),
      })),
    recordProjectPayment: (id) =>
      setData((d) => ({
        ...d,
        projects: (d.projects ?? []).map((p) =>
          p.id === id
            ? {
                ...p,
                paidAmount: p.contractValue,
                paymentStatus: "Đã thu đủ",
              }
            : p
        ),
      })),
    addMeeting: (m) => {
      const created: Meeting = { ...m, id: uid() };
      setData((d) => ({ ...d, meetings: [created, ...d.meetings] }));
      return created;
    },
    updateMeeting: (id, patch) =>
      setData((d) => ({
        ...d,
        meetings: d.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    removeMeeting: (id) => setData((d) => ({ ...d, meetings: d.meetings.filter((m) => m.id !== id) })),
    addGlossaryEntry: ({ kind, text, heardAs }) =>
      setData((d) => {
        const cleanText = text.trim();
        if (!cleanText) return d;
        const cleanHeard = kind === "TERM" && heardAs?.trim() ? heardAs.trim() : null;
        const existingIndex = d.glossary.findIndex(
          (g) => g.kind === kind && g.text.toLocaleLowerCase("vi") === cleanText.toLocaleLowerCase("vi")
        );
        if (existingIndex >= 0) {
          const updated = [...d.glossary];
          const current = updated[existingIndex];
          updated[existingIndex] = {
            ...current,
            text: cleanText,
            heardAs: cleanHeard ? addHeardAs(current.heardAs, cleanHeard) : current.heardAs,
          };
          return { ...d, glossary: updated };
        }
        return {
          ...d,
          glossary: [
            {
              id: uid(),
              kind,
              text: cleanText,
              heardAs: cleanHeard,
              useCount: 0,
            },
            ...d.glossary,
          ],
        };
      }),
    removeGlossaryEntry: (id) =>
      setData((d) => ({ ...d, glossary: d.glossary.filter((g) => g.id !== id) })),
    acceptGlossarySuggestions: (meetingId, picked) =>
      setData((d) => {
        let nextGlossary = [...d.glossary];
        for (const item of picked) {
          const right = item.right.trim();
          const wrong = item.wrong.trim();
          if (!right || !wrong) continue;
          const idx = nextGlossary.findIndex(
            (g) => g.kind === "TERM" && g.text.toLocaleLowerCase("vi") === right.toLocaleLowerCase("vi")
          );
          if (idx >= 0) {
            const cur = nextGlossary[idx];
            nextGlossary[idx] = {
              ...cur,
              heardAs: addHeardAs(cur.heardAs, wrong),
              useCount: cur.useCount + 1,
            };
          } else {
            nextGlossary = [
              {
                id: uid(),
                kind: "TERM",
                text: right,
                heardAs: wrong,
                useCount: 1,
              },
              ...nextGlossary,
            ];
          }
        }
        return {
          ...d,
          glossary: nextGlossary,
          meetings: d.meetings.map((m) => (m.id === meetingId ? { ...m, glossarySuggestions: [] } : m)),
        };
      }),
    dismissGlossarySuggestions: (meetingId) =>
      setData((d) => ({
        ...d,
        meetings: d.meetings.map((m) => (m.id === meetingId ? { ...m, glossarySuggestions: [] } : m)),
      })),
  };

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore must be used inside StoreProvider");
  return s;
}

export const vnd = (n: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n);

export const thisMonth = (date: string) => date.slice(0, 7) === new Date().toISOString().slice(0, 7);
