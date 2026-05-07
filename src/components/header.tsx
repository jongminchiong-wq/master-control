"use client";

import { UserBadge } from "@/components/user-badge";
import { cn } from "@/lib/utils";

type HeaderProps = {
  hideUserBadge?: boolean;
  containerClass?: string;
};

export function Header({
  hideUserBadge = false,
  containerClass,
}: HeaderProps = {}) {
  return (
    <header className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-gray-50 px-6">
      <div className={cn("flex w-full items-center justify-end", containerClass)}>
        {!hideUserBadge && <UserBadge />}
      </div>
    </header>
  );
}
