"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/data/site";

export default function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="topnav" aria-label="Primary">
      {NAV.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
