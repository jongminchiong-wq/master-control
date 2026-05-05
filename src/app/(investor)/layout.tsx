"use client";

import { Suspense } from "react";
import { Home, Calculator, Shield, Wallet } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const navItems = [
  { href: "/portfolio", label: "Home", icon: Home },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/returns", label: "Simulator", icon: Calculator },
];

const footerNavItems = [
  { href: "/security", label: "Security", icon: Shield },
];

export default function InvestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Suspense><Sidebar navItems={navItems} footerNavItems={footerNavItems} /></Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex flex-1 flex-col overflow-auto bg-gray-50 px-6 pb-6 pt-6">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            {children}
            <Footer />
          </div>
        </main>
      </div>
    </div>
  );
}
