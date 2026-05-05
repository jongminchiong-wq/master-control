"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type UserBadgeProps = {
  iconOnly?: boolean;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserBadge({ iconOnly = false }: UserBadgeProps) {
  const [profile, setProfile] = useState<{ name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: row } = await supabase
        .from("users")
        .select("name")
        .eq("id", user.id)
        .single();

      if (cancelled) return;
      setProfile({ name: row?.name ?? "" });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile?.name) return null;

  return (
    <Link
      href="/profile"
      aria-label={`${profile.name} — open profile`}
      className="group/tip relative inline-flex items-center rounded-lg hover:bg-gray-100"
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800",
          iconOnly && "justify-center px-0"
        )}
      >
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-600"
        >
          {getInitials(profile.name)}
        </span>
      </div>
      {iconOnly && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100"
        >
          {profile.name}
        </span>
      )}
    </Link>
  );
}
