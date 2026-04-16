"use client";

import { Suspense } from "react";
import {
  Users,
  RefreshCcw,
  Wallet,
  Building2,
  Calculator,
} from "lucide-react";
import { Sidebar } from "@/components/sidebar";

const navItems = [
  { href: "/players", label: "Players", icon: Users },
  { href: "/po-cycle", label: "PO Cycle", icon: RefreshCcw },
  { href: "/investors", label: "Investors", icon: Wallet },
  { href: "/entity", label: "Entity", icon: Building2 },
  { href: "/simulation", label: "Simulation", icon: Calculator },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Suspense><Sidebar navItems={navItems} /></Suspense>
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  );
}
