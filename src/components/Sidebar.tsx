"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  CheckSquare,
  Home,
  LogOut,
  Mic,
  Sparkles,
  UserCheck,
  Wallet,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useStore } from "@/lib/store";

const nav = [
  { href: "/", label: "Tổng quan", icon: Home },
  { href: "/projects", label: "Dự án", icon: Briefcase },
  { href: "/tasks", label: "Công việc", icon: CheckSquare },
  { href: "/finance", label: "Tài chính", icon: Wallet },
  { href: "/meetings", label: "Meeting", icon: Mic },
];

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.58-1.14 2.92-2.4 3.82v3.18h3.88c2.27-2.09 3.54-5.17 3.54-9.24z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.18c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.29C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.11c-.24-.72-.38-1.49-.38-2.11s.14-1.39.38-2.11V6.6H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.4l3.99-3.29z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.6l3.99 3.29c.95-2.85 3.6-4.96 6.72-4.96z"
      />
    </svg>
  );
}

export function Sidebar() {
  const path = usePathname();
  const { user, googleConfigured, loginWithGoogleQuick, logout } = useStore();
  const [showModal, setShowModal] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  function handleGoogleClick() {
    if (googleConfigured) {
      window.location.href = "/api/auth/google";
    } else {
      setShowModal(true);
      setErr("");
    }
  }

  async function handleQuickGoogleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!emailInput.trim()) {
      setErr("Vui lòng nhập email Google của bạn.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      await loginWithGoogleQuick({
        email: emailInput.trim(),
        name: nameInput.trim() || emailInput.trim().split("@")[0],
      });
      setShowModal(false);
      setEmailInput("");
      setNameInput("");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  }

  const initials = user?.name
    ? user.name
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "G";

  return (
    <>
      <aside className="sticky top-0 z-30 flex shrink-0 flex-row items-center gap-1.5 border-b border-line bg-panel/85 p-3 backdrop-blur-md md:h-screen md:w-64 md:flex-col md:items-stretch md:border-b-0 md:border-r md:p-4">
        <div className="mr-2 flex items-center gap-2.5 px-2 md:mb-6 md:mr-0">
          <motion.span
            whileHover={{ rotate: 12, scale: 1.06 }}
            transition={{ type: "spring", stiffness: 400, damping: 18 }}
            className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-600/30"
          >
            <Sparkles size={18} />
          </motion.span>
          <span className="hidden text-lg font-semibold tracking-tight md:inline">
            My Hub
          </span>
        </div>

        <div className="flex flex-1 flex-row gap-1 md:flex-col md:gap-1.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? path === "/" : path.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "font-medium text-brand-800 dark:text-brand-100"
                    : "text-muted hover:text-ink"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className="absolute inset-0 rounded-xl bg-brand-100/90 shadow-xs dark:bg-brand-900/50"
                  />
                )}
                <span className="relative z-10 flex items-center gap-3">
                  <Icon
                    size={18}
                    className={active ? "text-brand-600 dark:text-brand-300" : ""}
                  />
                  <span className="hidden sm:inline">{label}</span>
                </span>
              </Link>
            );
          })}
        </div>

        {/* Khối Tài khoản Google ở cuối Sidebar */}
        <div className="ml-auto md:ml-0 md:mt-auto md:border-t md:border-line md:pt-3">
          {user ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-brand-50/40 p-2 dark:bg-brand-950/30">
              <div className="flex min-w-0 items-center gap-2.5">
                {user.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.picture}
                    alt={user.name}
                    className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-brand-400"
                  />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
                    {initials}
                  </span>
                )}
                <div className="hidden min-w-0 md:block">
                  <p className="truncate text-xs font-semibold text-ink">{user.name}</p>
                  <p className="truncate text-[11px] text-muted">{user.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                title="Đăng xuất Google"
                className="rounded-lg p-1.5 text-muted transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
              >
                <LogOut size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleGoogleClick}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 text-xs font-semibold text-ink shadow-2xs transition hover:border-brand-300 hover:bg-brand-50/40 dark:bg-zinc-900"
            >
              <GoogleIcon />
              <span className="hidden md:inline">Đăng nhập với Google</span>
            </button>
          )}
        </div>
      </aside>

      {/* Modal Đăng nhập Google */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-xs"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-white shadow-2xs">
                    <GoogleIcon />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-ink">Đăng nhập bằng tài khoản Google</h2>
                    <p className="text-xs text-muted">
                      Tách biệt dữ liệu cá nhân & đồng bộ sang Chrome Extension
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg p-1 text-muted hover:bg-brand-50 hover:text-ink"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={(e) => void handleQuickGoogleSubmit(e)} className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Email Google của bạn
                  </label>
                  <input
                    type="email"
                    required
                    placeholder="tenban@gmail.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Tên hiển thị (dùng khi ghi biên bản họp & thông báo Meet)
                  </label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Duy Quang"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="input"
                  />
                </div>

                {err && (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {err}
                  </p>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="btn-ghost"
                  >
                    Huỷ
                  </button>
                  <button type="submit" disabled={loading} className="btn-primary">
                    <UserCheck size={16} />
                    {loading ? "Đang đăng nhập..." : "Tiếp tục với Google"}
                  </button>
                </div>
              </form>

              <div className="mt-4 rounded-xl border border-line bg-brand-50/40 p-3 text-[11px] leading-relaxed text-muted dark:bg-brand-950/20">
                <p className="font-semibold text-ink">💡 Muốn bật cửa sổ Google OAuth 2.0 Redirect chuẩn?</p>
                <p className="mt-0.5">
                  Thêm <code className="font-mono text-ink">GOOGLE_CLIENT_ID</code> và{" "}
                  <code className="font-mono text-ink">GOOGLE_CLIENT_SECRET</code> vào file{" "}
                  <code className="font-mono text-ink">.env.local</code> (Redirect URI:{" "}
                  <code className="font-mono text-ink">http://localhost:3000/api/auth/google/callback</code>). Khi có biến môi trường này, nút Đăng nhập sẽ chuyển thẳng sang trang chọn tài khoản của Google!
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
