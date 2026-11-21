"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, CheckSquare, Home, Mic, Sparkles, Wallet } from "lucide-react";
import { motion } from "motion/react";

const nav = [
  { href: "/", label: "Tổng quan", icon: Home },
  { href: "/projects", label: "Dự án", icon: Briefcase },
  { href: "/tasks", label: "Công việc", icon: CheckSquare },
  { href: "/finance", label: "Tài chính", icon: Wallet },
  { href: "/meetings", label: "Meeting", icon: Mic },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sticky top-0 z-30 flex shrink-0 flex-row gap-1.5 border-b border-line bg-panel/85 p-3 backdrop-blur-md md:h-screen md:w-60 md:flex-col md:border-b-0 md:border-r md:p-4">
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
    </aside>
  );
}
