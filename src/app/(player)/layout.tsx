"use client";

import { Suspense } from "react";
import { LayoutDashboard, Calculator, Shield } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { Footer } from "@/components/footer";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/simulator", label: "Simulator", icon: Calculator },
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
      <main className="flex flex-1 flex-col overflow-auto bg-gray-50 p-6">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
          {children}
          <Footer />
        </div>
      </main>
    </div>
  );
}
