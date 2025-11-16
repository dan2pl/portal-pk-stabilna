// ===============================
//   SILNIK SKD — WPS BASIC v1
// ===============================

function calculateWpsBasic({
  loan_amount_net,         // K_netto
  loan_amount_total,       // K_total (opcjonalnie)
  loan_term_months,        // n
  installments_paid,       // m
  installment_amount_real, // A_real (jeśli znana)
  interest_rate_annual     // r (opcjonalnie, jeśli liczymy ratę)
}) {
  // Minimalna walidacja danych wejściowych
  if (!loan_amount_net || !loan_term_months || !installments_paid) {
    return null;
  }

  let A_real = installment_amount_real || null;

  // Jeśli nie mamy A_real – liczymy ratę z K_total + oprocentowania
  if (!A_real && loan_amount_total && interest_rate_annual) {
    const r_m = interest_rate_annual / 12 / 100; // stopa miesięczna

    if (r_m === 0) {
      A_real = loan_amount_total / loan_term_months;
    } else {
      A_real =
        loan_amount_total *
        (r_m * Math.pow(1 + r_m, loan_term_months)) /
        (Math.pow(1 + r_m, loan_term_months) - 1);
    }
  }

  // Jeśli nadal nie mamy A_real -> brak możliwości wyliczenia
  if (!A_real) {
    return null;
  }

  // Rata "darmowa"
  const A_free = loan_amount_net / loan_term_months;

  // Ile klient faktycznie zapłacił do dziś
  const paid_real = installments_paid * A_real;

  // Ile powinien zapłacić w kredycie darmowym
  const paid_free = installments_paid * A_free;

  // WPS Basic
  const wps_basic = paid_real - paid_free;

  return wps_basic > 0 ? Math.round(wps_basic) : 0;
}
