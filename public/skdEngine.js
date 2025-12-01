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
// ======================
//  SKD SCORE + WARIANTY
// ======================

// 🔧 Główna konfiguracja

const YEAR_POINTS = [
  { maxYear: 2017, points: 30 }, // 2015–2017
  { maxYear: 2019, points: 27 }, // 2018–2019
  { maxYear: 2021, points: 23 }, // 2020–2021
  { maxYear: 2022, points: 18 }, // 2022
  { maxYear: 2023, points: 10 }, // 2023
];

const AMOUNT_CONFIG = {
  MIN_GLOBAL: 15000, // poniżej – sprawa nieopłacalna dla PK (score=0)
  BANDS: [
    { min: 15000, max: 20000, points: 0 },
    { min: 20000, max: 40000, points: 4 },
    { min: 40000, max: 80000, points: 7 },
    { min: 80000, max: Infinity, points: 10 },
  ],
};

const REPAYMENT_POINTS = [
  { max: 10, points: 0 },
  { max: 25, points: 5 },
  { max: 40, points: 10 },
  { max: 60, points: 15 },
  { max: 80, points: 20 },
  { max: 100, points: 25 },
];

const BANK_POINTS = {
  "Santander Bank Polska": 8,
  "Alior": 8,
  "PKO BP": 10,
  "PKO PB": 10, // alias

  "mBank": 7,
  "Bank Millennium": 8,
  "BNP Paribas": 7,

  "Bank Pekao": 9,
  "Bank Pocztowy": 5,
  "Santander Consumer": 8,

  "Velo Bank": 6,
  "Getin Bank": 8,
  "Plus Bank": 5,
};


// 🔹 Wariant 1 – 50/50
const VARIANT_1_RULES = {
  minScore: 40,
  banks: {
    "PKO BP": { maxYear: 2022 },
    "PKO PB": { maxYear: 2022 },

    "Alior": { maxYear: 2023 },
    "Santander Bank Polska": { maxYear: 2023 },
    "mBank": { maxYear: 2023 },
    "Bank Millennium": { maxYear: 2023 },
    "Bank Pekao": { maxYear: 2023 },
    "Bank Pocztowy": { maxYear: 2023 },
    "BNP Paribas": { maxYear: 2023 },
    "Getin Bank": { maxYear: 2023 },
    "Santander Consumer": { maxYear: 2023 },
    "Velo Bank": { maxYear: 2023 },
    "Plus Bank": { maxYear: 2023 },
    // Nest – świadomie poza listą
  },
};

// 🔹 Wariant 3 – full power
const VARIANT_3_RULES = {
  minScore: 76,
  allowedBanks: [
    "Santander Bank Polska",
    "Alior",
    "PKO BP",
    "PKO PB",
    "mBank",
    "Bank Millennium",
    "Bank Pekao",
    "BNP Paribas",
  ],
  maxYear: 2023,
};

// 🔹 Wariant 2 – ryzyko po stronie klienta
const VARIANT_2_RULES = {
  MIN_LOAN: 25000,
  MIN_WPS: 10000,
  MIN_RELIEF: 10000,
};

// ====== POMOCNICZE ======

function getYearPoints(year) {
  if (!year) return 0;
  const row = YEAR_POINTS.find((r) => year <= r.maxYear);
  return row ? row.points : 0;
}

function getAmountPoints(amount) {
  if (!amount || amount < AMOUNT_CONFIG.MIN_GLOBAL) return 0;
  const band = AMOUNT_CONFIG.BANDS.find(
    (b) => amount >= b.min && amount < b.max
  );
  return band ? band.points : 0;
}

function getRepaymentPoints(progressPercent) {
  if (progressPercent == null) return 0;
  const row = REPAYMENT_POINTS.find((r) => progressPercent <= r.max);
  return row ? row.points : REPAYMENT_POINTS[REPAYMENT_POINTS.length - 1].points;
}

function getBankPoints(bank) {
  if (!bank) return 0;
  return BANK_POINTS[bank] ?? 0;
}

function getRiskPenalty(flags = {}) {
  const RISK_PENALTIES = {
    low: 0,   // niskie ryzyko – brak kary
    mid: 10,  // średnie ryzyko – lekka kara
    high: 25, // wysokie ryzyko – mocniejsza kara
  };
  let total = 0;
  for (const [key, penalty] of Object.entries(RISK_PENALTIES)) {
    if (flags[key]) total += penalty;
  }
  return total;
}

// ====== GŁÓWNA FUNKCJA SCORE ======

function calculateSkdScore(caseData) {
  const {
    contractYear,
    loanAmount,
    repaymentProgress,
    bank,
    riskFlags,
  } = caseData;

  let score = 0;

  // używamy bezpiecznej kwoty (jak brak → 0), ale NIE blokujemy od razu całego score
  const safeLoanAmount = loanAmount || 0;

  score += getYearPoints(contractYear);
  score += getAmountPoints(safeLoanAmount);
  score += getRepaymentPoints(repaymentProgress);
  score += getBankPoints(bank);
  score += getRiskPenalty(riskFlags);

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return score;
}

// ====== WARIANT 1 ======

function isVariant1(caseData, score) {
  const bank = caseData.bank;
  const year = caseData.contractYear;

  if (score < VARIANT_1_RULES.minScore) return false;

  const bankCfg = VARIANT_1_RULES.banks[bank];
  if (!bankCfg) return false;

  if (year > bankCfg.maxYear) return false;

  return true;
}

// ====== WARIANT 3 ======

function isVariant3(caseData, score) {
  const bank = caseData.bank;
  const year = caseData.contractYear;

  if (score < VARIANT_3_RULES.minScore) return false;
  if (!VARIANT_3_RULES.allowedBanks.includes(bank)) return false;
  if (year > VARIANT_3_RULES.maxYear) return false;

  return true;
}

// ====== WARIANT 2 ======

function canOfferVariant2(caseData, score) {
  const { loanAmount, wps, futureInterestRelief } = caseData;

  if (!loanAmount || loanAmount < VARIANT_2_RULES.MIN_LOAN) return false;

  const wpsOK = wps && wps > VARIANT_2_RULES.MIN_WPS;
  const reliefOK =
    futureInterestRelief && futureInterestRelief > VARIANT_2_RULES.MIN_RELIEF;

  if (!wpsOK && !reliefOK) return false;

  // tu celowo NIE blokujemy niskim score
  return true;
}

// ====== GŁÓWNA FUNKCJA: WYBÓR WARIANTU ======

function determineSkdVariant(caseData) {
  // 1️⃣ jeżeli mamy już policzony score w caseData, użyj go,
  //    a jak nie ma – policz standardowo
  let score =
    typeof caseData.score === "number"
      ? caseData.score
      : calculateSkdScore(caseData);

  console.log("[SKD determine] input:", caseData, "score:", score);

  // 2️⃣ bardzo słaba sprawa / poniżej progów ekonomicznych
  if (!score || score <= 0) {
    return {
      score: 0,
      variant: 0,
      reason:
        "Kwota poniżej progu opłacalności lub bardzo słaba sprawa",
    };
  }

  // 3️⃣ wariant 3 – najmocniejszy
  if (isVariant3(caseData, score)) {
    return {
      score,
      variant: 3,
      reason: "Mocna sprawa – spełnia kryteria wariantu 3",
    };
  }

  // 4️⃣ wariant 1 – klasyczny 50/50
  if (isVariant1(caseData, score)) {
    return {
      score,
      variant: 1,
      reason: "Stabilna sprawa – spełnia kryteria wariantu 1 (50/50)",
    };
  }

  // 5️⃣ wariant 2 – ryzyko po stronie klienta
  if (canOfferVariant2(caseData, score)) {
    return {
      score,
      variant: 2,
      reason:
        "Sprawa bardziej ryzykowna, ale ekonomicznie sensowna – proponujemy wariant 2",
    };
  }

  // 6️⃣ nic nie przeszło
  return {
    score,
    variant: 0,
    reason: "Sprawa nie spełnia kryteriów żadnego wariantu SKD",
  };
}

// ==========================
// EXPORTY GLOBALNE
// ==========================
window.calculateSkdScore = calculateSkdScore;
window.determineSkdVariant = determineSkdVariant;