"use client";

import { useMemo, useState } from "react";
import {
  Briefcase,
  Check,
  Kanban,
  Plus,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ProjectCashflowChart } from "@/components/CashflowChart";
import {
  useStore,
  vnd,
  type ContractStatus,
  type PaymentStatus,
  type Project,
  type ProjectStatus,
} from "@/lib/store";

type ViewMode = "table" | "kanban";

const PROJECT_STATUSES: ProjectStatus[] = [
  "Đang triển khai",
  "Chờ nghiệm thu",
  "Hoàn thành",
  "Tạm dừng",
];

const CONTRACT_STATUSES: ContractStatus[] = [
  "Đang soạn",
  "Chờ ký",
  "Đã ký",
  "Đã thanh lý",
];

const PAYMENT_STATUSES: PaymentStatus[] = ["Chưa thu", "Đã cọc", "Đã thu đủ"];

const STATUS_EN: Record<ProjectStatus, string> = {
  "Đang triển khai": "In Progress",
  "Chờ nghiệm thu": "Review",
  "Hoàn thành": "Done",
  "Tạm dừng": "Paused",
};

const CONTRACT_EN: Record<ContractStatus, string> = {
  "Đang soạn": "Draft",
  "Chờ ký": "Pending",
  "Đã ký": "Signed",
  "Đã thanh lý": "Closed",
};

const PAYMENT_EN: Record<PaymentStatus, string> = {
  "Chưa thu": "Unpaid",
  "Đã cọc": "Deposit",
  "Đã thu đủ": "Paid",
};

function statusStyle(st: ProjectStatus): { pill: string; dot: string } {
  switch (st) {
    case "Hoàn thành":
      return {
        pill: "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
        dot: "bg-emerald-500",
      };
    case "Chờ nghiệm thu":
      return {
        pill: "bg-amber-100/80 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
        dot: "bg-amber-500",
      };
    case "Tạm dừng":
      return {
        pill: "bg-neutral-200/80 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
        dot: "bg-neutral-400",
      };
    default:
      return {
        pill: "bg-brand-100/80 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200",
        dot: "bg-brand-500",
      };
  }
}

function contractBadgeClass(ct: ContractStatus): string {
  switch (ct) {
    case "Đã thanh lý":
      return "bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "Đã ký":
      return "bg-blue-100/80 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300";
    case "Chờ ký":
      return "bg-amber-100/80 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
    default:
      return "bg-neutral-100 text-muted dark:bg-neutral-800/80";
  }
}

function formatShortDate(iso?: string): string {
  if (!iso) return "—";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function shortMoney(amount: number): string {
  if (!amount) return "0";
  const millions = amount / 1_000_000;
  if (millions >= 1) {
    const formatted = Number.isInteger(millions)
      ? String(millions)
      : millions.toFixed(1).replace(/\.0$/, "");
    return `${formatted}M`;
  }
  const thousands = Math.round(amount / 1_000);
  return `${thousands}K`;
}

export default function ProjectsPage() {
  const {
    projects,
    addProject,
    updateProject,
    removeProject,
    recordProjectPayment,
  } = useStore();

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [view, setView] = useState<ViewMode>("table");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all");

  // Modal Create / Edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("Đang triển khai");
  const [contractStatus, setContractStatus] = useState<ContractStatus>("Đang soạn");
  const [acceptanceDate, setAcceptanceDate] = useState(todayIso);
  const [paymentDate, setPaymentDate] = useState(todayIso);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("Chưa thu");
  const [contractValueInput, setContractValueInput] = useState("");
  const [paidAmountInput, setPaidAmountInput] = useState("");
  const [error, setError] = useState("");

  const shown = useMemo(
    () =>
      (projects ?? []).filter((p) =>
        statusFilter === "all" ? true : p.status === statusFilter
      ),
    [projects, statusFilter]
  );

  const kpi = useMemo(() => {
    const list = projects ?? [];
    const activeCount = list.filter(
      (p) => p.status === "Đang triển khai" || p.status === "Chờ nghiệm thu"
    ).length;
    const totalContract = list.reduce((s, p) => s + (p.contractValue || 0), 0);
    const totalPaid = list.reduce((s, p) => s + (p.paidAmount || 0), 0);
    const totalRemaining = Math.max(0, totalContract - totalPaid);
    return {
      activeCount,
      totalCount: list.length,
      totalContract,
      totalPaid,
      totalRemaining,
    };
  }, [projects]);

  function openCreateModal() {
    setEditingId(null);
    setName("");
    setClient("");
    setStatus("Đang triển khai");
    setContractStatus("Chờ ký");
    setAcceptanceDate(todayIso);
    setPaymentDate(todayIso);
    setPaymentStatus("Chưa thu");
    setContractValueInput("");
    setPaidAmountInput("0");
    setError("");
    setModalOpen(true);
  }

  function openEditModal(p: Project) {
    setEditingId(p.id);
    setName(p.name);
    setClient(p.client);
    setStatus(p.status);
    setContractStatus(p.contractStatus);
    setAcceptanceDate(p.acceptanceDate);
    setPaymentDate(p.paymentDate);
    setPaymentStatus(p.paymentStatus);
    setContractValueInput(p.contractValue.toLocaleString("vi-VN"));
    setPaidAmountInput(p.paidAmount.toLocaleString("vi-VN"));
    setError("");
    setModalOpen(true);
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter a project name");
      return;
    }
    const contractVal = Number(contractValueInput.replace(/[^\d]/g, "")) || 0;
    let paidVal = Number(paidAmountInput.replace(/[^\d]/g, "")) || 0;
    if (paymentStatus === "Đã thu đủ" && contractVal > 0) {
      paidVal = contractVal;
    } else if (paymentStatus === "Chưa thu") {
      paidVal = 0;
    }

    const payload: Omit<Project, "id"> = {
      name: name.trim(),
      client: client.trim() || "Client",
      status,
      contractStatus,
      acceptanceDate: acceptanceDate || todayIso,
      paymentDate: paymentDate || todayIso,
      paymentStatus,
      contractValue: contractVal,
      paidAmount: Math.min(contractVal || paidVal, paidVal),
    };

    if (editingId) {
      updateProject(editingId, payload);
    } else {
      addProject(payload);
    }
    setModalOpen(false);
  }

  function cycleProjectStatus(p: Project) {
    const idx = PROJECT_STATUSES.indexOf(p.status);
    const next = PROJECT_STATUSES[(idx + 1) % PROJECT_STATUSES.length];
    updateProject(p.id, { status: next });
  }

  function cycleContractStatus(p: Project) {
    const idx = CONTRACT_STATUSES.indexOf(p.contractStatus);
    const next = CONTRACT_STATUSES[(idx + 1) % CONTRACT_STATUSES.length];
    updateProject(p.id, { contractStatus: next });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="space-y-6"
    >
      {/* Header + View Switcher + New Project */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-line bg-panel/90 p-1 shadow-xs">
            {(
              [
                { id: "table", label: "Table", icon: Table2 },
                { id: "kanban", label: "Board", icon: Kanban },
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
                      layoutId="projects-view-pill"
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

          <button
            type="button"
            onClick={openCreateModal}
            className="btn-primary !py-2 text-xs"
          >
            <Plus size={15} /> New Project
          </button>
        </div>
      </div>

      {/* 3 Compact KPI Cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            Active
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-brand-800 dark:text-brand-200">
            {kpi.activeCount}{" "}
            <span className="text-sm font-normal text-muted">
              / {kpi.totalCount}
            </span>
          </p>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            Collected / Total
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">
            {shortMoney(kpi.totalPaid)}{" "}
            <span className="text-sm font-normal text-muted">
              / {shortMoney(kpi.totalContract)}
            </span>
          </p>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="rounded-2xl border border-brand-100/80 bg-gradient-to-br from-brand-50/90 to-white p-4 shadow-xs dark:border-brand-900/40 dark:from-brand-950/50 dark:to-panel"
        >
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            Pending Payment
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600">
            {shortMoney(kpi.totalRemaining)}
          </p>
        </motion.div>
      </section>

      {/* Project Cashflow Chart */}
      <ProjectCashflowChart />

      {/* Status Filter Pills */}
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-panel/80 p-1 w-fit">
        {(["all", ...PROJECT_STATUSES] as const).map((st) => {
          const active = statusFilter === st;
          const count =
            st === "all"
              ? (projects ?? []).length
              : (projects ?? []).filter((p) => p.status === st).length;
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`relative cursor-pointer rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "text-brand-800 dark:text-brand-100"
                  : "text-muted hover:text-ink"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="projects-filter-pill"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  className="absolute inset-0 rounded-lg bg-brand-100 dark:bg-brand-900/60"
                />
              )}
              <span className="relative z-10">
                {st === "all" ? "All" : STATUS_EN[st]} ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* ==================== 1. LINEAR-STYLE CLEAN TABLE ==================== */}
      <AnimatePresence mode="wait">
        {view === "table" && (
          <motion.div
            key="proj-table"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="card overflow-hidden p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line bg-brand-50/40 text-[11px] font-medium uppercase tracking-wider text-muted dark:bg-brand-950/20">
                    <th className="px-4 py-3">Project</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Contract</th>
                    <th className="px-3 py-3">Acceptance</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-6 text-center text-sm text-muted"
                      >
                        No projects found.
                      </td>
                    </tr>
                  )}
                  {shown.map((p) => {
                    const st = statusStyle(p.status);
                    const total = Math.max(1, p.contractValue);
                    const pct = Math.min(
                      100,
                      Math.round((p.paidAmount / total) * 100)
                    );
                    const donePay = p.paidAmount >= p.contractValue && p.contractValue > 0;

                    return (
                      <motion.tr
                        layout
                        key={p.id}
                        className="group transition-colors hover:bg-brand-50/30 dark:hover:bg-brand-950/20"
                      >
                        {/* Project & Client */}
                        <td className="px-4 py-3.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(p)}
                            className="whitespace-nowrap text-left text-[13px] font-semibold text-ink hover:text-brand-600 hover:underline"
                          >
                            {p.name}
                          </button>
                          <div className="text-[11px] text-muted">
                            {p.client}
                          </div>
                        </td>

                        {/* Status (Single-line pill with dot) */}
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <button
                            type="button"
                            onClick={() => cycleProjectStatus(p)}
                            title="Click to cycle status"
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition hover:brightness-95 ${st.pill}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${st.dot}`}
                            />
                            {STATUS_EN[p.status]}
                          </button>
                        </td>

                        {/* Contract (Single-line compact badge) */}
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <button
                            type="button"
                            onClick={() => cycleContractStatus(p)}
                            title="Click to cycle contract status"
                            className={`inline-flex cursor-pointer items-center rounded-md px-2 py-0.5 text-xs font-medium transition hover:brightness-95 ${contractBadgeClass(
                              p.contractStatus
                            )}`}
                          >
                            {CONTRACT_EN[p.contractStatus]}
                          </button>
                        </td>

                        {/* Acceptance Date (DD/MM) */}
                        <td className="whitespace-nowrap px-3 py-3.5 tabular-nums font-medium text-muted">
                          {formatShortDate(p.acceptanceDate)}
                        </td>

                        {/* Payment Progress (30M / 60M · Due 30/11 + Progress bar) */}
                        <td className="min-w-[190px] px-4 py-3.5">
                          <div className="mb-1 flex items-center justify-between tabular-nums">
                            <span
                              className={`font-semibold ${
                                donePay ? "text-emerald-600" : "text-ink"
                              }`}
                            >
                              {shortMoney(p.paidAmount)}{" "}
                              <span className="font-normal text-muted">
                                / {shortMoney(p.contractValue)}
                              </span>
                            </span>
                            <span className="text-[11px] text-muted">
                              Due {formatShortDate(p.paymentDate)}
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100/60 dark:bg-brand-950/50">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.45, ease: "easeOut" }}
                              className={`h-full rounded-full ${
                                donePay
                                  ? "bg-emerald-500"
                                  : "bg-gradient-to-r from-brand-500 to-brand-600"
                              }`}
                            />
                          </div>
                        </td>

                        {/* Quick Action */}
                        <td className="whitespace-nowrap px-4 py-3.5 text-right">
                          {!donePay ? (
                            <button
                              type="button"
                              onClick={() => recordProjectPayment(p.id)}
                              title={`Mark as fully paid (${vnd(p.contractValue)})`}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-100/80 px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300"
                            >
                              <Check size={12} /> Collect
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                              <Check size={12} /> Paid
                            </span>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}

        {/* ==================== 2. KANBAN BOARD ==================== */}
        {view === "kanban" && (
          <motion.div
            key="proj-kanban"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="grid gap-4 md:grid-cols-4"
          >
            {PROJECT_STATUSES.map((colStatus) => {
              const items = (projects ?? []).filter(
                (p) => p.status === colStatus
              );
              const st = statusStyle(colStatus);
              return (
                <div
                  key={colStatus}
                  className="card flex flex-col gap-3 bg-panel/70 p-3.5"
                >
                  <div className="flex items-center justify-between border-b border-line pb-2.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.pill}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                      {STATUS_EN[colStatus]}
                    </span>
                    <span className="text-xs font-medium text-muted">
                      {items.length}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {items.length === 0 && (
                      <p className="py-6 text-center text-xs text-muted">
                        Empty
                      </p>
                    )}
                    {items.map((p) => {
                      const total = Math.max(1, p.contractValue);
                      const pct = Math.min(
                        100,
                        Math.round((p.paidAmount / total) * 100)
                      );
                      const donePay =
                        p.paidAmount >= p.contractValue && p.contractValue > 0;
                      return (
                        <motion.div
                          layout
                          whileHover={{ y: -2 }}
                          key={p.id}
                          onClick={() => openEditModal(p)}
                          className="cursor-pointer space-y-2 rounded-xl border border-line bg-panel p-3 shadow-2xs transition hover:border-brand-300"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold leading-snug">
                              {p.name}
                            </p>
                            <span
                              className={`chip shrink-0 ${contractBadgeClass(
                                p.contractStatus
                              )}`}
                            >
                              {CONTRACT_EN[p.contractStatus]}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted">{p.client}</p>

                          <div className="pt-1">
                            <div className="mb-1 flex items-center justify-between text-[11px] tabular-nums">
                              <span className="font-semibold">
                                {shortMoney(p.paidAmount)} /{" "}
                                {shortMoney(p.contractValue)}
                              </span>
                              <span className="text-muted">
                                Due {formatShortDate(p.paymentDate)}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-100/60 dark:bg-brand-950/50">
                              <div
                                className={`h-full rounded-full ${
                                  donePay ? "bg-emerald-500" : "bg-brand-500"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Add / Edit Project */}
      <AnimatePresence>
        {modalOpen && (
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
              onSubmit={handleSave}
              className="card w-full max-w-lg space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <Briefcase size={18} className="text-brand-600" />
                  {editingId ? "Edit Project" : "New Project"}
                </h3>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-muted hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Project Name
                  </label>
                  <input
                    autoFocus
                    className="input"
                    placeholder="e.g. Landing Page & Branding Q4"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError("");
                    }}
                  />
                  {error && (
                    <p className="mt-1 text-xs text-red-600">{error}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Client
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. NovaTech"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Status
                  </label>
                  <select
                    className="input"
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as ProjectStatus)
                    }
                  >
                    {PROJECT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_EN[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Contract
                  </label>
                  <select
                    className="input"
                    value={contractStatus}
                    onChange={(e) =>
                      setContractStatus(e.target.value as ContractStatus)
                    }
                  >
                    {CONTRACT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {CONTRACT_EN[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Payment Status
                  </label>
                  <select
                    className="input"
                    value={paymentStatus}
                    onChange={(e) =>
                      setPaymentStatus(e.target.value as PaymentStatus)
                    }
                  >
                    {PAYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PAYMENT_EN[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Acceptance Date
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={acceptanceDate}
                    onChange={(e) => setAcceptanceDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Payment Due Date
                  </label>
                  <input
                    type="date"
                    className="input"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Contract Value (VND)
                  </label>
                  <input
                    className="input tabular-nums"
                    inputMode="numeric"
                    placeholder="60.000.000"
                    value={contractValueInput}
                    onChange={(e) => setContractValueInput(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Collected Amount (VND)
                  </label>
                  <input
                    className="input tabular-nums"
                    inputMode="numeric"
                    placeholder="30.000.000"
                    value={paidAmountInput}
                    onChange={(e) => setPaidAmountInput(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                {editingId ? (
                  <button
                    type="button"
                    onClick={() => {
                      removeProject(editingId);
                      setModalOpen(false);
                    }}
                    className="btn-ghost !px-3 !py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="btn-ghost"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    {editingId ? "Save" : "Create"}
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
