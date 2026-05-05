"use client";

import { UserBadge } from "@/components/user-badge";

export function Header() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end border-b border-gray-200 bg-white px-4">
      <UserBadge />
    </header>
  );
}
