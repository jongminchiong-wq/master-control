"use client";

import { Suspense, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Building2,
  Calculator,
  DollarSign,
  Home,
  Inbox,
  Package,
  RefreshCcw,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Role = "admin" | "player" | "investor";

type NavItem = { href: string; label: string; icon: LucideIcon };

const ADMIN_NAV: NavItem[] = [
  { href: "/players", label: "Players", icon: Users },
  { href: "/po-cycle", label: "PO Cycle", icon: RefreshCcw },
  { href: "/investors", label: "Investors", icon: Wallet },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/entity", label: "Entity", icon: Building2 },
  { href: "/simulation", label: "Simulation", icon: Calculator },
];

const PLAYER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/my-pos", label: "My Purchase Order", icon: Package },
  { href: "/introducer-commission", label: "Introducer Commission", icon: Users },
  { href: "/withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
];

const INVESTOR_NAV: NavItem[] = [
  { href: "/portfolio", label: "Home", icon: Home },
  { href: "/deployments", label: "Deployments", icon: DollarSign },
  { href: "/cycle-history", label: "Cycle History", icon: TrendingUp },
  { href: "/network", label: "Investors Network", icon: Users },
  { href: "/wallet", label: "Wallet", icon: Wallet },
];

function navForRole(role: Role | null): NavItem[] {
  if (role === "admin") return ADMIN_NAV;
  if (role === "investor") return INVESTOR_NAV;
  if (role === "player") return PLAYER_NAV;
  return [];
}

type AccountShellProps = {
  children: React.ReactNode;
  initialRole?: Role | null;
};

export function AccountShell({ children, initialRole = null }: AccountShellProps) {
  const [role, setRole] = useState<Role | null>(initialRole);

  useEffect(() => {
    if (initialRole) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: row } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      setRole((row?.role as Role | undefined) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialRole]);

  const navItems = navForRole(role);
  const isPlayerOrInvestor = role === "player" || role === "investor";

  return (
    <div className="flex h-screen">
      <div className={isPlayerOrInvestor ? "hidden md:flex" : "contents"}>
        <Suspense>
          <Sidebar navItems={navItems} />
        </Suspense>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header hideUserBadge />
        <main
          className={cn(
            "flex flex-1 flex-col overflow-auto bg-gray-50 px-6 pt-6",
            isPlayerOrInvestor ? "pb-24 md:pb-6" : "pb-6"
          )}
        >
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {children}
            {role !== "admin" && <Footer />}
          </div>
        </main>
      </div>
      {isPlayerOrInvestor && (
        <Suspense>
          <MobileBottomNav navItems={navItems} />
        </Suspense>
      )}
    </div>
  );
}
