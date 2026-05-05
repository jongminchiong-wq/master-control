"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SecurityPanel } from "@/components/security-panel";

export default function SecurityPage() {
  const [isMandatory, setIsMandatory] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

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
      const role = record?.role;
      setIsMandatory(role === "player" || role === "investor");
    })();
  }, []);

  const showBack = !isMandatory || enrolled;
  const canDisable = !isMandatory;

  return (
    <div className="mx-auto w-full max-w-xl">
      {showBack && (
        <Link
          href="/profile"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
        >
          <ArrowLeft className="size-4" strokeWidth={1.6} />
          Back to profile
        </Link>
      )}
      <SecurityPanel
        canDisable={canDisable}
        onEnrollmentChange={setEnrolled}
      />
    </div>
  );
}
