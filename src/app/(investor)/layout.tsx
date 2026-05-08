"use client";

import { Suspense } from "react";
import { Home, Wallet, DollarSign, TrendingUp, Users } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const navItems = [
  { href: "/portfolio", label: "Home", icon: Home },
  { href: "/deployments", label: "Deployments", icon: DollarSign },
  { href: "/cycle-history", label: "Cycle History", icon: TrendingUp },
  { href: "/network", label: "Investors Network", icon: Users },
  { href: "/wallet", label: "Wallet", icon: Wallet },
];

export default function InvestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <div className="hidden md:flex">
        <Suspense><Sidebar navItems={navItems} /></Suspense>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header containerClass="mx-auto max-w-5xl" />
        <main className="flex flex-1 flex-col overflow-auto bg-gray-50 px-6 pb-24 pt-6 md:pb-6">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {children}
            <Footer />
          </div>
        </main>
      </div>
      <Suspense><MobileBottomNav navItems={navItems} /></Suspense>
    </div>
  );
}
