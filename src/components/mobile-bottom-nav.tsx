"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type MobileBottomNavProps = {
  navItems: NavItem[];
};

const PRESERVED_PARAMS = ["month"];

export function MobileBottomNav({ navItems }: MobileBottomNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preservedQuery = (() => {
    const params = new URLSearchParams();
    for (const key of PRESERVED_PARAMS) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  })();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-gray-200 bg-white md:hidden"
      aria-label="Primary"
    >
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href + preservedQuery}
            aria-label={item.label}
            className={cn(
              "flex flex-1 items-center justify-center py-2 transition-colors",
              isActive ? "text-brand-600" : "text-gray-500"
            )}
          >
            <item.icon
              className={cn(
                "size-6 shrink-0",
                isActive ? "text-brand-400" : "text-gray-400"
              )}
              strokeWidth={1.5}
            />
          </Link>
        );
      })}
    </nav>
  );
}
