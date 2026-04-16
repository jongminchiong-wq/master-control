// Formatting helpers — extracted from master-control-v2.jsx lines 92–97

export const fmt = (n: number): string =>
  "RM " + Math.round(n).toLocaleString("en-MY");

export const fmtDec = (n: number): string =>
  n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const getMonth = (dateStr: string | null | undefined): string =>
  dateStr ? dateStr.slice(0, 7) : "";

export const fmtMonth = (m: string): string => {
  const [y, mo] = m.split("-");
  const names = [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return names[parseInt(mo)] + " " + y;
};
