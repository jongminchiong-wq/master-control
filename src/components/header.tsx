"use client";

import { UserBadge } from "@/components/user-badge";

type HeaderProps = {
  hideUserBadge?: boolean;
};

export function Header({ hideUserBadge = false }: HeaderProps = {}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end border-b border-gray-200 bg-gray-50 px-4">
      {!hideUserBadge && <UserBadge />}
    </header>
  );
}
