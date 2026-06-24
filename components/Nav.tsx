"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/daily", label: "Daily" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/"
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={[
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-violet-100 text-violet-700"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-700",
            ].join(" ")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
