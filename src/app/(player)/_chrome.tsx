"use client";

import { Suspense } from "react";
import { Home, Wallet, FileText, Users } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { PlayerMonthProvider } from "./_month-context";

export function PlayerChrome({
  children,
  showIntroducer,
}: {
  children: React.ReactNode;
  showIntroducer: boolean;
}) {
  const navItems = [
    { href: "/dashboard", label: "Home", icon: Home },
    { href: "/my-pos", label: "My Purchase Order", icon: FileText },
    ...(showIntroducer
      ? [
          {
            href: "/introducer-commission",
            label: "Introducer Commission",
            icon: Users,
          },
        ]
      : []),
    { href: "/withdrawals", label: "Withdrawals", icon: Wallet },
  ];

  return (
    <div className="flex h-screen">
      <div className="hidden md:flex">
        <Suspense>
          <Sidebar navItems={navItems} />
        </Suspense>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header containerClass="mx-auto max-w-5xl" />
        <main className="flex flex-1 flex-col overflow-auto bg-gray-50 px-6 pb-24 pt-6 md:pb-6">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            <PlayerMonthProvider>{children}</PlayerMonthProvider>
            <Footer />
          </div>
        </main>
      </div>
      <Suspense>
        <MobileBottomNav navItems={navItems} />
      </Suspense>
    </div>
  );
}
