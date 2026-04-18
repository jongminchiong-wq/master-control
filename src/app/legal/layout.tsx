"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Command } from "lucide-react";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <Command className="size-5 text-brand-600" strokeWidth={1.5} />
          <span>BridgeConnect</span>
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} />
          Back
        </button>
      </header>
      <main className="mx-auto max-w-3xl p-6 md:p-10">{children}</main>
    </div>
  );
}
