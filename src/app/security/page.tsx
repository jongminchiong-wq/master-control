"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SecurityPanel } from "@/components/security-panel";

export default function SecurityPage() {
  const [backHref, setBackHref] = useState("/");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: record } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .single();
      if (record?.role === "admin") setBackHref("/players");
      else if (record?.role === "investor") setBackHref("/portfolio");
      else setBackHref("/dashboard");
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link
            href={backHref}
            className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            <ArrowLeft className="size-4" strokeWidth={1.6} />
            Back to dashboard
          </Link>
        </div>
      </header>
      <main className="px-4">
        <SecurityPanel />
      </main>
    </div>
  );
}
