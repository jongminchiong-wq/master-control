"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type UserBadgeProps = {
  iconOnly?: boolean;
};

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
    <div className="group/tip relative">
      <div
        aria-label={profile.name}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-800",
          iconOnly && "justify-center px-0"
        )}
      >
        <User className="size-4 shrink-0 text-gray-400" strokeWidth={1.5} />
        {!iconOnly && <span className="truncate">{profile.name}</span>}
      </div>
      {iconOnly && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100"
        >
          {profile.name}
        </span>
      )}
    </div>
  );
}
