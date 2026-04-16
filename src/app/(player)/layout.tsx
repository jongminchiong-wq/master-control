"use client";

import { LayoutDashboard, Calculator } from "lucide-react";
import { Sidebar } from "@/components/sidebar";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/simulator", label: "Simulator", icon: Calculator },
];

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar navItems={navItems} />
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  );
}
