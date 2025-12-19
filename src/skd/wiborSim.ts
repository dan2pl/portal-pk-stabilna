// src/utils/wiborSim.ts (albo gdzie trzymasz)
// Minimalna, ale poprawna symulacja rat annuitetowych z resetem WIBOR co 3/6M

export type GetWiborFn = (resetDate: Date) => number; // zwraca % np. 6.5

export function annuityPayment(principal: number, months: number, annualRate: number) {
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return principal * (r / (1 - Math.pow(1 + r, -months)));
}

export function simulateVariableWiborSchedule(opts: {
  principal: number;
  termMonths: number;
  marginPct: number;        // marża w % (np. 2.3)
  wiborType: "3M" | "6M";
  startDate: Date;
  getWiborPct: GetWiborFn;
  limitMonths?: number;     // ✅ policz tylko pierwsze m miesięcy (do WPS “do dziś”)
}) {
  const resetEvery = opts.wiborType === "3M" ? 3 : 6;

  let balance = opts.principal;
  let totalPaid = 0;
  let totalInterest = 0;

  // ✅ limit liczenia
  const limit = Number.isFinite(opts.limitMonths)
    ? Math.min(opts.termMonths, Math.max(0, opts.limitMonths as number))
    : opts.termMonths;

  // ✅ ważne: muszą żyć poza ifem
  let payment = 0;
  let monthlyRate = 0;

  for (let m = 1; m <= limit; m++) {
    // reset stopy na początku okresu (m=1 oraz co 3/6 mies.)
    if (m === 1 || (m - 1) % resetEvery === 0) {
      const resetDate = new Date(opts.startDate);
      resetDate.setMonth(resetDate.getMonth() + (m - 1));

      const wibor = opts.getWiborPct(resetDate); // % (np. 6.5)
      const annualRate = (opts.marginPct + wibor) / 100;

      payment = annuityPayment(balance, opts.termMonths - (m - 1), annualRate);
      monthlyRate = annualRate / 12;
    }

    const interest = balance * monthlyRate;
    const capital = payment - interest;

    balance = Math.max(0, balance - capital);

    totalPaid += payment;
    totalInterest += interest;
  }

  return { totalPaid, totalInterest, remainingBalance: balance };
}

export function simulateMarginOnlySchedule(opts: {
  principal: number;
  termMonths: number;
  marginPct: number;
  limitMonths?: number;     // ✅ też potrzebne dla “do m rat”
}) {
  const annualRate = opts.marginPct / 100;
  const payment = annuityPayment(opts.principal, opts.termMonths, annualRate);

  let balance = opts.principal;
  let totalPaid = 0;
  let totalInterest = 0;
  const monthlyRate = annualRate / 12;

  const limit = Number.isFinite(opts.limitMonths)
    ? Math.min(opts.termMonths, Math.max(0, opts.limitMonths as number))
    : opts.termMonths;

  for (let m = 1; m <= limit; m++) {
    const interest = balance * monthlyRate;
    const capital = payment - interest;

    balance = Math.max(0, balance - capital);

    totalPaid += payment;
    totalInterest += interest;
  }

  return { totalPaid, totalInterest, remainingBalance: balance };
}

export function simulateCapitalOnly(opts: {
  principal: number;
  termMonths: number;
  limitMonths?: number;     // ✅ dla porównania “do m rat”
}) {
  const limit = Number.isFinite(opts.limitMonths)
    ? Math.min(opts.termMonths, Math.max(0, opts.limitMonths as number))
    : opts.termMonths;

  const payment = opts.principal / opts.termMonths;
  const totalPaid = payment * limit;

  return { totalPaid, payment };
}