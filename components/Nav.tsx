"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarDays,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

const LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/daily", label: "Daily", icon: CalendarDays },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/"
            : pathname.startsWith(link.href);
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand-soft text-brand-strong"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
