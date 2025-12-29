function annuityPayment(principal, months, annualRate) {
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return principal * (r / (1 - Math.pow(1 + r, -months)));
}

function simulateVariableWiborScheduleJS(opts) {
  const resetEvery = opts.wiborType === "3M" ? 3 : 6;

  let balance = opts.principal;
  let totalPaid = 0;
  let totalInterest = 0;

  let payment = 0;
  let monthlyRate = 0;

  const limitMonths = Number.isFinite(opts.limitMonths) ? opts.limitMonths : opts.termMonths;

  for (let m = 1; m <= Math.min(opts.termMonths, limitMonths); m++) {

    if (m === 1 || (m - 1) % resetEvery === 0) {
      const resetDate = new Date(opts.startDate);
      resetDate.setMonth(resetDate.getMonth() + (m - 1));

      const wibor = opts.getWiborPct(resetDate); // % np. 6.5
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

function simulateMarginOnlyScheduleJS(opts) {
  const annualRate = opts.marginPct / 100;
  const payment = annuityPayment(opts.principal, opts.termMonths, annualRate);

  let balance = opts.principal;
  let totalPaid = 0;
  let totalInterest = 0;
  const monthlyRate = annualRate / 12;

  const limitMonths = Number.isFinite(opts.limitMonths) ? opts.limitMonths : opts.termMonths;

  for (let m = 1; m <= Math.min(opts.termMonths, limitMonths); m++) {

    const interest = balance * monthlyRate;
    const capital = payment - interest;

    balance = Math.max(0, balance - capital);

    totalPaid += payment;
    totalInterest += interest;
  }

  return { totalPaid, totalInterest, remainingBalance: balance };
}

function simulateCapitalOnlyJS(opts) {
  const payment = opts.principal / opts.termMonths;
  return { totalPaid: payment * opts.termMonths, payment };
}

// ===============================
// WIBOR 3M — monthly (2013-2025) z CSV
// ===============================
const WIBOR_3M_MONTHLY = [
  // 2013
  { month: "2013-01", rate: 4.0323 },
  { month: "2013-02", rate: 4.0182 },
  { month: "2013-03", rate: 3.9768 },
  { month: "2013-04", rate: 3.8420 },
  { month: "2013-05", rate: 3.3239 },
  { month: "2013-06", rate: 2.8231 },
  { month: "2013-07", rate: 2.7339 },
  { month: "2013-08", rate: 2.7177 },
  { month: "2013-09", rate: 2.6985 },
  { month: "2013-10", rate: 2.7047 },
  { month: "2013-11", rate: 2.7115 },
  { month: "2013-12", rate: 2.7208 },
  // 2014
  { month: "2014-01", rate: 2.7174 },
  { month: "2014-02", rate: 2.7192 },
  { month: "2014-03", rate: 2.7180 },
  { month: "2014-04", rate: 2.7128 },
  { month: "2014-05", rate: 2.7121 },
  { month: "2014-06", rate: 2.7182 },
  { month: "2014-07", rate: 2.7190 },
  { month: "2014-08", rate: 2.7151 },
  { month: "2014-09", rate: 2.7150 },
  { month: "2014-10", rate: 2.2524 },
  { month: "2014-11", rate: 2.0413 },
  { month: "2014-12", rate: 1.8623 },
  // 2015
  { month: "2015-01", rate: 2.0339 },
  { month: "2015-02", rate: 1.9715 },
  { month: "2015-03", rate: 1.6759 },
  { month: "2015-04", rate: 1.6243 },
  { month: "2015-05", rate: 1.5912 },
  { month: "2015-06", rate: 1.6885 },
  { month: "2015-07", rate: 1.6795 },
  { month: "2015-08", rate: 1.6780 },
  { month: "2015-09", rate: 1.6727 },
  { month: "2015-10", rate: 1.6709 },
  { month: "2015-11", rate: 1.6683 },
  { month: "2015-12", rate: 1.6638 },
  // 2016
  { month: "2016-01", rate: 1.6524 },
  { month: "2016-02", rate: 1.6232 },
  { month: "2016-03", rate: 1.6141 },
  { month: "2016-04", rate: 1.6174 },
  { month: "2016-05", rate: 1.6171 },
  { month: "2016-06", rate: 1.6131 },
  { month: "2016-07", rate: 1.6106 },
  { month: "2016-08", rate: 1.6076 },
  { month: "2016-09", rate: 1.6079 },
  { month: "2016-10", rate: 1.6091 },
  { month: "2016-11", rate: 1.6110 },
  { month: "2016-12", rate: 1.6129 },
  // 2017
  { month: "2017-01", rate: 1.7260 },
  { month: "2017-02", rate: 1.7376 },
  { month: "2017-03", rate: 1.7526 },
  { month: "2017-04", rate: 1.7690 },
  { month: "2017-05", rate: 1.6894 },
  { month: "2017-06", rate: 1.7203 },
  { month: "2017-07", rate: 1.6508 },
  { month: "2017-08", rate: 1.6973 },
  { month: "2017-09", rate: 1.6840 },
  { month: "2017-10", rate: 1.6729 },
  { month: "2017-11", rate: 1.6913 },
  { month: "2017-12", rate: 1.6956 },
  // 2018
  { month: "2018-01", rate: 1.6921 },
  { month: "2018-02", rate: 1.6848 },
  { month: "2018-03", rate: 1.6935 },
  { month: "2018-04", rate: 1.6194 },
  { month: "2018-05", rate: 1.6427 },
  { month: "2018-06", rate: 1.6547 },
  { month: "2018-07", rate: 1.6557 },
  { month: "2018-08", rate: 1.7345 },
  { month: "2018-09", rate: 1.7255 },
  { month: "2018-10", rate: 1.7215 },
  { month: "2018-11", rate: 1.7186 },
  { month: "2018-12", rate: 1.7005 },
  // 2019
  { month: "2019-01", rate: 1.7038 },
  { month: "2019-02", rate: 1.7122 },
  { month: "2019-03", rate: 1.7036 },
  { month: "2019-04", rate: 1.7014 },
  { month: "2019-05", rate: 1.7024 },
  { month: "2019-06", rate: 1.7058 },
  { month: "2019-07", rate: 1.7154 },
  { month: "2019-08", rate: 1.6855 },
  { month: "2019-09", rate: 1.7072 },
  { month: "2019-10", rate: 1.7090 },
  { month: "2019-11", rate: 1.7054 },
  { month: "2019-12", rate: 1.7046 },
  // 2020
  { month: "2020-01", rate: 1.7045 },
  { month: "2020-02", rate: 1.7737 },
  { month: "2020-03", rate: 1.4685 },
  { month: "2020-04", rate: 0.7948 },
  { month: "2020-05", rate: 0.5947 },
  { month: "2020-06", rate: 0.2483 },
  { month: "2020-07", rate: 0.2390 },
  { month: "2020-08", rate: 0.2317 },
  { month: "2020-09", rate: 0.2139 },
  { month: "2020-10", rate: 0.2179 },
  { month: "2020-11", rate: 0.2132 },
  { month: "2020-12", rate: 0.2054 },
  // 2021
  { month: "2021-01", rate: 0.2086 },
  { month: "2021-02", rate: 0.2122 },
  { month: "2021-03", rate: 0.2240 },
  { month: "2021-04", rate: 0.2148 },
  { month: "2021-05", rate: 0.2120 },
  { month: "2021-06", rate: 0.2128 },
  { month: "2021-07", rate: 0.2215 },
  { month: "2021-08", rate: 0.2350 },
  { month: "2021-09", rate: 0.2467 },
  { month: "2021-10", rate: 0.5942 },
  { month: "2021-11", rate: 1.7883 },
  { month: "2021-12", rate: 2.4217 },
  // 2022
  { month: "2022-01", rate: 2.6850 },
  { month: "2022-02", rate: 3.2786 },
  { month: "2022-03", rate: 4.1350 },
  { month: "2022-04", rate: 5.4352 },
  { month: "2022-05", rate: 6.4508 },
  { month: "2022-06", rate: 7.0002 },
  { month: "2022-07", rate: 7.2111 },
  { month: "2022-08", rate: 7.0858 },
  { month: "2022-09", rate: 7.2167 },
  { month: "2022-10", rate: 7.5129 },
  { month: "2022-11", rate: 7.3567 },
  { month: "2022-12", rate: 6.9122 },
  // 2023
  { month: "2023-01", rate: 6.9386 },
  { month: "2023-02", rate: 6.8928 },
  { month: "2023-03", rate: 6.9167 },
  { month: "2023-04", rate: 6.9313 },
  { month: "2023-05", rate: 6.8415 },
  { month: "2023-06", rate: 6.7380 },
  { month: "2023-07", rate: 6.6955 },
  { month: "2023-08", rate: 6.6193 },
  { month: "2023-09", rate: 6.5808 },
  { month: "2023-10", rate: 5.8020 },
  { month: "2023-11", rate: 5.7175 },
  { month: "2023-12", rate: 5.7996 },
  // 2024
  { month: "2024-01", rate: 5.8507 },
  { month: "2024-02", rate: 5.8458 },
  { month: "2024-03", rate: 5.8507 },
  { month: "2024-04", rate: 5.8455 },
  { month: "2024-05", rate: 5.8467 },
  { month: "2024-06", rate: 5.8488 },
  { month: "2024-07", rate: 5.8520 },
  { month: "2024-08", rate: 5.8500 },
  { month: "2024-09", rate: 5.8500 },
  { month: "2024-10", rate: 5.8500 },
  { month: "2024-11", rate: 5.8500 },
  { month: "2024-12", rate: 5.8500 },
  // 2025
  { month: "2025-01", rate: 5.8500 },
  { month: "2025-02", rate: 5.8500 },
  { month: "2025-03", rate: 5.8500 },
  { month: "2025-04", rate: 5.5500 },
  { month: "2025-05", rate: 5.4500 },
  { month: "2025-06", rate: 5.4500 },
  { month: "2025-07", rate: 5.0500 },
  { month: "2025-08", rate: 4.8500 },
  { month: "2025-09", rate: 4.7500 },
  { month: "2025-10", rate: 4.5300 },
  { month: "2025-11", rate: 4.3000 },
  { month: "2025-12", rate: 4.1500 },
];

function getWibor3MPct(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const key = `${y}-${m}`;

  // bierzemy najbliższy punkt <= key (fallback działa też na daty spoza zakresu)
  for (let i = WIBOR_3M_MONTHLY.length - 1; i >= 0; i--) {
    if (WIBOR_3M_MONTHLY[i].month <= key) return WIBOR_3M_MONTHLY[i].rate;
  }
  return WIBOR_3M_MONTHLY[0]?.rate ?? 0;
}

// ===============================
// ETAP A2 — Rekonstrukcja marży (REALIA RYNKOWE)
// ===============================
function deriveMarginPctFromInstallment({
  principal,        // kwota netto
  termMonths,       // okres
  installment,      // rata z umowy
  contractDate,     // data zawarcia
  wiborType = "3M"
}) {
  const wiborPct = getWibor3MPct(contractDate); // np. 0.2
  const wiborRate = wiborPct / 100;

  // 🔒 TWARDY ZAKRES REALNYCH MARŻ (wg praktyki)
  const MIN_MARGIN = 2.5;   // dolny sensowny próg
  const MAX_MARGIN = 7.5;   // górny sensowny próg

  let low = (wiborRate + MIN_MARGIN / 100);
  let high = (wiborRate + MAX_MARGIN / 100);
  let mid = 0;

  for (let i = 0; i < 50; i++) {
    mid = (low + high) / 2;

    const payment = annuityPayment(
      principal,
      termMonths,
      mid
    );

    if (payment > installment) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const derivedMarginPct = (mid - wiborRate) * 100;

  return Number(derivedMarginPct.toFixed(2));
}

// ===============================
//   SILNIK SKD — WPS WIBOR 3M v1
// ===============================

function calculateWpsSKD({
  loan_amount_net,         // K_netto (principal)
  loan_amount_total,       // K_total (opcjonalnie)
  loan_term_months,        // n
  installments_paid,       // m
  installment_amount_real, // rata z umowy (jeśli znana)
  interest_rate_annual,    // APR_start (all-in) jeśli znane
  contract_date            // "YYYY-MM-DD" albo Date
}) {
  // --- walidacja bazowa
  if (loan_amount_net == null || loan_term_months == null) return null;

  const K = Number(loan_amount_net);
  const n = Number(loan_term_months);
  const m = (installments_paid == null || installments_paid === "") ? 0 : Number(installments_paid);

  if (!Number.isFinite(K) || !Number.isFinite(n) || !Number.isFinite(m)) return null;
  if (K <= 0 || n <= 0 || m < 0) return null;

  const startDate = contract_date ? new Date(contract_date) : new Date("2021-01-01");

  // --- A_real (rata) – tylko jeśli naprawdę chcesz ją liczyć z K_total+APR (fallback)
  let A_real = installment_amount_real != null ? Number(installment_amount_real) : null;
  if ((!A_real || !Number.isFinite(A_real)) && loan_amount_total && interest_rate_annual) {
    const total = Number(loan_amount_total);
    const apr = Number(interest_rate_annual);
    if (Number.isFinite(total) && total > 0 && Number.isFinite(apr) && apr > 0) {
      const r_m = apr / 12 / 100;
      if (r_m === 0) A_real = total / n;
      else {
        A_real = total * (r_m * Math.pow(1 + r_m, n)) / (Math.pow(1 + r_m, n) - 1);
      }
    }
  }

  // --- wyznaczenie marży: priorytety
  // 1) jeśli mamy ratę -> najlepsze (rekonstrukcja marży z raty + WIBOR start)
  // 2) jeśli mamy APR_start -> marża = APR_start - WIBOR(start)
  // 3) fallback -> sensowna domyślna
  let marginPct = null;

  if (A_real && Number.isFinite(A_real) && A_real > 0) {
    marginPct = deriveMarginPctFromInstallment({
      principal: K,
      termMonths: n,
      installment: A_real,
      contractDate: startDate,
      wiborType: "3M",
    });
  } else {
    const aprStart = (interest_rate_annual != null && Number.isFinite(Number(interest_rate_annual)))
      ? Number(interest_rate_annual)
      : null;

    if (aprStart != null) {
      marginPct = deriveMarginFromAprStart({ aprStartPct: aprStart, startDate });
    }
  }

  if (marginPct == null || !Number.isFinite(marginPct) || marginPct <= 0) {
    marginPct = 5.5; // fallback (możemy potem zrobić zależny od rocznika)
  }

  // --- policz WPS: do dziś (m) + full (n)
  const pack = calcWpsWithWibor3M({
    principal: K,
    termMonths: n,
    marginPct,
    startDate,
    limitMonths: m, // liczymy "do dziś"
  });

  // WPS "do dziś"
  const wps_basic = pack.toDate.wpsConservative;
  const wps_max = pack.toDate.wpsAggressive;

  // paid_real "do dziś" (żeby nie było undefined)
  const paid_real_sim = pack.toDate.real.totalPaid;

  // aprStartPct do meta — stabilnie, bez scope-problemów
  const aprStartPct =
    (interest_rate_annual != null && Number.isFinite(Number(interest_rate_annual)))
      ? Number(interest_rate_annual)
      : null;

  return {
    // === NOWE, CZYTELNE NAZWY ===
    wps_to_date_conservative: wps_basic,
    wps_to_date_aggressive: wps_max,

    // === KOMPATYBILNOŚĆ WSTECZNA ===
    wps_basic,
    wps_max,

    // === PŁATNOŚCI DO DZIŚ ===
    paid_real: paid_real_sim,

    // === META (DEBUG / UI) ===
    meta: {
      principal: K,
      termMonths: n,
      installmentsPaid: m,
      contractDate: startDate,
      aprStartPct,
      marginPct,
    }
  };
}
function deriveMarginFromAprStart({
  aprStartPct,   // oprocentowanie z umowy (all-in)
  startDate
}) {
  if (!aprStartPct || !startDate) return null;

  const wibor = getWibor3MPct(startDate);
  let margin = aprStartPct - wibor;

  // zabezpieczenia zdroworozsądkowe
  if (!Number.isFinite(margin)) return null;
  if (margin < 1.5) margin = 1.5;
  if (margin > 10) margin = 10;

  return Number(margin.toFixed(2));
}

function calcWpsWithWibor3M(opts) {
  const n = Number(opts.termMonths);
  let limit = Number.isFinite(opts.limitMonths) ? Number(opts.limitMonths) : n;
  limit = Math.max(0, Math.min(n, limit));

  const toDate_real = simulateVariableWiborScheduleJS({
    principal: opts.principal,
    termMonths: n,
    marginPct: opts.marginPct,
    wiborType: "3M",
    startDate: opts.startDate,
    getWiborPct: getWibor3MPct,
    limitMonths: limit,
  });

  const toDate_altMargin = simulateMarginOnlyScheduleJS({
    principal: opts.principal,
    termMonths: n,
    marginPct: opts.marginPct,
    limitMonths: limit,
  });

  const capOnlyPaidToDate = (opts.principal / n) * limit;

  const total_real = simulateVariableWiborScheduleJS({
    principal: opts.principal,
    termMonths: n,
    marginPct: opts.marginPct,
    wiborType: "3M",
    startDate: opts.startDate,
    getWiborPct: getWibor3MPct,
  });

  const total_altMargin = simulateMarginOnlyScheduleJS({
    principal: opts.principal,
    termMonths: n,
    marginPct: opts.marginPct,
  });

  const total_altCap = simulateCapitalOnlyJS({
    principal: opts.principal,
    termMonths: n,
  });

  return {
    toDate: {
      real: toDate_real,
      altMargin: toDate_altMargin,
      altCap: { totalPaid: capOnlyPaidToDate }, // spójnie “do dziś”
      wpsConservative: toDate_real.totalPaid - toDate_altMargin.totalPaid,
      wpsAggressive: toDate_real.totalPaid - capOnlyPaidToDate,
      limitMonths: limit,
    },
    total: {
      real: total_real,
      altMargin: total_altMargin,
      altCap: total_altCap,
      wpsConservative: total_real.totalPaid - total_altMargin.totalPaid,
      wpsAggressive: total_real.totalPaid - total_altCap.totalPaid,
      limitMonths: n,
    },
  };
}

// ===============================
// AUTO — ilość zapłaconych rat
// ===============================

function calculateInstallmentsPaid({
  contractDate,
  today = new Date()
}) {
  const start = new Date(contractDate);
  start.setMonth(start.getMonth() + 1); // pierwsza rata = kolejny miesiąc

  let months =
    (today.getFullYear() - start.getFullYear()) * 12 +
    (today.getMonth() - start.getMonth());

  return Math.max(0, months);
}
// ===============================
// DEBUG / DEV EXPORTS
// ===============================
if (typeof window !== "undefined") {
  window.calculateWpsSKD = calculateWpsSKD;
  window.calcWpsWithWibor3M = calcWpsWithWibor3M;
  window.getWibor3MPct = getWibor3MPct;
  window.deriveMarginPctFromInstallment = deriveMarginPctFromInstallment;
  window.deriveMarginFromAprStart = deriveMarginFromAprStart;
  window.calculateInstallmentsPaid = calculateInstallmentsPaid;
}
console.log("SKD ENGINE LOADED OK");