"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

function getCurrentMonth() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

type Ctx = {
  selectedMonth: string;
  setSelectedMonth: (m: string) => void;
};

const PlayerMonthContext = createContext<Ctx | null>(null);

export function PlayerMonthProvider({ children }: { children: ReactNode }) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);
  return (
    <PlayerMonthContext.Provider value={{ selectedMonth, setSelectedMonth }}>
      {children}
    </PlayerMonthContext.Provider>
  );
}

export function usePlayerSelectedMonth(): [string, (m: string) => void] {
  const ctx = useContext(PlayerMonthContext);
  if (!ctx) {
    throw new Error(
      "usePlayerSelectedMonth must be used inside PlayerMonthProvider",
    );
  }
  return [ctx.selectedMonth, ctx.setSelectedMonth];
}
