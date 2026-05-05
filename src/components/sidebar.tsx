"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Command, PanelLeft, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type SidebarProps = {
  navItems: NavItem[];
};

const STORAGE_KEY = "mc.sidebar.collapsed";
const STORAGE_EVENT = "mc:sidebar-changed";

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_EVENT, cb);
  };
}

function getCollapsed() {
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

function setCollapsedStored(next: boolean) {
  window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

// Search params worth preserving across page navigations
const PRESERVED_PARAMS = ["month"];

function renderNavItem(
  item: NavItem,
  pathname: string,
  collapsed: boolean,
  preservedQuery: string
) {
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <div key={item.href} className="group/tip relative">
      <Link
        href={item.href + preservedQuery}
        aria-label={item.label}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-brand-50 text-brand-600"
            : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
          collapsed && "justify-center px-0"
        )}
      >
        {isActive && collapsed && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-brand-400" />
        )}
        <item.icon
          className={cn(
            "size-4 shrink-0",
            isActive ? "text-brand-400" : "text-gray-400"
          )}
          strokeWidth={1.5}
        />
        {!collapsed && <span>{item.label}</span>}
      </Link>
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100"
        >
          {item.label}
        </span>
      )}
    </div>
  );
}

export function Sidebar({ navItems }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const collapsed = useSyncExternalStore(subscribe, getCollapsed, () => false);
  const toggle = () => setCollapsedStored(!collapsed);

  const preservedQuery = (() => {
    const params = new URLSearchParams();
    for (const key of PRESERVED_PARAMS) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const str = params.toString();
    return str ? `?${str}` : "";
  })();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsedStored(!getCollapsed());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tipText = collapsed ? "Open sidebar" : "Close sidebar";

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-60"
      )}
    >
      {/* Brand row with toggle */}
      <div
        className={cn(
          "flex h-14 items-center gap-2 border-b border-gray-200 px-2",
          collapsed && "justify-center"
        )}
      >
        {!collapsed && (
          <div className="flex items-center pl-3">
            <Command className="size-4 shrink-0 text-brand-400" strokeWidth={1.6} />
          </div>
        )}
        <div className={cn("group/tip relative inline-flex", !collapsed && "ml-auto")}>
          <button
            type="button"
            onClick={toggle}
            aria-label={tipText}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700",
              collapsed && "w-10 justify-center px-0"
            )}
          >
            <PanelLeft className="size-4 shrink-0 text-gray-400" strokeWidth={1.5} />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100"
          >
            {tipText}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 px-2 py-4">
        {navItems.map((item) => renderNavItem(item, pathname, collapsed, preservedQuery))}
      </nav>
    </aside>
  );
}
