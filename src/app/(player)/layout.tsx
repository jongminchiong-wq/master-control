"use client";

import { Suspense } from "react";
import {
  Home,
  ArrowDownToLine,
  Package,
  Users,
} from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { PlayerMonthProvider } from "./_month-context";

const navItems = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/my-pos", label: "My Purchase Order", icon: Package },
  { href: "/introducer-commission", label: "Introducer Commission", icon: Users },
  { href: "/withdrawals", label: "Withdrawals", icon: ArrowDownToLine },
];

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Suspense><Sidebar navItems={navItems} /></Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header containerClass="mx-auto max-w-5xl" />
        <main className="flex flex-1 flex-col overflow-auto bg-gray-50 px-6 pb-6 pt-6">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            <PlayerMonthProvider>{children}</PlayerMonthProvider>
            <Footer />
          </div>
        </main>
      </div>
    </div>
  );
}
