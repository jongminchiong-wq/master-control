"use client";

import { Suspense } from "react";
import {
  Users,
  RefreshCcw,
  Wallet,
  Building2,
  Calculator,
  Shield,
  Inbox,
} from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";

const navItems = [
  { href: "/players", label: "Players", icon: Users },
  { href: "/po-cycle", label: "PO Cycle", icon: RefreshCcw },
  { href: "/investors", label: "Investors", icon: Wallet },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/entity", label: "Entity", icon: Building2 },
  { href: "/simulation", label: "Simulation", icon: Calculator },
];

const footerNavItems = [
  { href: "/security", label: "Security", icon: Shield },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Suspense><Sidebar navItems={navItems} footerNavItems={footerNavItems} /></Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto bg-gray-50 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
