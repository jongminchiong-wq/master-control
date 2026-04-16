"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function UserBadge() {
  const [profile, setProfile] = useState<{ name: string; email: string } | null>(
    null
  );

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
        .select("name, email")
        .eq("id", user.id)
        .single();

      if (cancelled) return;
      setProfile({
        name: row?.name ?? "",
        email: row?.email ?? user.email ?? "",
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile) return null;

  return (
    <div className="min-w-0">
      {profile.name && (
        <p className="truncate text-sm font-medium text-gray-800">
          {profile.name}
        </p>
      )}
      <p className="truncate text-xs text-gray-500">{profile.email}</p>
    </div>
  );
}
