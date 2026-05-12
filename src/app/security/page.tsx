"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SecurityPanel } from "@/components/security-panel";

export default function SecurityPage() {
  return (
    <div className="mx-auto w-full max-w-xl">
      <Link
        href="/profile"
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
      >
        <ArrowLeft className="size-4" strokeWidth={1.6} />
        Back to profile
      </Link>
      <SecurityPanel />
    </div>
  );
}
