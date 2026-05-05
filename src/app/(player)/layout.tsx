"use client";

import { Suspense } from "react";
import {
  Home,
  Calculator,
  Shield,
  ArrowDownToLine,
  Package,
  Users,
} from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { Footer } from "@/components/footer";
import { PlayerMonthProvider } from "./_month-context";

const navItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
  { href: "/simulator", label: "Simulator", icon: Calculator },
  { href: "/my-pos", label: "My PO", icon: Package },
  { href: "/introducer-commission", label: "Introducer Commission", icon: Users },
];

const footerNavItems = [
  { href: "/security", label: "Security", icon: Shield },
];

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Suspense><Sidebar navItems={navItems} footerNavItems={footerNavItems} /></Suspense>
      <main className="flex flex-1 flex-col overflow-auto bg-gray-50 px-6 pb-6 pt-14">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
          <PlayerMonthProvider>{children}</PlayerMonthProvider>
          <Footer />
        </div>
      </main>
    </div>
  );
}
