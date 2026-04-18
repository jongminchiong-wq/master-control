"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
    <div className="min-w-0">
      <p className="truncate text-sm font-medium text-gray-800">
        {profile.name}
      </p>
    </div>
  );
}
