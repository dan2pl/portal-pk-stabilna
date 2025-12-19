// src/utils/wibor3m.ts

export interface WiborPoint {
  month: string; // YYYY-MM
  rate: number;  // w %
}

// TU docelowo wkleimy dane wygenerowane z CSV
export const WIBOR_3M_MONTHLY: WiborPoint[] = [
  // placeholder – na razie 2–3 wpisy testowe
  { month: "2013-01", rate: 4.15 },
  { month: "2013-02", rate: 4.12 },
];

export function getWibor3MFromMonthly(date: Date): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const key = `${y}-${m}`;

  // szukamy najbliższego <= key
  for (let i = WIBOR_3M_MONTHLY.length - 1; i >= 0; i--) {
    if (WIBOR_3M_MONTHLY[i].month <= key) {
      return WIBOR_3M_MONTHLY[i].rate;
    }
  }

  // fallback: pierwszy znany
  return WIBOR_3M_MONTHLY[0]?.rate ?? 0;
}
// ⛔ tylko do testów lokalnych
if (typeof window !== "undefined") {
  (window as any).getWibor3MFromMonthly = getWibor3MFromMonthly;
}