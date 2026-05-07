"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LogoutButtonProps = {
  iconOnly?: boolean;
};

export function LogoutButton({ iconOnly = false }: LogoutButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={loading}
      aria-label="Sign out"
      className={cn(
        "w-full gap-5 text-gray-500 hover:bg-gray-100 hover:text-gray-700",
        iconOnly ? "justify-center px-0" : "justify-start"
      )}
    >
      <LogOut className="size-5 text-gray-400" strokeWidth={1.5} />
      {!iconOnly && (loading ? "Signing out…" : "Sign out")}
    </Button>
  );
}
