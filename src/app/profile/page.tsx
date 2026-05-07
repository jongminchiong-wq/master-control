"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Calculator, ChevronRight, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LogoutButton } from "@/components/logout-button";

export default function ProfilePage() {
  const [name, setName] = useState<string | null>(null);
  const [backHref, setBackHref] = useState("/");
  const [simulatorHref, setSimulatorHref] = useState<string | null>(null);

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
        .select("name, role")
        .eq("id", user.id)
        .single();

      if (cancelled) return;
      setName(row?.name ?? "");
      const role = row?.role;
      if (role === "admin") {
        setBackHref("/players");
        setSimulatorHref(null);
      } else if (role === "investor") {
        setBackHref("/portfolio");
        setSimulatorHref("/returns");
      } else {
        setBackHref("/dashboard");
        setSimulatorHref("/simulator");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (name === null) return null;

  return (
    <div className="mx-auto w-full max-w-xl">
      <Link
        href={backHref}
        className="mb-6 inline-flex items-center gap-5 text-sm font-medium text-gray-600 hover:text-gray-800"
      >
        <ArrowLeft className="size-6" strokeWidth={1.6} />
        Back
      </Link>

      <h1 className="font-sans text-2xl font-semibold text-gray-900">
        Welcome, {name}
      </h1>

      <div className="mt-6 divide-y divide-gray-200 rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
        {simulatorHref && (
          <Link
            href={simulatorHref}
            className="flex items-center gap-5 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Calculator className="size-6 text-gray-400" strokeWidth={1.5} />
            <span className="flex-1">Simulator</span>
            <ChevronRight className="size-6 text-gray-400" strokeWidth={1.5} />
          </Link>
        )}
        <Link
          href="/security"
          className="flex items-center gap-5 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Shield className="size-6 text-gray-400" strokeWidth={1.5} />
          <span className="flex-1">Security</span>
          <ChevronRight className="size-6 text-gray-400" strokeWidth={1.5} />
        </Link>
        <div className="px-2 py-2">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
