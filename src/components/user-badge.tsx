"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserBadge() {
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
      className="inline-flex items-center"
    >
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-600 transition-colors hover:bg-brand-100"
      >
        {getInitials(profile.name)}
      </span>
    </Link>
  );
}
