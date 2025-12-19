// src/skd/skdEngineV2.ts
// ============================================================
// SKD v2 — KONTRAKT (ZAMROŻONY)
// - WPS = zawsze do dziś
// - WIBOR = tylko urealnienie historycznej raty
// - Marża = rekonstruowana z APR_start − WIBOR(start)
// - Brak ALT, brak widełek, brak filozofii hipotecznej
// - Przyszłe korzyści ≠ WPS
// Każdy kod, który temu przeczy → OUT
// ============================================================

/** Wejście (legacy) — dokładnie to, co podałeś */
export type SkdV2Input = {
  contractDate: Date | string; // data zawarcia
  termMonths: number;          // okres (miesiące)
  aprStartPct: number;         // oprocentowanie na start (PCT, np. 10 oznacza 10%)
  loanGross: number;           // kwota kredytu brutto (do wyliczenia raty, jeśli brak)
  loanNet: number;             // kwota kredytu netto (to odejmujemy w WPS)
  installment?: number | null; // rata z umowy; jeśli brak -> wyliczamy
  wiborType?: "3M";            // na razie tylko 3M (wg kontraktu i tabeli)
};

export type SkdV2Result = {
  wpsToday: number;

  paidToDate: number;
  monthsPaid: number;

  installmentUsed: number; // rata użyta do zbudowania "płatności do dziś" (historycznej symulacji)
  principalNet: number;

  aprStartPct: number;
  wiborStartPct: number;
  marginStartPct: number;

  asOfDate: Date;
  notes: string[];  capDueToDate: number; // m * (K_net / n)
  wpsTodayRaw: number;  // paidToDate - capDueToDate (przed clamp/round)

};

// ============================================================
// WIBOR 3M — monthly (2013-2025) z tabeli
// ============================================================

const WIBOR_3M_MONTHLY: Array<{ month: string; rate: number }> = [
  // ... (tu wklejona Twoja tabela, bez zmian)
  { month: "2013-01", rate: 4.0323 }, { month: "2013-02", rate: 4.0182 }, { month: "2013-03", rate: 3.9768 },
  { month: "2013-04", rate: 3.8420 }, { month: "2013-05", rate: 3.3239 }, { month: "2013-06", rate: 2.8231 },
  { month: "2013-07", rate: 2.7339 }, { month: "2013-08", rate: 2.7177 }, { month: "2013-09", rate: 2.6985 },
  { month: "2013-10", rate: 2.7047 }, { month: "2013-11", rate: 2.7115 }, { month: "2013-12", rate: 2.7208 },

  { month: "2014-01", rate: 2.7174 }, { month: "2014-02", rate: 2.7192 }, { month: "2014-03", rate: 2.7180 },
  { month: "2014-04", rate: 2.7128 }, { month: "2014-05", rate: 2.7121 }, { month: "2014-06", rate: 2.7182 },
  { month: "2014-07", rate: 2.7190 }, { month: "2014-08", rate: 2.7151 }, { month: "2014-09", rate: 2.7150 },
  { month: "2014-10", rate: 2.2524 }, { month: "2014-11", rate: 2.0413 }, { month: "2014-12", rate: 1.8623 },

  { month: "2015-01", rate: 2.0339 }, { month: "2015-02", rate: 1.9715 }, { month: "2015-03", rate: 1.6759 },
  { month: "2015-04", rate: 1.6243 }, { month: "2015-05", rate: 1.5912 }, { month: "2015-06", rate: 1.6885 },
  { month: "2015-07", rate: 1.6795 }, { month: "2015-08", rate: 1.6780 }, { month: "2015-09", rate: 1.6727 },
  { month: "2015-10", rate: 1.6709 }, { month: "2015-11", rate: 1.6683 }, { month: "2015-12", rate: 1.6638 },

  { month: "2016-01", rate: 1.6524 }, { month: "2016-02", rate: 1.6232 }, { month: "2016-03", rate: 1.6141 },
  { month: "2016-04", rate: 1.6174 }, { month: "2016-05", rate: 1.6171 }, { month: "2016-06", rate: 1.6131 },
  { month: "2016-07", rate: 1.6106 }, { month: "2016-08", rate: 1.6076 }, { month: "2016-09", rate: 1.6079 },
  { month: "2016-10", rate: 1.6091 }, { month: "2016-11", rate: 1.6110 }, { month: "2016-12", rate: 1.6129 },

  { month: "2017-01", rate: 1.7260 }, { month: "2017-02", rate: 1.7376 }, { month: "2017-03", rate: 1.7526 },
  { month: "2017-04", rate: 1.7690 }, { month: "2017-05", rate: 1.6894 }, { month: "2017-06", rate: 1.7203 },
  { month: "2017-07", rate: 1.6508 }, { month: "2017-08", rate: 1.6973 }, { month: "2017-09", rate: 1.6840 },
  { month: "2017-10", rate: 1.6729 }, { month: "2017-11", rate: 1.6913 }, { month: "2017-12", rate: 1.6956 },

  { month: "2018-01", rate: 1.6921 }, { month: "2018-02", rate: 1.6848 }, { month: "2018-03", rate: 1.6935 },
  { month: "2018-04", rate: 1.6194 }, { month: "2018-05", rate: 1.6427 }, { month: "2018-06", rate: 1.6547 },
  { month: "2018-07", rate: 1.6557 }, { month: "2018-08", rate: 1.7345 }, { month: "2018-09", rate: 1.7255 },
  { month: "2018-10", rate: 1.7215 }, { month: "2018-11", rate: 1.7186 }, { month: "2018-12", rate: 1.7005 },

  { month: "2019-01", rate: 1.7038 }, { month: "2019-02", rate: 1.7122 }, { month: "2019-03", rate: 1.7036 },
  { month: "2019-04", rate: 1.7014 }, { month: "2019-05", rate: 1.7024 }, { month: "2019-06", rate: 1.7058 },
  { month: "2019-07", rate: 1.7154 }, { month: "2019-08", rate: 1.6855 }, { month: "2019-09", rate: 1.7072 },
  { month: "2019-10", rate: 1.7090 }, { month: "2019-11", rate: 1.7054 }, { month: "2019-12", rate: 1.7046 },

  { month: "2020-01", rate: 1.7045 }, { month: "2020-02", rate: 1.7737 }, { month: "2020-03", rate: 1.4685 },
  { month: "2020-04", rate: 0.7948 }, { month: "2020-05", rate: 0.5947 }, { month: "2020-06", rate: 0.2483 },
  { month: "2020-07", rate: 0.2390 }, { month: "2020-08", rate: 0.2317 }, { month: "2020-09", rate: 0.2139 },
  { month: "2020-10", rate: 0.2179 }, { month: "2020-11", rate: 0.2132 }, { month: "2020-12", rate: 0.2054 },

  { month: "2021-01", rate: 0.2086 }, { month: "2021-02", rate: 0.2122 }, { month: "2021-03", rate: 0.2240 },
  { month: "2021-04", rate: 0.2148 }, { month: "2021-05", rate: 0.2120 }, { month: "2021-06", rate: 0.2128 },
  { month: "2021-07", rate: 0.2215 }, { month: "2021-08", rate: 0.2350 }, { month: "2021-09", rate: 0.2467 },
  { month: "2021-10", rate: 0.5942 }, { month: "2021-11", rate: 1.7883 }, { month: "2021-12", rate: 2.4217 },

  { month: "2022-01", rate: 2.6850 }, { month: "2022-02", rate: 3.2786 }, { month: "2022-03", rate: 4.1350 },
  { month: "2022-04", rate: 5.4352 }, { month: "2022-05", rate: 6.4508 }, { month: "2022-06", rate: 7.0002 },
  { month: "2022-07", rate: 7.2111 }, { month: "2022-08", rate: 7.0858 }, { month: "2022-09", rate: 7.2167 },
  { month: "2022-10", rate: 7.5129 }, { month: "2022-11", rate: 7.3567 }, { month: "2022-12", rate: 6.9122 },

  { month: "2023-01", rate: 6.9386 }, { month: "2023-02", rate: 6.8928 }, { month: "2023-03", rate: 6.9167 },
  { month: "2023-04", rate: 6.9313 }, { month: "2023-05", rate: 6.8415 }, { month: "2023-06", rate: 6.7380 },
  { month: "2023-07", rate: 6.6955 }, { month: "2023-08", rate: 6.6193 }, { month: "2023-09", rate: 6.5808 },
  { month: "2023-10", rate: 5.8020 }, { month: "2023-11", rate: 5.7175 }, { month: "2023-12", rate: 5.7996 },

  { month: "2024-01", rate: 5.8507 }, { month: "2024-02", rate: 5.8458 }, { month: "2024-03", rate: 5.8507 },
  { month: "2024-04", rate: 5.8455 }, { month: "2024-05", rate: 5.8467 }, { month: "2024-06", rate: 5.8488 },
  { month: "2024-07", rate: 5.8520 }, { month: "2024-08", rate: 5.8500 }, { month: "2024-09", rate: 5.8500 },
  { month: "2024-10", rate: 5.8500 }, { month: "2024-11", rate: 5.8500 }, { month: "2024-12", rate: 5.8500 },

  { month: "2025-01", rate: 5.8500 }, { month: "2025-02", rate: 5.8500 }, { month: "2025-03", rate: 5.8500 },
  { month: "2025-04", rate: 5.5500 }, { month: "2025-05", rate: 5.4500 }, { month: "2025-06", rate: 5.4500 },
  { month: "2025-07", rate: 5.0500 }, { month: "2025-08", rate: 4.8500 }, { month: "2025-09", rate: 4.7500 },
  { month: "2025-10", rate: 4.5300 }, { month: "2025-11", rate: 4.3000 }, { month: "2025-12", rate: 4.1500 },
];

export function getWibor3MPct(date: Date): number {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const key = `${y}-${m}`;

  for (let i = WIBOR_3M_MONTHLY.length - 1; i >= 0; i--) {
    if (WIBOR_3M_MONTHLY[i].month <= key) return WIBOR_3M_MONTHLY[i].rate;
  }
  return WIBOR_3M_MONTHLY[0]?.rate ?? 0;
}

// ============================================================
// Helpers / walidacje
// ============================================================

function toDateStrict(d: Date | string): Date {
  const dt = (d instanceof Date) ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) throw new Error(`[SKD v2] Nieprawidłowa data: ${String(d)}`);
  return dt;
}

function assertPos(name: string, n: number) {
  if (!Number.isFinite(n) || n <= 0) throw new Error(`[SKD v2] ${name} musi być > 0. Otrzymano: ${n}`);
}

function normalizeDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Liczba rat "do dziś" wg Twojego poprzedniego założenia:
 * - pierwsza rata = miesiąc po dacie zawarcia
 * - liczymy pełne miesiące, które minęły od tej pierwszej raty
 */
export function calculateMonthsPaid(contractDate: Date, asOfDate: Date = new Date()): number {
  const start = new Date(contractDate);
  start.setMonth(start.getMonth() + 1); // pierwsza rata = kolejny miesiąc

  const today = new Date(asOfDate);

  let months =
    (today.getFullYear() - start.getFullYear()) * 12 +
    (today.getMonth() - start.getMonth());

  return Math.max(0, months);
}

export function annuityPayment(principal: number, months: number, annualRate: number): number {
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return principal * (r / (1 - Math.pow(1 + r, -months)));
}

/** KONTRAKT: marża = APR_start − WIBOR(start) */
export function deriveMarginStartPct(aprStartPct: number, wiborStartPct: number): number {
  const margin = aprStartPct - wiborStartPct;
  if (!Number.isFinite(margin) || margin <= 0) {
    throw new Error(`[SKD v2] marginStartPct <= 0. APR_start=${aprStartPct}, WIBOR_start=${wiborStartPct}`);
  }
  return margin;
}

/** Rata techniczna (gdy brak raty z umowy): liczona z brutto + APR_start + okres */
export function deriveInstallmentFromGross(opts: { loanGross: number; termMonths: number; aprStartPct: number }): number {
  assertPos("loanGross", opts.loanGross);
  assertPos("termMonths", opts.termMonths);
  assertPos("aprStartPct", opts.aprStartPct);

  const annualRate = opts.aprStartPct / 100;
  return annuityPayment(opts.loanGross, opts.termMonths, annualRate);
}

// ============================================================
// Klucz: WIBOR tylko do urealnienia historii rat (do dziś)
// ============================================================

function estimatePaidToDateByHistoricalWibor(opts: {
  principal: number;      // saldo startowe (tu: brutto, bo rata liczona od brutto)
  termMonths: number;
  monthsPaid: number;
  contractDate: Date;
  marginStartPct: number; // stała marża
  getWiborPct: (d: Date) => number;
  resetEveryMonths: number; // dla 3M -> 3
}): number {
  let balance = opts.principal;
  let totalPaid = 0;

  let payment = 0;
  let monthlyRate = 0;

  const limit = Math.max(0, Math.min(opts.termMonths, opts.monthsPaid));

  for (let m = 1; m <= limit; m++) {
    if (m === 1 || (m - 1) % opts.resetEveryMonths === 0) {
      const resetDate = new Date(opts.contractDate);
      resetDate.setMonth(resetDate.getMonth() + (m - 1));

      const wiborPct = opts.getWiborPct(resetDate);
      const annualRate = (opts.marginStartPct + wiborPct) / 100;

      payment = annuityPayment(balance, opts.termMonths - (m - 1), annualRate);
      monthlyRate = annualRate / 12;
    }

    const interest = balance * monthlyRate;
    const capital = payment - interest;

    // bezpieczeństwo numeryczne (bez filozofii): nie pozwalamy na ujemny kapitał w tej iteracji
    const cap = Math.max(0, capital);
    balance = Math.max(0, balance - cap);

    totalPaid += payment;
  }

  return totalPaid;
}

// ============================================================
// Główna funkcja SKD v2
// ============================================================

export function computeSkdV2(input: SkdV2Input, opts?: { asOfDate?: Date }): SkdV2Result {
  const notes: string[] = [];

  const contractDate = toDateStrict(input.contractDate);
  const asOfDate = normalizeDayUTC(opts?.asOfDate ?? new Date());

  assertPos("termMonths", input.termMonths);
  assertPos("aprStartPct", input.aprStartPct);
  assertPos("loanGross", input.loanGross);
  assertPos("loanNet", input.loanNet);

  // 1) monthsPaid (do dziś)
  const monthsPaid = calculateMonthsPaid(contractDate, asOfDate);

  // 2) WIBOR(start) + marża stała
  const wiborStartPct = getWibor3MPct(contractDate);
  const marginStartPct = deriveMarginStartPct(input.aprStartPct, wiborStartPct);

  // 3) rata: z umowy albo wyliczona technicznie z brutto + APR_start + okres
  let installmentUsed = (input.installment != null && Number.isFinite(Number(input.installment)) && Number(input.installment) > 0)
    ? Number(input.installment)
    : deriveInstallmentFromGross({ loanGross: input.loanGross, termMonths: input.termMonths, aprStartPct: input.aprStartPct });

  if (input.installment == null) {
    notes.push("Brak raty z umowy → rata wyliczona technicznie z kwoty brutto, APR_start i okresu.");
  }

  // 4) paidToDate = urealnione historyczne raty (WIBOR 3M reset co 3 mies.)
  // KONTRAKT: WIBOR służy tu tylko do historii (do dziś), zero prognoz.
  const paidToDate = estimatePaidToDateByHistoricalWibor({
    principal: input.loanGross,      // rata bazuje na brutto (bo to “całkowity koszt kredytu” w harmonogramie)
    termMonths: input.termMonths,
    monthsPaid,
    contractDate,
    marginStartPct,
    getWiborPct: getWibor3MPct,
    resetEveryMonths: 3,
  });

 // 5) WPS do dziś — nadwyżka ponad kapitał należny do dziś (kapitał liniowo)
const capDueToDate = monthsPaid * (Number(input.loanNet) / Number(input.termMonths));

const wpsTodayRaw = paidToDate - capDueToDate;
const wpsToday = Math.max(0, Math.round(wpsTodayRaw));


  return {
    wpsToday,
    paidToDate,
    monthsPaid,
    installmentUsed,
    principalNet: input.loanNet,
    aprStartPct: input.aprStartPct,
    wiborStartPct,
    marginStartPct,
    asOfDate,
    notes,
    capDueToDate,
wpsTodayRaw,

  };
}
