"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function getCurrentMonth() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function useSelectedMonth(): [string, (month: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("month");
  const selectedMonth = raw && MONTH_RE.test(raw) ? raw : getCurrentMonth();

  const setSelectedMonth = useCallback(
    (month: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("month", month);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return [selectedMonth, setSelectedMonth];
}
