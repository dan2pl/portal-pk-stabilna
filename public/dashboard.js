// === Global diagnostics ===
window.addEventListener("error", (e) => {
  console.error(
    "GLOBAL JS ERROR →",
    e.message,
    "at",
    e.filename + ":" + e.lineno
  );
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("UNHANDLED PROMISE →", e.reason);
});
console.log("dashboard.js loaded");

// === API BASE (produkcyjnie puste = relative) ===
const API_BASE = "";
// === User Role Context ===
const USER_ROLE = document.body.dataset.role || 'agent';
const IS_ADMIN = USER_ROLE === 'admin';
console.log('Zalogowany jako:', USER_ROLE);

// === GLOBALNE ETYKIETY STATUSÓW (jedyna prawda) ===
const CASE_STATUS_LABELS = {
  NEW: "Nowa",
  ANALYSIS: "W analizie",
  ANALYSIS_DOCS_NEEDED: "Braki dokumentów do analizy",
  ANALYSIS_POSITIVE: "Analiza pozytywna",
  ANALYSIS_NEGATIVE: "Analiza negatywna",
  CONTRACT_PREP: "Przygotowanie umowy",
  CONTRACT_DOCS_NEEDED: "Oczekiwanie na dokumenty",
  CONTRACT_AT_AGENT: "Umowa u agenta",
  CONTRACT_SIGNED: "Umowa zawarta",
  IN_PROGRESS: "W toku",
  CLOSED_SUCCESS: "Zakończona – Sukces",
  CLOSED_FAIL: "Zakończona – Przegrana",
  CLIENT_RESIGNED: "Rezygnacja klienta",
};
function getToken() {
  // spróbuj kilku popularnych miejsc
  return (
    window.PK_TOKEN ||
    localStorage.getItem('pk_token') ||
    localStorage.getItem('token') ||
    sessionStorage.getItem('pk_token') ||
    sessionStorage.getItem('token') ||
    null
  );
}
function authHeaders(base = {}) {
  const t = getToken();
  return t ? { ...base, Authorization: `Bearer ${t}` } : base;
}
// --- safeguard: jeśli ktoś wywoła setActiveKpi, a nie ma definicji — nie wywalaj całego skryptu
window.setActiveKpi = window.setActiveKpi || function (key) {
  console.warn('[noop] setActiveKpi', key);
};

// === FLAGS + logger ===
const FLAGS = {
  SAFE_BOOT: false,     // gdy true → nie robi zewnętrznych fetchy w bootstrapie
  VERBOSE_LOGS: true,   // rozbudowane logi
  STRICT_ERRORS: true   // przerwij boot przy krytycznym błędzie
};
const log = (...a) => FLAGS.VERBOSE_LOGS && console.log('[PK]', ...a);
const warn = (...a) => console.warn('[PK:WARN]', ...a);
const err = (...a) => console.error('[PK:ERR]', ...a);

// === Telemetry kroków ===
async function step(name, fn) {
  log('→ step', name);
  showDiag(`⏳ ${name}…`);
  const t0 = performance.now();
  try {
    const out = await fn();
    const dt = (performance.now() - t0).toFixed(0);
    showDiag(`✅ ${name} (${dt} ms)`);
    return out;
  } catch (e) {
    err(`step "${name}" failed:`, e);
    showDiag(`❌ ${name}: ${e?.message || e}`);
    if (FLAGS.STRICT_ERRORS) throw e;
  }
}

// === blok [A] Search helpery i filtr ===

// Debounce, aby nie renderować na każdą literę zbyt często
function debounce(fn, delay = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), delay);
  };
}

// Usuwanie polskich znaków (żeby "Zółć" == "Zolc")
function normalize(str = "") {
  return str
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Próbujemy wyciągnąć nazwisko klienta z obiektu sprawy
function extractLastName(caseRow) {
  // Obsłuż kilka możliwych nazw pól w Twoich danych
  const candidates = [
    caseRow?.client_last_name,
    caseRow?.klient_nazwisko,
    caseRow?.nazwisko,
  ];
  // jeśli mamy pełne imię i nazwisko w jednym polu:
  const fullCandidates = [
    caseRow?.client_name,
    caseRow?.klient,
    caseRow?.klient_imie_nazwisko,
    caseRow?.imie_nazwisko,
    caseRow?.name,
  ];

  for (const c of candidates) {
    if (c) return c;
  }
  for (const f of fullCandidates) {
    if (f) {
      const parts = f.trim().split(/\s+/);
      return parts.length ? parts[parts.length - 1] : f;
    }
  }
  return "";
}
async function loadCurrentUser() {
  try {
    const res = await fetch(`/api/me`, {
      method: "GET",
      credentials: "include",
    });

    // ⛔️ Niezalogowany → login
    if (res.status === 401) {
      console.warn("❌ /api/me zwrócił 401 — przekierowanie na login");
      window.location.href = "login.html";
      return null;
    }

    if (!res.ok) {
      console.error("Błąd /api/me:", res.status);
      return null;
    }

    const data = await res.json();
    if (!data || !data.ok || !data.user) {
      console.warn("⚠️ Brak data.user — NIE wylogowujemy");
      return null;
    }

    console.log("🔐 Użytkownik zalogowany:", data.user);

    // ==========================================
    //  WSTAWIENIE DANYCH USERA DO TOPBARA
    // ==========================================
    const userEl = document.getElementById("currentUserLabel");

    if (userEl) {
      const roleLabel =
        data.user.role === "admin"
          ? "Administrator"
          : data.user.role === "agent"
            ? "Agent"
            : data.user.role;

      userEl.textContent = `${data.user.name} (${roleLabel})`;

      // ==========================================
      //   Jeśli ADMIN → klik przenosi do admin.html
      // ==========================================
      if (data.user.role === "admin") {
        userEl.style.cursor = "pointer";
        userEl.title = "Przejdź do panelu administratora";

        userEl.addEventListener("click", () => {
          window.location.href = "admin.html";
        });
      }
    }

    return data.user;
  } catch (err) {
    console.error("❌ Wyjątek w loadCurrentUser():", err);
    return null;
  }
}

// Szuka w każdym polu tekstowym rekordu (bez polskich znaków)
function filterCasesByLastName(query, sourceArray) {
  const q = normalize(query.trim());
  if (!q) return [...sourceArray];

  function haystack(row) {
    const parts = [];
    (function walk(v) {
      if (v == null) return;
      if (typeof v === 'string') { parts.push(normalize(v)); return; }
      if (typeof v === 'number') { parts.push(String(v)); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') { for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k]); }
    })(row);
    return parts.join(' ');
  }

  return sourceArray.filter(r => haystack(r).includes(q));
}


// Spróbujemy podeprzeć się istniejącymi funkcjami:
//  - renderCases(list)  — jeśli masz taką do rysowania listy
//  - openCaseModal(id) — do otwierania modala szczegółów
// Jeśli nazwy są inne, podmień w bloku B na Twoje.

// Helpers (auth + fetch)

async function fetchJSON(url, opts = {}) {
  const isFormData = opts.body instanceof FormData;

  const baseHeaders = isFormData
    ? {}
    : { 'Content-Type': 'application/json' };

  const res = await fetch(url, {
    ...opts,
    headers: authHeaders({
      ...baseHeaders,
      ...(opts.headers || {}),
    }),
    credentials: 'include',  // ważne gdy używasz ciasteczek
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || res.statusText);
  }

  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}


// === Minimalny renderer listy spraw ===
// Szuka <tbody id="casesTbody">; jeśli go nie ma, tworzy fallback <div id="casesList">
function ensureCasesContainer() {
  let tbody = document.getElementById('casesTbody');
  if (tbody) return { mode: 'table', el: tbody };

  // fallback: prosty <div> z kartami
  let list = document.getElementById('casesList');
  if (!list) {
    list = document.createElement('div');
    list.id = 'casesList';
    list.style.marginTop = '8px';
    const anchor = document.getElementById('casesTable') || document.body;
    anchor.parentNode.insertBefore(list, anchor.nextSibling);
  }
  return { mode: 'cards', el: list };
}

function pickId(row) {
  return row?.id ?? row?.case_id ?? row?.sprawa_id ?? null;
}
function pickClient(row) {
  // próbujemy różne pola
  return (
    row?.client_name ||
    row?.klient ||
    row?.klient_imie_nazwisko ||
    row?.imie_nazwisko ||
    [row?.client_first_name, row?.client_last_name].filter(Boolean).join(' ') ||
    row?.name ||
    '—'
  );
}
function pickBank(row) {
  const label = row?.bank_name || row?.bank?.name || row?.bank_label || row?.bank || null;
  return label || '—';
}
function pickAmount(row) {
  const n = row?.wps ?? row?.amount ?? row?.kwota ?? null;
  if (n == null || n === '') return '—';
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' }) : String(n);
}
function pickStatus(row) {
  return row?.status || row?.state || row?.stan || '—';
}


// === Ładowanie pełnej listy spraw + Blok C ===
async function loadAndRenderAllCases() {
  console.log("[PK] loadAndRenderAllCases() – START");
  try {
    const data = await fetchJSON('/api/cases'); // <- pobranie wszystkich spraw

    // [C] Zachowaj pełną listę spraw do cache wyszukiwarki
    const list = Array.isArray(data) ? data : (data.rows || data.items || data.list || data.cases || data.data || data.results || []);
    window.casesCache = list;
    console.log('[PK] fetched list length:', Array.isArray(list) ? list.length : 'not array', 'keys:', data && typeof data === 'object' ? Object.keys(data) : typeof data);

  } catch (err) {
    console.error('Nie udało się pobrać listy spraw:', err);
    alert('Nie udało się pobrać listy spraw.');
  }
}

// Banki (źródło prawdy)
const BANKS = [
  "Alior Bank",
  "Bank Millennium",
  "Bank Pekao",
  "Bank Pocztowy",
  "BNP Paribas",
  "BOŚ Bank",
  "Citi Handlowy",
  "Credit Agricole",
  "Getin Bank",
  "ING Bank Śląski",
  "mBank",
  "PKO BP",
  "Santander Bank Polska",
  "Santander Consumer",
  "SKOK",
  "Smartney",
  "Velo Bank",
  "Bank Spółdzielczy",
];
function fillBankSelect(sel, current) {
  if (!sel) return;
  sel.innerHTML =
    '<option value="">— wybierz —</option>' +
    BANKS.map((b) => `<option value="${b}">${b}</option>`).join("");
  if (current) {
    if (![...sel.options].some((o) => o.value === current)) {
      const opt = document.createElement("option");
      opt.value = current;
      opt.textContent = current;
      sel.appendChild(opt);
    }
    sel.value = current;
  }
}
// === OFFERS ENGINE (3B) ===
function getOffers(ctx) {
  const { bank, status, wps = 0, loan_amount = 0 } = ctx;
  const out = [];
  if (status === 'w toku' || status === 'analiza') {
    out.push({ name: 'Zwrot prowizji', meta: 'Wypłata w 7–14 dni', cta: 'Zleć analizę' });
  }
  if (wps >= 5000) {
    out.push({ name: 'SKD — Sankcja Kredytu Darmowego', meta: `Szac. WPS: ${Number(wps).toLocaleString('pl-PL')} PLN`, cta: 'Sprawdź kwalifikację' });
  }
  if (loan_amount >= 20000) {
    out.push({ name: 'Ugoda refinansująca', meta: `Kwota kredytu: ${Number(loan_amount).toLocaleString('pl-PL')} PLN`, cta: 'Zapytaj o warunki' });
  }
  if (/mBank|Santander|PKO|ING|Millennium|Pekao/i.test(bank || '')) {
    out.push({ name: `Oferta dedykowana — ${bank}`, meta: 'Specjalne warunki partnera', cta: 'Kontakt z opiekunem' });
  }
  if (!out.length) out.push({ name: 'Brak gotowych dopasowań', meta: 'Doprecyzuj dane klienta', cta: 'Otwórz pełny widok' });
  return out;
}
function renderOffers(ctx) {
  const box = document.getElementById('cmOffers');
  if (!box) return;
  const items = getOffers(ctx);
  box.innerHTML = items.map(o => `
    <div class="offer">
      <h4>${o.name}</h4>
      <div class="meta">${o.meta}</div>
      <div class="cta">
        <button class="btn btn-primary">${o.cta}</button>
        <button class="btn">Szczegóły</button>
      </div>
    </div>
  `).join('');
}

// ===== BOOT MODULES — START =====
async function initAuth() {
  // 🔄 Stara logika z pk_token jest już nieaktualna.
  // Teraz opieramy się wyłącznie na /api/me + httpOnly cookie.
  // Funkcja zostaje jako hook, ale niczego nie blokuje.
  return true;
}

async function initBanks() {
  fillBankSelect(document.getElementById('addBank'), '');
  fillBankSelect(document.getElementById('cmBank'), '');
}

async function initTableAndKpi() {
  if (FLAGS.SAFE_BOOT && Array.isArray(window.__PK_ITEMS_ALL__) && window.__PK_ITEMS_ALL__.length) {
    const itemsAll = window.__PK_ITEMS_ALL__;
    renderKpis(computeKpis(itemsAll));
    computeAndRenderWpsKpis(itemsAll);

    const tBody = document.getElementById('caseTableBody');
    if (tBody) {
      tBody.innerHTML = itemsAll.map(c => {
        const clientStr = c.client ?? '—';
        const bankStr = c.bank ? String(c.bank) : '—';
        const amountStr =
          (c.loan_amount ?? c.amount ?? null) != null
            ? fmtPL(c.loan_amount ?? c.amount)
            : '—';
        const wpsStr =
          (c.wps ?? '') !== ''
            ? fmtPL(c.wps)
            : '—';

        // 🔹 Nowe: status jako kod → ładna etykieta
        const rawCode =
          c.status_code ??
          c.status ??
          c.stage ??
          c.caseStage ??
          null;

        const statusStr = rawCode
          ? (CASE_STATUS_LABELS[String(rawCode).toUpperCase()] || String(rawCode))
          : "—";

        return `
<tr data-id="${c.id ?? ''}">
  <td>${clientStr}</td>
  <td>${bankStr}</td>
  <td>${amountStr}</td>
  <td>${wpsStr}</td>
  <td>${statusStr}</td>
</tr>`;
      }).join('');
    }
    return;
  }

  await loadCases('');
  try {
    const all = window.__PK_ITEMS_ALL__ || [];
    renderKpis(computeKpis(all));
    computeAndRenderWpsKpis(all);
  } catch (e) {
    console.warn('[PK:WARN] post-load KPI recompute failed', e);
  }
}

function bindFilters() {
  // select + przycisk Odśwież
  const sel = document.getElementById('flt_status');
  const btn = document.getElementById('flt_refresh');

  if (btn && sel) {
    btn.addEventListener('click', async () => {
      setActiveKpi(sel.value || '');
      await loadCases(sel.value || '');
    });
  }

  /*// klikalne KPI (zakładam że masz już setActiveKpi/applyStatusFilter)
  document.querySelectorAll('#kpiBar .kpi-card').forEach(card => {
    card.addEventListener('click', () => {
      const code = card.dataset.status || '';
      applyStatusFilter(code);
    });
  });*/

  setActiveKpi('');
}

function bindModalAndLogout() {
  const cmCloseEl = document.getElementById("cmClose");
  const cmModal = document.getElementById("caseModal");

  if (cmCloseEl && cmModal) {
    cmCloseEl.addEventListener("click", () => {
      cmModal.style.display = "none";
    });

    cmModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) {
        cmModal.style.display = "none";
      }
    });
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        // czyścimy sesję po stronie backendu
        await fetch("/api/logout", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("Błąd podczas logoutu:", err);
        // tu nie blokujemy – i tak przekierujemy niżej
      } finally {
        // na wszelki wypadek czyścimy ewentualne lokalne śmieci
        try {
          localStorage.removeItem("token");
        } catch (_) { }

        window.location.href = "/login.html";
      }
    });
  }
}
// ===== BOOT MODULES — END =====
// === DODAWANIE NOWEJ SPRAWY ===
function initAddCaseForm() {
  const saveBtn = document.getElementById("btnSaveCase");
  if (!saveBtn) {
    console.warn("[ADD CASE] btnSaveCase not found – pomijam init");
    return;
  }

  saveBtn.addEventListener("click", async () => {
    try {
      console.log("[ADD CASE] klik Zapisz");

      // ⬇️ TU PODMIANA NA PRAWDZIWE ID Z HTML
      const clientInput = document.getElementById("addClient");
      const amountInput = document.getElementById("addAmount");
      const bankInput = document.getElementById("addBank");

      // jeśli na razie nie masz tych pól w formularzu, mogą zostać jako null
      const phoneInput = document.getElementById("newCasePhone");
      const emailInput = document.getElementById("newCaseEmail");
      const addrInput = document.getElementById("newCaseAddress");

      const client = clientInput?.value.trim() || "";
      const loan_amount_raw =
        amountInput?.value.replace(/\s/g, "").replace(",", ".") || "";
      const bank = bankInput?.value.trim() || "";
      const phone = phoneInput?.value.trim() || "";
      const email = emailInput?.value.trim() || "";
      const address = addrInput?.value.trim() || "";

      if (!client) {
        alert("Podaj imię i nazwisko klienta");
        clientInput?.focus();
        return;
      }

      const loan_amount = loan_amount_raw ? Number(loan_amount_raw) : 0;
      if (!loan_amount || Number.isNaN(loan_amount) || loan_amount <= 0) {
        alert("Podaj poprawną kwotę kredytu");
        amountInput?.focus();
        return;
      }

      const payload = {
        client,
        loan_amount,
        bank: bank || null,

      };

      console.log("[ADD CASE] payload:", payload);

      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      console.log("[ADD CASE] response:", res.status, data);

      if (!res.ok || !data || data.error) {
        alert("Nie udało się zapisać sprawy: " + (data.error || res.status));
        return;
      }

      // sukces → zamknij modal (jeśli jest) + odśwież tabelę
      try {
        const modal = document.getElementById("addCaseModal");
        if (modal) {
          modal.style.display = "none";
        }
      } catch (e) {
        console.warn("[ADD CASE] close modal fail:", e);
      }

      if (typeof loadCases === "function") {
        await loadCases("");
      } else {
        window.location.reload();
      }
    } catch (err) {
      console.error("[ADD CASE] Błąd przy zapisie sprawy:", err);
      alert("Wystąpił błąd przy zapisie sprawy (console)");
    }
  });
}
// Status → normalizacja
function normStatus(s) {
  const x = String(s || "")
    .trim()
    .toLowerCase();
  if (["w toku", "in_progress", "open", "otwarta"].includes(x))
    return "in_progress";
  if (
    [
      "sukces",
      "wygrana",
      "zakończona",
      "closed",
      "done",
      "finished",
      "success",
      "analiza pozytywna",
      "analiza",
    ].includes(x)
  )
    return "success";
  if (
    [
      "przegrana",
      "odrzucona",
      "lost",
      "rejected",
      "zamknięta bez sukcesu",
    ].includes(x)
  )
    return "lost";
  if (["nowa", "nowy", "new"].includes(x)) return "new";
  return "other";
}

function computeKpis(items) {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;
  let open = 0,
    success = 0,
    lost = 0,
    newly = 0;
  for (const c of list) {
    const st = normStatus(c.status || c.case_status);
    if (st === "in_progress") open++;
    else if (st === "success") success++;
    else if (st === "lost") lost++;
    else if (st === "new") newly++;
  }
  return { total, open, success, lost, newly };
}

function renderKpis(k) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(val);
    el.classList.remove('kpiValue-updated');
    // trigger reflow, żeby animacja ruszyła za każdym razem
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add('kpiValue-updated');
  };

  set("kpiAll", k.total);
  set("kpiNew", k.newly);
  set("kpiPositive", k.success);
  set("kpiInProgress", k.open);
  set("kpiRejected", k.lost);
}
function computeWpsAgg(items) {
  const list = Array.isArray(items) ? items : [];
  const wpsSum = sumNum(list, (x) => x.wps);
  const loanSum = sumNum(list, (x) => x.loan_amount ?? x.amount);
  const wpsCnt = list.reduce((n, x) => n + (x.wps !== null && x.wps !== undefined && x.wps !== "" ? 1 : 0), 0);
  const wpsAvg = wpsCnt ? wpsSum / wpsCnt : 0;
  return { wpsSum, loanSum, wpsAvg };
}

function renderWpsKpis(a) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = String(val);
    el.classList.remove('kpiValue-updated');
    // trigger reflow, żeby animacja ruszyła za każdym razem
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add('kpiValue-updated');
  };

  set("kpiWpsTotal", a.wpsSum);
  set("kpiLoanTotal", a.loanSum);
  set("kpiWpsAvg", a.wpsAvg);
}
// —— WPS KPI (wszystkie / w toku) — agregaty + render ——

// bezpieczny parse (spacje, przecinki)
const parseNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// sumy pomocnicze
const sumBy = (arr, pick) =>
  (Array.isArray(arr) ? arr : []).reduce((acc, x) => {
    const n = parseNum(pick(x));
    return n === null ? acc : acc + n;
  }, 0);

// żeby pisać do pierwszego istniejącego elementu (obsługa różnych ID)
const setFirst = (ids, val) => {
  const text = Number(val ?? 0).toLocaleString('pl-PL');
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; return true; }
  }
  console.warn('WPS KPI element not found for ids:', ids);
  return false;
};

// główna funkcja: policz i wyrenderuj
function computeAndRenderWpsKpis(itemsAll) {
  const list = Array.isArray(itemsAll) ? itemsAll : [];

  // 1) suma WPS (wszystkie)
  const sumAll = sumBy(list, x => x.wps);

  // filtr „w toku”
  const inProg = list.filter(c => normStatus(c.status || c.case_status) === 'in_progress');

  // 2) suma WPS (w toku)
  const sumInProg = sumBy(inProg, x => x.wps);

  // 3) średni WPS (w toku)
  const cntInProg = inProg.reduce((n, c) => n + (parseNum(c.wps) !== null ? 1 : 0), 0);
  const avgInProg = cntInProg ? (sumInProg / cntInProg) : 0;

  // render (Twoje ID + fallbacki)
  setFirst(['kpiWpsAll', 'kpiWpsTotal', 'kpiWpsTotalAll'], sumAll);
  setFirst(['kpiWpsInProgress', 'kpiWpsTotalInProgress'], sumInProg);
  setFirst(['kpiWpsAvgInProgress', 'kpiWpsAvg'], avgInProg);

  console.log('📊 WPS KPI:', { sumAll, sumInProg, avgInProg, cntInProg });
}

// Formatery
const fmtPL = (n) => Number(n ?? 0).toLocaleString("pl-PL");
const fmtDate = (raw) => {
  const norm = raw ? (String(raw).includes("T") ? raw : String(raw).replace(" ", "T")) : "";
  const d = norm ? new Date(norm) : null;
  return d && !isNaN(d) ? d.toLocaleDateString("pl-PL") : "—";
};

// Bezpieczna suma liczb (obsługa spacji i przecinków)
const sumNum = (arr, pick) =>
  arr.reduce((acc, x) => {
    const raw = pick(x);
    if (raw === null || raw === undefined || raw === "") return acc;
    const num = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(num) ? acc + num : acc;
  }, 0);

// Główny loader tabeli + KPI
async function loadCases(filterStatus = '') {
  console.log('loadCases() start');
  const tBody = document.getElementById('caseTableBody');
  if (!tBody) { console.warn('Brak #caseTableBody'); return; }

  tBody.innerHTML = '<tr><td colspan="5">Ładowanie…</td></tr>';

  let data;
  try {
    data = await fetchJSON('/api/cases');
  } catch (e) {
    tBody.innerHTML = `<tr><td colspan="5">Błąd /api/cases: ${e.message}</td></tr>`;
    return;
  }

  // Obsłuż {items:[...]} / {cases:[...]} / [...]
  const itemsAll =
    Array.isArray(data?.items) ? data.items :
      Array.isArray(data?.cases) ? data.cases :
        Array.isArray(data) ? data : [];

  window.__PK_ITEMS_ALL__ = itemsAll; // przyda się do ponownego przeliczenia KPI
  window.casesCache = itemsAll;
  console.log('📦 itemsAll count =', itemsAll.length);

  const targetStatus = String(filterStatus || '').toLowerCase();
  const items = targetStatus
    ? itemsAll.filter(c => normStatus(c.status || c.case_status) === targetStatus)
    : itemsAll;

  // KPI zawsze z pełnego źródła
  try {
    const k = computeKpis(itemsAll);
    renderKpis(k);
    console.log('📊 KPI:', k);
    computeAndRenderWpsKpis(itemsAll);

  } catch (e) {
    console.error('KPI error:', e);
  }

  if (!items.length) {
    tBody.innerHTML = '<tr><td colspan="5">Brak spraw w bazie</td></tr>';
    return;
  }

  // Render wierszy – z twardą ochroną na błędy
  try {
    const rowsHtml = items.map(c => {
      const clientStr = c.client ?? '—';
      const bankStr = c.bank ? String(c.bank) : '—';
      const amountStr = (c.loan_amount ?? c.amount ?? null) != null ? fmtPL(c.loan_amount ?? c.amount) : '—';
      const wpsStr = (c.wps ?? '') !== '' ? fmtPL(c.wps) : '—';
      const caseNoStr = c.case_number ? String(c.case_number) : '';

      // 🔍 zbierz wszystkie pola, których NAZWA zawiera phone/tel/email
      const contactBlob = Object.entries(c || {})
        .filter(([key]) => /phone|tel|email/i.test(key))
        .map(([, val]) => (val == null ? '' : String(val)))
        .join(' ');

      // 🔹 Status jako kod → ładna etykieta z CASE_STATUS_LABELS
      const rawCode =
        c.status_code ??
        c.status ??
        c.stage ??
        c.caseStage ??
        null;

      const statusStr = rawCode
        ? (CASE_STATUS_LABELS[String(rawCode).toUpperCase()] || String(rawCode))
        : "—";
      // prosty escape cudzysłowów, żeby nie rozwalić HTML-a
      const esc = (s) => String(s).replace(/"/g, '&quot;');

      // lokalna normalizacja – to samo co w szukajce (małe litery + bez „dziwnych” znaków)
      const norm = (s) =>
        (s || "")
          .toString()
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^\w\s.-]+/g, "");

      // 🔍 pełny „blob” do wyszukiwania:
      // klient, bank, kwoty, status, KONTAKT (tel/mail), nr sprawy
      const searchBlob = norm([
        clientStr,
        bankStr,
        amountStr,
        wpsStr,
        statusStr,
        contactBlob,
        caseNoStr
      ].join(" "));

      return `
<tr data-id="${c.id ?? ''}" data-search="${esc(searchBlob)}">
  <td>${clientStr}</td>
  <td>${bankStr}</td>
  <td>${amountStr}</td>
  <td>${wpsStr}</td>
  <td>${statusStr}</td>
</tr>`;
    }).join('');

    tBody.innerHTML = rowsHtml;
  } catch (e) {
    console.error('Row render fail:', e);
    tBody.innerHTML = `<tr><td colspan="5">Błąd renderowania tabeli: ${e.message}</td></tr>`;
  }



  console.log('loadCases() done');
}

// === Klikalne KPI → filtr statusu ===
function applyStatusFilter(statusCode) {
  const sel = document.getElementById('flt_status');
  if (sel) sel.value = statusCode || '';

  setActiveKpi(statusCode);
  return loadCases(statusCode || '');
}

document.querySelectorAll('#kpiBar .kpi-card').forEach(card => {
  card.addEventListener('click', () => {
    const code = card.dataset.status || '';
    applyStatusFilter(code);
  });
});


// „drugie uderzenie” w KPI — gdyby DOM jeszcze się układał
try {
  const all = window.__PK_ITEMS_ALL__ || [];
  renderKpis(computeKpis(all));
  log('📊 KPI re-render after load:', computeKpis(all));
} catch (e) {
  console.error('KPI re-render error:', e);
}

// ➕ dodatkowe „uderzenie” w KPI WPS
try {
  const all = window.__PK_ITEMS_ALL__ || [];
  computeAndRenderWpsKpis(all);
} catch (e) {
  console.error('WPS KPI re-render error:', e);
}

// === Dodawanie nowej sprawy + upload plików ===
let pendingFiles = []; // nasza własna lista plików

const addBtn = document.getElementById("addCaseBtn");
const addClientEl = document.getElementById("addClient");
const addAmountEl = document.getElementById("addAmount");
const addBankEl = document.getElementById("addBank");
const addFilesEl = document.getElementById("addFiles"); // input file
const fileListPreview = document.getElementById("fileListPreview"); // podgląd
const dropArea = document.getElementById("fileDropArea");

// --- helper: aktualizuje faktyczne <input type="file"> na podstawie pendingFiles ---
function syncFilesToInput() {
  if (!addFilesEl) return;
  const dt = new DataTransfer();
  pendingFiles.forEach((f) => dt.items.add(f));
  addFilesEl.files = dt.files;
}

// --- helper: rysuje listę plików + X do usunięcia ---
function renderFilePreview() {
  if (!fileListPreview) return;
  fileListPreview.innerHTML = "";

  pendingFiles.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "case-file-item case-row";


    row.innerHTML = `
      <div class="file-item-name">
        📄 ${file.name} (${Math.round(file.size / 1024)} KB)
      </div>
      <div class="file-item-remove" data-index="${index}">
        ✕
      </div>
    `;

    fileListPreview.appendChild(row);
  });

  // Obsługa przycisku X (usuń pojedynczy plik)
  fileListPreview.querySelectorAll(".file-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-index"));
      if (Number.isFinite(idx)) {
        pendingFiles.splice(idx, 1); // usuń z tablicy
        syncFilesToInput();          // zaktualizuj input
        renderFilePreview();         // odśwież listę
      }
    });
  });
}

// --- Drag & Drop + klik ---
if (dropArea && addFilesEl) {
  // Klik = otwieranie okna wyboru plików
  dropArea.addEventListener("click", (e) => {
    // Jeśli kliknięto link (np. iLovePDF) – nie otwieramy file pickera
    if (e.target.closest("a")) {
      return;
    }

    // Normalny klik w box → otwórz okno wyboru pliku
    addFilesEl.click();
  });

  // Drag & Drop
  dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("dragover");
  });

  dropArea.addEventListener("dragleave", () => {
    dropArea.classList.remove("dragover");
  });

  dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.classList.remove("dragover");

    const dropped = Array.from(e.dataTransfer?.files || []);
    if (!dropped.length) return;

    pendingFiles.push(...dropped);
    syncFilesToInput();
    renderFilePreview();
  });

  // Wybranie plików przez okno wyboru
  addFilesEl.addEventListener("change", () => {
    const selected = Array.from(addFilesEl.files || []);
    if (!selected.length) return;

    pendingFiles.push(...selected);
    syncFilesToInput();
    renderFilePreview();
  });
}


// --- handler przycisku dodania sprawy (dopisz/zmień u siebie tylko środek) ---
addBtn?.addEventListener("click", async (e) => {
  e.preventDefault();

  const client = addClientEl?.value?.trim() || "";
  const amountRaw = (addAmountEl?.value || "").replace(",", ".");
  const loanAmount = parseFloat(amountRaw);
  const bank = addBankEl?.value || null;

  if (!client) return alert("Podaj klienta");
  if (Number.isNaN(loanAmount)) return alert("Podaj poprawną kwotę");

  try {
    // 1️⃣ — UTWORZENIE SPRAWY
    const createRes = await apiFetch("/cases", {
      method: "POST",
      body: JSON.stringify({
        client,
        loan_amount: loanAmount,
        bank,
      }),
    });


    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      throw new Error("Błąd tworzenia sprawy: " + text);
    }

    const createdCase = await createRes.json();
    const caseId = createdCase.id;
    console.log("🔹 Utworzono sprawę:", createdCase);

    // 2️⃣ — UPLOAD PLIKÓW (jeśli są)
    if (pendingFiles.length > 0) {
      const formData = new FormData();
      pendingFiles.forEach((file) => formData.append("files", file));

      const uploadRes = await apiFetch(`/cases/${caseId}/files`, {
        method: "POST",
        body: formData, // FormData → bez Content-Type
      });


      if (!uploadRes.ok) {
        console.error(
          "Błąd uploadu plików:",
          await uploadRes.text().catch(() => "")
        );
        alert("Sprawa została utworzona, ale pliki nie zostały zapisane ❌");
      } else {
        console.log("📁 Pliki dodane do sprawy", caseId);
      }
    }

    // 3️⃣ — RESET FORMULARZA + plików
    if (addClientEl) addClientEl.value = "";
    if (addAmountEl) addAmountEl.value = "";
    if (addBankEl) addBankEl.value = "";
    if (addFilesEl) addFilesEl.value = "";

    pendingFiles = [];
    syncFilesToInput();
    renderFilePreview();

    const flt = document.getElementById("flt_status");
    if (flt) flt.value = "";

    // 4️⃣ — ODSWIEŻ LISTĘ SPRAW
    await loadCases("");

  } catch (err) {
    console.error("Add case error:", err);
    alert("Nie udało się dodać sprawy: " + (err?.message || ""));
  }
});


// Modal — referencje
const cmModal = document.getElementById("caseModal");
const cmClient = document.getElementById("cmClient");
const cmWps = document.getElementById("cmWps");
const cmStatus = document.getElementById("cmStatus");
const cmAmount = document.getElementById("cmAmount");
const cmDate = document.getElementById("cmDate");
if (cmAmount) cmAmount.setAttribute("step", "any");

// Otwieranie widoku szczegółów po kliknięciu w wiersz (zamiast modala)
const tbodyEl = document.getElementById('caseTableBody');
if (tbodyEl) {
  tbodyEl.addEventListener('click', async (ev) => {

    const tr = ev.target.closest('tr');
    if (!tr) return;
    const caseId = tr.getAttribute('data-id') || '';
    if (!caseId) return;

    try {
      const d = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('pk_token') || '') }
      });
      const data = await d.json();
      cmModal.dataset.caseId = String(data.id || caseId); // FIX: potrzebne przy zapisie
      // 🔥 USTAWIAMY GLOBALNE ID SPRAWY DLA WPS
      const numericId = Number(data.id || caseId);
      if (Number.isFinite(numericId)) {
        window.currentCaseId = numericId;
        console.log("WPS: ustawiam window.currentCaseId =", numericId);

        const wpsCaseIdInput = document.getElementById("wpsCaseId");
        if (wpsCaseIdInput) {
          wpsCaseIdInput.value = String(numericId);
          console.log("WPS: ustawiam #wpsCaseId.value =", wpsCaseIdInput.value);
        }
        // 🔥 Wczytaj zapisane dane WPS dla tej sprawy (jeśli są)
        if (window.PK_WPS && typeof window.PK_WPS.reloadForCurrentCase === "function") {
          window.PK_WPS.reloadForCurrentCase();
        }

      } else {
        console.warn("WPS: nie udało się ustawić ID sprawy – data.id/caseId nie jest liczbą:", data.id, caseId);
      }

      // Wypełnij pola formularza
      if (cmClient) cmClient.textContent = data.client || "—";
      cmWps.value = data.wps ?? "";
      cmStatus.value = data.status || "nowa";
      cmAmount.value = data.loan_amount ?? "";
      cmDate.value = data.contract_date || "";

      if (cmBank) {
        const val = data.bank || "";
        fillBankSelect(cmBank, val);
      }

      // === 3C: Badge + sekcja INFO + Oferty + link do pełnego widoku ===
      const badge = document.getElementById('cmStatusBadge');
      if (badge) {
        badge.textContent = data.status || '—';
        badge.className = 'badge badge--' + String(data.status || '').toLowerCase();
      }

      (document.getElementById('cmInfoClient') || {}).textContent = data.client || '—';
      (document.getElementById('cmInfoBank') || {}).textContent = data.bank || '—';
      (document.getElementById('cmInfoAmount') || {}).textContent = data.loan_amount == null ? '—' : Number(data.loan_amount).toLocaleString('pl-PL');
      (document.getElementById('cmInfoWps') || {}).textContent = data.wps == null ? '—' : Number(data.wps).toLocaleString('pl-PL');
      (document.getElementById('cmInfoStatus') || {}).textContent = data.status || '—';
      (document.getElementById('cmInfoDate') || {}).textContent = data.contract_date || '—';
      (document.getElementById('cmInfoPhone') || {}).textContent = data.phone || '—';
      (document.getElementById('cmInfoEmail') || {}).textContent = data.email || '—';
      (document.getElementById('cmInfoAddress') || {}).textContent = data.address || '—';

      renderOffers({
        bank: data.bank || '',
        status: (data.status || '').toLowerCase(),
        wps: Number(data.wps || 0),
        loan_amount: Number(data.loan_amount || 0)
      });

      const fullBtn = document.getElementById('openFullCase');
      if (fullBtn) {
        fullBtn.onclick = (e) => {
          e.preventDefault();
          const cid = String(data.id || caseId);
          window.open(`/case.html?id=${encodeURIComponent(cid)}`, '_blank');
        };
      }

      cmModal.style.display = "block";

      // --- uruchomienie sekcji Oferta SKD (po otwarciu modala) ---
      try {
        if (typeof initSkdOffer === 'function') {
          console.log('%c⤷ Wywołanie initSkdOffer() po otwarciu modala', 'color:#0a0');
          initSkdOffer(data); // <- używamy "data"
        } else {
          console.warn('initSkdOffer() nie jest dostępne w momencie otwarcia modala');
        }
      } catch (e) {
        console.error('Błąd przy wywołaniu initSkdOffer:', e);
      }

    } catch (err) {
      console.error('Modal load error:', err);
      alert('Nie udało się pobrać szczegółów sprawy.');
    }

  }); // <— zamknięcie addEventListener od otwierania modala

  /*// ===== Zamknięcie modala (X i backdrop) =====
  const cmCloseEl = document.getElementById("cmClose");
  if (cmCloseEl && cmModal) {
    cmCloseEl.addEventListener("click", () => (cmModal.style.display = "none"));
    cmModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) cmModal.style.display = "none";
    });
  }*/

  // ===== Zakładki w modalu =====
  const tabs = cmModal?.querySelectorAll('.tab');
  const panels = cmModal?.querySelectorAll('.tabpanel');
  if (tabs && panels) {
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panels.forEach(p => p.classList.toggle('active', p.dataset.panel === name));
      });
    });
  }

  // ===== Zapis w modalu (WPS/Status/itd.) =====
  const cmSave = document.getElementById("cmSave");
  if (cmSave && cmModal) {
    cmSave.addEventListener("click", async () => {
      const id = cmModal.dataset.caseId || "";
      if (!id) { alert("Brak ID sprawy."); return; }

      const cmAmount = document.getElementById("cmAmount");
      const cmDate = document.getElementById("cmDate");
      const cmBank = document.getElementById("cmBank");

      const wpsRaw = document.getElementById("cmWps")?.value?.trim() ?? "";
      const statusVal = document.getElementById("cmStatus")?.value ?? "nowa";
      const amountRaw = cmAmount ? cmAmount.value.trim() : "";
      const dateRaw = cmDate ? cmDate.value.trim() : "";

      const normNum = (v) => {
        if (v === "" || v == null) return null;
        const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };
      const wpsNorm = normNum(wpsRaw);
      const amountNorm = normNum(amountRaw);

      let dateNorm = null;
      if (dateRaw) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
          alert("Nieprawidłowy format daty. Użyj YYYY-MM-DD.");
          return;
        }
        dateNorm = dateRaw;
      }

      const payload = {
        wps: wpsNorm,
        status: statusVal || null,
        loan_amount: amountNorm,
        contract_date: dateNorm,
      };
      if (cmBank) payload.bank = cmBank.value || null;

      try {
        await apiFetch(`/cases/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });

        cmModal.style.display = "none";
        await loadCases();
        try {
          const all = window.__PK_ITEMS_ALL__ || [];
          computeAndRenderWpsKpis(all);
        } catch (e) { /* no-op */ }
      } catch (e) {
        console.error("SAVE ERROR", e);
        alert("Nie udało się zapisać: " + (e?.message || e));
      }
    });
  }

  // === Seed: bankList (wycisza 401 z /api/banks) ===
  window.bankList = [
    "PKO BP", "Santander", "mBank", "ING", "Alior", "Millennium", "BNP Paribas",
    "Credit Agricole", "BOŚ", "Pekao SA", "Nest Bank", "Citi Handlowy", "VeloBank"
  ];

  // === Modal SKD (blok 1/3): bootstrap + template + render (bez zapisu do API) ===
  (function skdBootstrap() {
    const $ = (id) => document.getElementById(id);
    const money = (n) => (n == null || Number.isNaN(+n)) ? '' : (+n).toFixed(2);
    const STATUS = [
      { v: 'draft', l: 'Szkic' }, { v: 'sent', l: 'Wysłana' }, { v: 'accepted', l: 'Zaakceptowana' },
      { v: 'declined', l: 'Odrzucona' }, { v: 'archived', l: 'Zarchiwizowana' }
    ];
    const ctx = { offer: null, role: 'agent', dirty: false };
    window.PK_SKD = window.PK_SKD || {};
    window.PK_SKD._getCtx = () => ctx;


    // ——— util: readOnly/disabled wg roli ———
    function setRO(node, flag) { if (!node) return; node.readOnly = !!flag; node.disabled = !!flag; }
    function computeFee(o) { return (o && o.wps_forecast && o.fee_percent) ? (Number(o.wps_forecast) * Number(o.fee_percent) / 100) : null; }
    function setDirty(f) { const hint = $('skdDirtyHint'); if (hint) hint.style.display = f ? 'block' : 'none'; ctx.dirty = !!f; }

    // ——— lista banków (globalna lub API, z fallbackiem) ———
    async function loadBanks() {
      if (Array.isArray(window.bankList) && window.bankList.length) return window.bankList;
      try { const r = await fetch('/api/banks'); if (!r.ok) throw 0; const d = await r.json(); window.bankList = d; return d; }
      catch (_) { return ["PKO BP", "Santander", "mBank", "ING", "Alior", "Millennium", "BNP Paribas"]; }
    }

    // ——— render ———
    async function render() {
      const o = ctx.offer || {};
      $('skdClientName').textContent = o.client_name || '—';

      // status
      const st = $('skdStatus'); st.innerHTML = '';
      STATUS.forEach(s => { const opt = document.createElement('option'); opt.value = s.v; opt.textContent = s.l; if (o.status === s.v) opt.selected = true; st.appendChild(opt); });

      // wariant + bank
      $('skdVariant').value = o.variant || 'success_fee';
      const bl = await loadBanks(); const bs = $('skdBank'); bs.innerHTML = '';
      bl.forEach(b => { const opt = document.createElement('option'); opt.value = b; opt.textContent = b; if (o.bank === b) opt.selected = true; bs.appendChild(opt); });

      // liczby / daty / notatka
      $('skdWpsForecast').value = o.wps_forecast ?? '';
      $('skdFeePercent').value = o.fee_percent ?? '';
      $('skdFeeAmount').value = o.fee_amount ?? '';
      $('skdValidUntil').value = (o.valid_until || '').substring(0, 10);
      $('skdLoanAmount').value = o.loan_amount ?? '';
      $('skdTenor').value = o.tenor_months ?? '';
      $('skdApr').value = o.apr_percent ?? '';
      $('skdInternalNote').value = o.internal_note ?? '';

      // schedule
      const sb = $('skdScheduleBox');
      if (Array.isArray(o.schedule) && o.schedule.length) {
        sb.textContent = o.schedule.map(r => `${r.no}. ${r.date} — ${money(r.amount)} PLN`).join('\n');
      } else { sb.textContent = 'Brak harmonogramu do wyświetlenia.'; }

      // historia
      const hl = $('skdHistoryList'); hl.innerHTML = '';
      (o.history || []).slice().reverse().forEach(h => {
        const li = document.createElement('li');
        li.textContent = `${new Date(h.ts).toLocaleString()} — ${h.by}: ${h.msg}`;
        hl.appendChild(li);
      });

      // role
      const isAdmin = ctx.role === 'admin';
      ['skdStatus', 'skdBank', 'skdWpsForecast', 'skdFeePercent', 'skdFeeAmount', 'skdValidUntil', 'skdLoanAmount', 'skdTenor', 'skdApr'].forEach(id => setRO($(id), !isAdmin));
      setRO($('skdVariant'), false);
      setRO($('skdInternalNote'), false);
      $('skdDeleteBtn').style.display = isAdmin ? 'inline-block' : 'none';

      bindInputs(); setDirty(false);
      window.dispatchEvent(new Event('pk_skd_render'));

    }

    // ——— eventy pól (lokalne, bez API) ———
    function bindInputs() {
      const bind = (id, fn) => { const n = $(id); if (!n) return; n.oninput = n.onchange = fn; };
      bind('skdStatus', () => { ctx.offer.status = $('skdStatus').value; setDirty(true); });
      bind('skdVariant', () => { ctx.offer.variant = $('skdVariant').value; setDirty(true); });
      bind('skdBank', () => { ctx.offer.bank = $('skdBank').value; setDirty(true); });

      bind('skdWpsForecast', () => { ctx.offer.wps_forecast = +$('skdWpsForecast').value || null; recalcFee(); setDirty(true); });
      bind('skdFeePercent', () => { ctx.offer.fee_percent = +$('skdFeePercent').value || null; recalcFee(); setDirty(true); });
      bind('skdFeeAmount', () => { ctx.offer.fee_amount = +$('skdFeeAmount').value || null; setDirty(true); });

      bind('skdValidUntil', () => { ctx.offer.valid_until = $('skdValidUntil').value; setDirty(true); });
      bind('skdLoanAmount', () => { ctx.offer.loan_amount = +$('skdLoanAmount').value || null; setDirty(true); });
      bind('skdTenor', () => { ctx.offer.tenor_months = +$('skdTenor').value || null; setDirty(true); });
      bind('skdApr', () => { ctx.offer.apr_percent = +$('skdApr').value || null; setDirty(true); });
      bind('skdInternalNote', () => { ctx.offer.internal_note = $('skdInternalNote').value; setDirty(true); });

      $('skdSaveBtn').onclick = () => alert('Zapis pojawi się w bloku 2 (PUT /api/offers/:id).');
      $('skdDeleteBtn').onclick = () => alert('Usuwanie pojawi się w bloku 2 (DELETE /api/offers/:id).');
    }

    function recalcFee() {
      const f = computeFee(ctx.offer);
      if (f != null) { ctx.offer.fee_amount = f; $('skdFeeAmount').value = money(f); }
    }
    function initSkdTabs() {
      const tabs = document.querySelectorAll('#skdOffer .modal-tabs .tab');
      const panels = document.querySelectorAll('#skdOffer .tab-panel');

      if (!tabs.length || !panels.length) return; // bezpieczeństwo

      tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
          const tn = tab.dataset.tab; // 'summary', 'contract', 'files'

          // przełącz aktywną zakładkę (górne buttony)
          tabs.forEach((t) => t.classList.remove('active'));
          tab.classList.add('active');

          // przełącz widoczne panele
          panels.forEach((panel) => {
            const isActive = panel.id === `tab-${tn}`;
            panel.classList.toggle('active', isActive);
            panel.style.display = isActive ? '' : 'none';
          });
        });
      });
    }
    initSkdTabs();

    // ——— taby + zamykanie ———
    function wireChrome() {
      const modal = document.getElementById('skdOfferModal');
      if (!modal) {
        console.warn('[SKD] wireChrome: #skdOfferModal not found – skipping chrome init.');
        return;
      }
      modal.querySelector('.modal-close').onclick = close;
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

      modal.querySelectorAll('.modal-tabs .tab').forEach(tab => {
        tab.onclick = () => {
          modal.querySelectorAll('.modal-tabs .tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const tn = tab.dataset.tab;
          modal.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
          $('skdTab-' + tn).style.display = '';
        };
      });
    }

    function open(offer, role) {
      ctx.offer = structuredClone(offer || {});
      ctx.role = role || 'agent';
      $('skdOfferModal').style.display = 'block';
      document.body.classList.add('modal-open');
      render();
    }

    function close() {
      $('skdOfferModal').style.display = 'none';
      document.body.classList.remove('modal-open');
    }

    // ——— publiczny interfejs ———
    wireChrome();
    window.PK_SKD = window.PK_SKD || {};
    window.PK_SKD.openOffer = open;    // użyj: PK_SKD.openOffer(offerObj, 'admin'|'agent')
    window.PK_SKD.close = close;
  })();
  // === Modal SKD: sekcja Opcje (admin toggluje, agent podgląda) ===
  (function skdOptionsSection() {
    const $ = (id) => document.getElementById(id);
    function ensureHost() {
      const host = document.createElement('div'); host.id = 'skdOptionsHost';
      const summary = document.getElementById('skdTab-summary');
      if (!summary) return;
      // wstrzykuj pod istniejące pola
      summary.appendChild(document.createElement('hr'));
      const h = document.createElement('h4'); h.textContent = 'Opcje oferty'; h.style.margin = '8px 0';
      summary.appendChild(h);
      summary.appendChild(host);
    }

    function renderOptions() {
      if (!window.PK_SKD || !PK_SKD._getCtx) return;
      const ctx = PK_SKD._getCtx();
      const host = document.getElementById('skdOptionsHost'); if (!host) return;
      const isAdmin = ctx.role === 'admin';
      const opts = Array.isArray(ctx.offer.options) ? ctx.offer.options : (ctx.offer.options = []);

      host.innerHTML = '';
      if (isAdmin) {
        // admin: checkboxy + edycja opisu
        opts.forEach((o, idx) => {
          const row = document.createElement('div'); row.style.display = 'grid'; row.style.gridTemplateColumns = '24px 220px 1fr'; row.style.gap = '8px'; row.style.alignItems = 'center'; row.style.margin = '6px 0';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!o.enabled;
          cb.onchange = () => { o.enabled = cb.checked; markDirty(); };
          const label = document.createElement('div'); label.textContent = o.label || o.key;
          const desc = document.createElement('input'); desc.type = 'text'; desc.value = o.desc || ''; desc.placeholder = 'Krótki opis opcji';
          desc.oninput = () => { o.desc = desc.value; markDirty(); };
          row.appendChild(cb); row.appendChild(label); row.appendChild(desc);
          host.appendChild(row);
        });
        // dodawanie nowej opcji (prosty dodaj)
        const add = document.createElement('button');
        add.textContent = 'Dodaj opcję'; add.style.marginTop = '6px'; add.style.padding = '6px 10px'; add.style.border = '0'; add.style.borderRadius = '8px'; add.style.background = '#eef2ff'; add.style.cursor = 'pointer';
        add.onclick = () => {
          const key = prompt('Klucz opcji (np. expedite)'); if (!key) return;
          const label = prompt('Etykieta (np. Tryb przyspieszony)') || key;
          const desc = prompt('Opis krótki (opcjonalnie)') || '';
          ctx.offer.options.push({ key, label, desc, enabled: true }); markDirty(); renderOptions();
        };
        host.appendChild(add);
      } else {
        // agent: tylko włączone opcje (lista)
        const enabled = opts.filter(o => o.enabled);
        if (!enabled.length) { host.textContent = 'Brak dostępnych opcji od administratora.'; return; }
        enabled.forEach(o => {
          const row = document.createElement('div'); row.style.margin = '6px 0';
          const strong = document.createElement('div'); strong.style.fontWeight = '600'; strong.textContent = o.label || o.key;
          const d = document.createElement('div'); d.style.color = '#667085'; d.textContent = o.desc || '';
          row.appendChild(strong); row.appendChild(d); host.appendChild(row);
        });
      }
    }

    function markDirty() { const hint = document.getElementById('skdDirtyHint'); if (hint) hint.style.display = 'block'; if (window.PK_SKD && PK_SKD._getCtx) PK_SKD._getCtx().dirty = true; }

    // expose mini hooki do istniejącego modułu
    if (!window.PK_SKD) window.PK_SKD = {};
    // getter na ctx z bloku 1 (dodamy tam 1 linijkę, patrz niżej)
    // rerender opcji przy każdym renderze modala
    window.addEventListener('pk_skd_render', renderOptions);

    // wstrzyknięcie kontenera na „Opcje”
    ensureHost();
  })();
  // === API bootstrap (auth token / csrf / cookies) ===
  window.API = window.API || { base: '/api', authToken: null };
  function getCsrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content || null;
  }

  // Centralny helper do wywołań API – z obsługą błędów i sesji
  async function apiFetch(url, options = {}) {
    const finalOptions = {
      // zawsze wysyłamy cookies (auth_token)
      credentials: "include",

      // domyślne nagłówki – JSON, chyba że ktoś poda własne
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      },

      ...options,
    };

    try {
      const res = await fetch(url, finalOptions);

      // ======= STATUS 401 – sesja wygasła =======
      if (res.status === 401) {
        alert("Twoja sesja wygasła lub nie jesteś zalogowany. Zaloguj się ponownie.");
        window.location.href = "/login.html";
        throw new Error("Unauthorized (401)");
      }

      // ======= STATUS 403 – brak uprawnień =======
      if (res.status === 403) {
        alert("Brak dostępu do tego zasobu.");
        throw new Error("Forbidden (403)");
      }

      // ======= STATUS 429 – za dużo żądań (rate limit) =======
      if (res.status === 429) {
        alert("Wykonano zbyt wiele żądań. Spróbuj ponownie za chwilę.");
        throw new Error("Too Many Requests (429)");
      }

      // ======= Inny błąd =======
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        console.error("API error:", res.status, msg);
        alert("Wystąpił błąd serwera.");
        throw new Error("API error " + res.status);
      }

      // ======= JSON lub tekst =======
      const contentType = res.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        return res.json();
      }
      return res.text();

    } catch (err) {
      console.error("apiFetch – problem z połączeniem:", err);
      alert("Nie udało się połączyć z serwerem. Sprawdź internet i spróbuj ponownie.");
      throw err;
    }
  }

  // rejestracja globalna
  window.apiFetch = apiFetch;


  // === Modal SKD (blok 2/3): zapis (PUT), usuwanie (DELETE), walidacje — z DEV fallback ===
  (function skdPersist() {
    if (!window.PK_SKD || !PK_SKD._getCtx) { console.warn('PK_SKD ctx not ready'); return; }
    const $ = (id) => document.getElementById(id);

    function toast(msg) { if (window.showToast) showToast(msg); else alert(msg); }
    function disable(btn, flag) { if (btn) { btn.disabled = !!flag; btn.style.opacity = flag ? 0.6 : 1; } }

    function validate(o) {
      const errs = [];
      if (!o.status) errs.push('Wybierz status.');
      if (!o.bank) errs.push('Wybierz bank.');
      if (!o.variant) errs.push('Wybierz wariant.');
      if (o.variant === 'success_fee' && !o.fee_percent && !o.fee_amount) errs.push('Podaj prowizję (%, PLN lub oba).');
      if (o.fee_percent != null && (o.fee_percent < 0 || o.fee_percent > 100)) errs.push('Prowizja % musi być 0–100.');
      if (o.wps_forecast != null && o.wps_forecast < 0) errs.push('WPS nie może być ujemny.');
      if (o.fee_amount != null && o.fee_amount < 0) errs.push('Prowizja (PLN) nie może być ujemna.');
      return errs;
    }

    async function save() {
      const ctx = PK_SKD._getCtx(); const o = ctx.offer || {};
      const errs = validate(o);
      if (errs.length) { toast('Popraw dane:\n• ' + errs.join('\n• ')); return; }

      const btn = $('skdSaveBtn'); disable(btn, true);
      try {
        const r = await apiFetch(`/offers/${encodeURIComponent(o.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ offer_skd: o })
        });

        if (r.status === 401) {
          // DEV fallback: zapis do localStorage
          localStorage.setItem('skd_offers:' + o.id, JSON.stringify(o));
          ctx.offer = o; ctx.dirty = false;
          const hint = $('skdDirtyHint'); if (hint) hint.style.display = 'none';
          if (window.refreshCasesRow) window.refreshCasesRow(o.id, { offer_skd: ctx.offer });
          toast('Tryb DEV: zapis lokalny (backend 401).');
          return;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);

        const out = await r.json();
        ctx.offer = out.offer_skd || o;
        ctx.dirty = false;
        const hint = $('skdDirtyHint'); if (hint) hint.style.display = 'none';
        if (window.refreshCasesRow) window.refreshCasesRow(o.id, { offer_skd: ctx.offer });
        toast('Zapisano ofertę SKD.');
      } catch (e) {
        console.error(e);
        toast('Nie udało się zapisać (sprawdź uprawnienia/API).');
      } finally {
        disable(btn, false);
      }
    }

    async function del() {
      const ctx = PK_SKD._getCtx(); const o = ctx.offer || {};
      if (ctx.role !== 'admin') { toast('Usuwanie dostępne tylko dla administratora.'); return; }
      if (!confirm('Na pewno usunąć tę ofertę?')) return;

      const btn = $('skdDeleteBtn'); disable(btn, true);
      try {
        const r = await apiFetch(`/offers/${encodeURIComponent(o.id)}`, { method: 'DELETE' });

        if (r.status === 401) {
          // DEV fallback: usuń lokalny zapis
          localStorage.removeItem('skd_offers:' + o.id);
          if (window.removeCaseRow) window.removeCaseRow(o.id);
          if (window.PK_SKD && PK_SKD.close) PK_SKD.close();
          toast('Tryb DEV: lokalne usunięcie (backend 401).');
          return;
        }
        if (!r.ok && r.status !== 204) throw new Error('HTTP ' + r.status);

        if (window.removeCaseRow) window.removeCaseRow(o.id);
        if (window.PK_SKD && PK_SKD.close) PK_SKD.close();
        toast('Usunięto ofertę SKD.');
      } catch (e) {
        console.error(e);
        toast('Nie udało się usunąć (sprawdź uprawnienia/API).');
      } finally {
        disable(btn, false);
      }
    }

    function bindButtons() {
      const saveBtn = $('skdSaveBtn');
      const delBtn = $('skdDeleteBtn');
      if (saveBtn) saveBtn.onclick = save;
      if (delBtn) delBtn.onclick = del;
    }

    window.addEventListener('pk_skd_render', bindButtons);
  })();
  // === Modal SKD (blok 3/3): podpięcie do tabeli + badge statusu + walidacja daty ===
  (function skdWireAndUX() {
    const $ = (id) => document.getElementById(id);

    // ——— Mini CSS na badge (wstrzyknięcie raz) ———
    (function injectBadgeCss() {
      if (document.getElementById('skd-badge-css')) return;
      const s = document.createElement('style');
      s.id = 'skd-badge-css';
      s.textContent = `
      .skd-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}
      .skd-badge.draft{background:#eef2ff;color:#1e3a8a}
      .skd-badge.sent{background:#ecfeff;color:#155e75}
      .skd-badge.accepted{background:#ecfdf5;color:#065f46}
      .skd-badge.declined{background:#fef2f2;color:#991b1b}
      .skd-badge.archived{background:#f1f5f9;color:#334155}
      .skd-warn{margin-top:6px;font-size:12px;color:#b91c1c}
      .skd-field-error{border-color:#ef4444 !important; box-shadow:0 0 0 2px rgba(239,68,68,.15)}
    `;
      document.head.appendChild(s);
    })();

    // ——— Badge helper ———
    function makeBadge(statusText) {
      const s = (statusText || '').toLowerCase();
      const span = document.createElement('span');
      span.className = `skd-badge ${s}`;
      span.textContent = ({ draft: 'Szkic', sent: 'Wysłana', accepted: 'Zaakceptowana', declined: 'Odrzucona', archived: 'Zarchiwizowana' })[s] || statusText || '—';
      return span;
    }

    // ——— Pomaluj badge w tabeli (dla elementów z atrybutem data-offer-status) ———
    function paintBadges(root = document) {
      root.querySelectorAll('[data-offer-status]').forEach(el => {
        const txt = (el.getAttribute('data-offer-status') || el.textContent || '').trim();
        el.innerHTML = ''; el.appendChild(makeBadge(txt));
      });
    }

    // ——— Walidacja daty „ważna do” (po renderze modala) ———
    function validateValidUntil() {
      const input = $('skdValidUntil'); if (!input) return;
      const warnId = 'skdValidWarn';
      const old = $(warnId); if (old) old.remove();

      const v = input.value;
      if (!v) { input.classList.remove('skd-field-error'); return; }

      // porównanie z „dziś” (lokalnie)
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dt = new Date(v); dt.setHours(0, 0, 0, 0);

      if (dt < today) {
        input.classList.add('skd-field-error');
        const w = document.createElement('div');
        w.id = warnId; w.className = 'skd-warn';
        w.textContent = 'Uwaga: data ważności minęła. Zaktualizuj, aby oferta była aktualna.';
        // wstrzykuj bezpośrednio pod polem
        const parent = input.parentElement || input.closest('div') || $('skdTab-summary');
        (parent || input).appendChild(w);
      } else {
        input.classList.remove('skd-field-error');
      }
    }

    // ——— Listener: po każdym renderze modala ———
    window.addEventListener('pk_skd_render', () => {
      validateValidUntil();
      paintBadges(); // na wypadek, gdyby status pokazywał się także w modalu
    });

    // ——— Podpięcie do tabeli spraw: data-action="open-skd" ———
    (function wireCasesTable() {
      const table = document.getElementById('casesTable');
      if (!table) return;

      table.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action="open-skd"]');
        if (!btn) return;

        const id = btn.getAttribute('data-offer-id') || btn.getAttribute('data-id') || btn.dataset.offerId || btn.dataset.id;
        if (!id) return;

        // Pobierz ofertę z modelu lub API (z fallbakiem DEV, jeżeli masz 401)
        let offer = (window.getOfferById && window.getOfferById(id)) || null;
        if (!offer) {
          try {
            const r = await apiFetch(`/offers/${encodeURIComponent(id)}`, { method: 'GET' });
            if (r.status === 401) {
              const local = localStorage.getItem('skd_offers:' + id);
              offer = local ? JSON.parse(local) : null;
            } else if (r.ok) {
              const json = await r.json();
              offer = json.offer_skd || json.offer || null;
            }
          } catch (_) { }
        }

        // jeżeli dalej brak — utwórz pusty szkielet, żeby admin mógł uzupełnić
        if (!offer) offer = { id, status: 'draft', variant: 'success_fee', history: [], options: [] };

        const role = (window.currentUser && window.currentUser.role) || 'agent';
        if (window.PK_SKD && PK_SKD.openOffer) PK_SKD.openOffer(offer, role);
      });

      // Pomaluj badge od razu i po ewentualnym re-renderze tabeli
      paintBadges(table);
      window.addEventListener('cases_rendered', () => paintBadges(table)); // wywołaj to eventem z Twojego renderCases()
    })();
  })();
  // === Modal SKD: UX agenta — filtr wariantów wg opcji admina ===
  (function skdAgentVariantWhitelist() {
    const $ = (id) => document.getElementById(id);

    function enabledOptionKeys(opts) {
      return (Array.isArray(opts) ? opts : []).filter(o => o.enabled).map(o => o.key);
    }
    function labelForKey(opts, key) {
      const o = (opts || []).find(x => x.key === key);
      return (o && (o.label || o.key)) || key;
    }
    function rebuildVariantForAgent(ctx) {
      const sel = $('skdVariant'); if (!sel) return;
      const keys = enabledOptionKeys(ctx.offer.options);
      if (!keys.length) {
        // brak dostępnych opcji -> zablokuj wybór + komunikat
        sel.innerHTML = `<option value="">— brak opcji od administratora —</option>`;
        sel.disabled = true;
        return;
      }
      // zbuduj tylko dozwolone warianty
      sel.innerHTML = '';
      keys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = labelForKey(ctx.offer.options, k);
        sel.appendChild(opt);
      });
      sel.disabled = false;

      // jeśli bieżący wariant niedozwolony -> przestaw na 1. dozwolony
      if (!keys.includes(ctx.offer.variant)) {
        ctx.offer.variant = keys[0];
        sel.value = keys[0];
        const hint = document.getElementById('skdDirtyHint'); if (hint) hint.style.display = 'block';
        if (window.PK_SKD && PK_SKD._getCtx) PK_SKD._getCtx().dirty = true;
      } else {
        sel.value = ctx.offer.variant;
      }
    }

    // po każdym renderze modala — jeśli agent, odfiltruj warianty
    window.addEventListener('pk_skd_render', () => {
      if (!window.PK_SKD || !PK_SKD._getCtx) return;
      const ctx = PK_SKD._getCtx();
      if (ctx.role !== 'admin') rebuildVariantForAgent(ctx);
    });
  })();

  // === PATCH 1: Walidacja "Ważna do" — live na input/change ===
  (function skdValidUntilLive() {
    const $ = (id) => document.getElementById(id);

    function validate() {
      const input = $('skdValidUntil'); if (!input) return;
      const warnId = 'skdValidWarn';
      const old = document.getElementById(warnId); if (old) old.remove();

      const v = input.value;
      if (!v) { input.classList.remove('skd-field-error'); return; }

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dt = new Date(v); dt.setHours(0, 0, 0, 0);

      if (dt < today) {
        input.classList.add('skd-field-error');
        const w = document.createElement('div');
        w.id = warnId; w.className = 'skd-warn';
        w.textContent = 'Uwaga: data ważności minęła. Zaktualizuj, aby oferta była aktualna.';
        (input.parentElement || input.closest('div') || document.getElementById('skdTab-summary') || input).appendChild(w);
      } else {
        input.classList.remove('skd-field-error');
      }
    }

    function bind() { const i = $('skdValidUntil'); if (!i) return; i.oninput = i.onchange = validate; validate(); }
    window.addEventListener('pk_skd_render', bind);
  })();
  // === PATCH 2: Badge statusu — globalne malowanie + eventy ===
  (function skdBadgesGlobal() {
    function makeBadge(statusText) {
      const s = (statusText || '').toLowerCase();
      const span = document.createElement('span');
      span.className = `skd-badge ${s}`;
      span.textContent = ({ draft: 'Szkic', sent: 'Wysłana', accepted: 'Zaakceptowana', declined: 'Odrzucona', archived: 'Zarchiwizowana' })[s] || (statusText || '—');
      return span;
    }
    function paint(root = document) {
      root.querySelectorAll('[data-offer-status]').forEach(el => {
        const txt = (el.getAttribute('data-offer-status') || el.textContent || '').trim();
        // jeżeli już jest badge — pomiń
        if (el.firstElementChild && el.firstElementChild.className.includes('skd-badge')) return;
        el.textContent = ''; el.appendChild(makeBadge(txt));
      });
    }

    // maluj na start, po renderze modala, po renderze tabeli i na żądanie
    setTimeout(() => paint(document), 0);
    window.addEventListener('pk_skd_render', () => paint(document));
    window.addEventListener('cases_rendered', () => paint(document));
    window.addEventListener('paint_skd_badges', () => paint(document));
  })();
  // === (opcjonalnie) alias do apiFetch dla self-testów/legacy ===
  if (typeof window.apiFetch !== 'function' && typeof apiFetch === 'function') { window.apiFetch = apiFetch; }

  // ===== DIAGNOSTYKA / overlay =====
  function showDiag(msg) {
    let el = document.getElementById('pkDiag');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pkDiag';
      Object.assign(el.style, {
        position: 'fixed',
        bottom: '12px',
        right: '16px',
        padding: '8px 14px',
        background: 'rgba(0,0,0,.75)',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        borderRadius: '8px',
        zIndex: 9999,
        boxShadow: '0 3px 10px rgba(0,0,0,.25)',
        transition: 'opacity .3s ease'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => (el.style.opacity = '0'), 3000);
  }
  function hideDiag() {
    const el = document.getElementById('pkDiag');
    if (el) el.style.opacity = '0';
  }

  let dashboardBootStarted = false;
  // ===== BOOTSTRAP =====
  document.addEventListener('DOMContentLoaded', async () => {
    if (dashboardBootStarted) return;   // 👈 BLOKADA PODWÓJNEGO STARTU
    dashboardBootStarted = true;

    try {
      loadCurrentUser();
      showDiag('🚀 Boot: start');
      await step('Auth', initAuth);
      await step('Bank selects', initBanks);
      await step('Tabela + KPI', initTableAndKpi);
      await step('Filtry & KPI-click', bindFilters);
      await step('Modal & Logout', bindModalAndLogout);
      console.log("[PK] → step AddCase form");
      initAddCaseForm();
      showDiag('✅ Dashboard gotowy');
      log('✅ dashboard ready');
    } catch (e) {
      console.error('[PK:ERR] BOOT FAIL', e);
      showDiag('❌ Boot zatrzymany: ' + (e?.message || e));
    }
  });



  // === Szukajka ===
  (function initCaseSearch() {
    const input = document.getElementById("caseSearch");
    const clearBtn = document.getElementById("clearCaseSearch");
    const countEl = document.getElementById("caseSearchCount");
    if (!input) return;

    window.casesCache = window.casesCache || [];

    function normalize(s) {
      return (s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s.-]+/g, "");
    }
    function updateCount(n, q) {
      if (!q) { countEl.textContent = ""; return; }
      countEl.textContent = n === 1 ? "Znaleziono 1 sprawę" : `Znaleziono: ${n}`;
    }

    const apply = debounce(() => {
      const base = Array.isArray(window.casesCache) ? window.casesCache : [];
      const q = (input.value || "").trim();
      const nq = normalize(q);

      const tables = document.querySelectorAll("table");
      const mainTbody = tables.length ? tables[tables.length - 1].querySelector("tbody") : null;
      if (!mainTbody) { updateCount(0, q); return; }

      const rows = Array.from(mainTbody.querySelectorAll("tr"));
      if (!nq) { rows.forEach(tr => tr.style.display = ""); updateCount("", ""); return; }

      let shown = 0;
      rows.forEach(tr => {
        const blob = tr.dataset.search || "";
        const hit = blob.includes(nq);  // ← porównujemy gotowe data-search
        tr.style.display = hit ? "" : "none";
        if (hit) shown++;
      });



      updateCount(shown, q);

      if (shown === 1 && typeof openCaseModal === "function") {
        const onlyTr = rows.find(tr => tr.style.display !== "none");
        const caseId = onlyTr?.dataset.id || null;

        if (caseId) {
          setTimeout(() => {
            window.currentCaseId = caseId;
            console.log("Otwieram sprawę ID:", caseId);
            openCaseModal(caseId);
          }, 80);
        }
      }
    }, 200);


    // nasłuchy
    input.addEventListener("input", apply);

    // Enter / Escape
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") apply();
      if (e.key === "Escape") {
        input.value = "";
        apply();
        input.blur();
      }
    });

    // Wyczyść „×”
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        input.value = "";
        input.focus();
        apply();
      });
    }

    // Skrót Cmd/Ctrl+K
    document.addEventListener("keydown", (e) => {
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      if ((isMac && e.metaKey && e.key.toLowerCase() === "k") ||
        (!isMac && e.ctrlKey && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  })(); // ← JEDYNE zamknięcie IIFE initCaseSearch


  function populateSkdOfferForm(offerSkd) {
    if (!offerSkd) return;

    const { eligibility, clientPref, variant, wps, notes, contract, filesMeta } = offerSkd;

    // 1. Dostępność wariantów
    if (eligibility) {
      console.log("SKD eligibility z backendu:", eligibility);
      const eligSf50 = document.getElementById("eligSf50");
      const eligSf49 = document.getElementById("eligSf49");
      const eligSell = document.getElementById("eligSell");

      if (eligSf50) eligSf50.checked = !!eligibility.sf50;
      if (eligSf49) eligSf49.checked = !!eligibility.sf49;
      if (eligSell) eligSell.checked = !!eligibility.sell;
    }

    // 2. Preferencja klienta (radio clientPref)
    if (clientPref) {
      const prefRadio = document.querySelector(
        `input[name="clientPref"][value="${clientPref}"]`
      );
      if (prefRadio) prefRadio.checked = true;
    }

    // 3. Wybrany wariant oferty (radio skdVariant)
    if (variant) {
      const variantRadio = document.querySelector(
        `input[name="skdVariant"][value="${variant}"]`
      );
      if (variantRadio) variantRadio.checked = true;
    }

    // 4. WPS + odsetki
    if (wps) {
      const wpsForecastInput = document.getElementById("wpsForecastInput");
      const wpsFinalInput = document.getElementById("wpsFinalInput");
      const futureInterestInput = document.getElementById("futureInterestInput");
      const buyoutPctInput = document.getElementById("buyoutPctInput");

      if (wpsForecastInput && wps.forecast != null) {
        wpsForecastInput.value = wps.forecast;
      }
      if (wpsFinalInput && wps.final != null) {
        wpsFinalInput.value = wps.final;
      }
      if (futureInterestInput && wps.futureInterest != null) {
        futureInterestInput.value = wps.futureInterest;
      }
      if (buyoutPctInput && wps.buyoutPct != null) {
        buyoutPctInput.value = wps.buyoutPct;
      }
    }

    // 5. Notatka
    const notesEl = document.getElementById("skdOfferNotes");
    if (notesEl && typeof notes === "string") {
      notesEl.value = notes;
    }

    // 6. Dane do umowy
    if (contract) {
      const contractName = document.getElementById("contractName");
      const contractPesel = document.getElementById("contractPesel");
      const contractAddress = document.getElementById("contractAddress");
      const contractPhone = document.getElementById("contractPhone");
      const contractEmail = document.getElementById("contractEmail");
      const contractIban = document.getElementById("contractIban");

      if (contractName && contract.name != null) contractName.value = contract.name;
      if (contractPesel && contract.pesel != null) contractPesel.value = contract.pesel;
      if (contractAddress && contract.address != null) contractAddress.value = contract.address;
      if (contractPhone && contract.phone != null) contractPhone.value = contract.phone;
      if (contractEmail && contract.email != null) contractEmail.value = contract.email;
      if (contractIban && contract.iban != null) contractIban.value = contract.iban;
    }

    // 7. Pliki – tylko meta, bez realnego uploadu
    const filesList = document.getElementById("caseFilesList");
    const filesEmpty = document.getElementById("caseFilesEmpty");

    if (filesList && filesEmpty) {
      filesList.innerHTML = "";

      if (Array.isArray(filesMeta) && filesMeta.length > 0) {
        filesEmpty.style.display = "none";
        filesMeta.forEach((f) => {
          const li = document.createElement("li");
          li.textContent = `${f.name} (${Math.round((f.size || 0) / 1024)} kB)`;
          filesList.appendChild(li);
        });
      } else {
        filesEmpty.style.display = "";
      }
    }

    const saveBtn = document.getElementById("skdOfferSaveBtn");
    if (saveBtn) {
      saveBtn.style.display = "none";
    }
  }
  function resetSkdOfferForm() {
    // checkboxy
    ["eligSf50", "eligSf49", "eligSell"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });

    // radio
    document
      .querySelectorAll('input[name="clientPref"], input[name="skdVariant"]')
      .forEach((el) => (el.checked = false));

    // inputy / textarea
    [
      "wpsForecastInput",
      "wpsFinalInput",
      "futureInterestInput",
      "buyoutPctInput",
      "skdOfferNotes",
      "contractName",
      "contractPesel",
      "contractAddress",
      "contractPhone",
      "contractEmail",
      "contractIban",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    // pliki
    const filesList = document.getElementById("caseFilesList");
    const filesEmpty = document.getElementById("caseFilesEmpty");
    if (filesList) filesList.innerHTML = "";
    if (filesEmpty) filesEmpty.style.display = "";

    // przycisk Zapisz ukryty na starcie
    const saveBtn = document.getElementById("skdOfferSaveBtn");
    if (saveBtn) {
      saveBtn.style.display = "none";
    }
  }

  // ===== API helper =====
  async function saveSkdOffer(caseId, payload) {
    // UWAGA: tu już NIE dajemy /cases, tylko /api/cases
    const data = await apiFetch(`/api/cases/${caseId}/skd-offer`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    // apiFetch SAM rzuci błąd przy !res.ok, więc jeśli tu doszliśmy → było OK
    return data || {};
  }
  window.saveSkdOffer = saveSkdOffer;
}

(function setupCaseFiles() {
  function init() {
    const input = document.getElementById('caseFilesInput');
    const list = document.getElementById('caseFilesList');
    const empty = document.getElementById('caseFilesEmpty');
    if (!input || !list) return;

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      list.innerHTML = '';
      if (!files.length) {
        empty.style.display = 'block';
        return;
      }
      empty.style.display = 'none';
      files.forEach(f => {
        const li = document.createElement('li');
        li.textContent = `${f.name} (${(f.size / 1024).toFixed(1)} kB)`;
        list.appendChild(li);
      });
    });
  }
  document.addEventListener('DOMContentLoaded', init);
})();

function initSkdOffer_v2(caseData) {
  console.log(
    "%cinitSkdOffer_v2 uruchomione",
    "color:#fff;background:#900;padding:2px 6px;border-radius:4px;"
  );
  console.log("initSkdOffer_v2 → caseData.id =", caseData && caseData.id);

  if (!caseData || !caseData.id) {
    console.warn("initSkdOffer_v2: brak caseData lub id");
    return;
  }

  const root = document.getElementById("skdOffer");
  if (!root) {
    console.warn("initSkdOffer_v2: brak #skdOffer w DOM");
    return;
  }

  // zapamiętujemy ID sprawy
  window.currentCaseId = caseData.id;

  const $ = (sel) => root.querySelector(sel);

  // POLA
  const eligSf50 = $("#eligSf50");
  const eligSf49 = $("#eligSf49");
  const eligSell = $("#eligSell");

  const wpsForecastInput = $("#wpsForecastInput");
  const wpsFinalInput = $("#wpsFinalInput");
  const futureInterestInput = $("#futureInterestInput");
  const buyoutPctInput = $("#buyoutPctInput");
  const notesInput = $("#skdOfferNotes");

  // SYMULACJA WYPŁAT – elementy UI (to Twoje <strong id="...">)
  const simNowEl = document.getElementById("estNow");
  const simLaterEl = document.getElementById("estLater");
  const simTotalEl = document.getElementById("estTotal");

  const variantRadios = root.querySelectorAll('input[name="skdVariant"]');

  // KARTY WARIANTÓW
  const variantCards = {
    sf50: root.querySelector('[data-variant="sf50"]'),
    sf49: root.querySelector('[data-variant="sf49"]'),
    sell: root.querySelector('[data-variant="sell"]'),
  };

  // 🔥 Sterowanie dostępnością wariantów na podstawie checkboxów eligibility
  function refreshVariantAvailabilityFromEligibility() {
    const elig = {
      sf50: !!eligSf50?.checked,
      sf49: !!eligSf49?.checked,
      sell: !!eligSell?.checked,
    };

    if (!variantRadios || !variantRadios.length) return;

    let firstAllowedRadio = null;

    Array.from(variantRadios).forEach((r) => {
      const key = r.value; // spodziewamy się: "sf50", "sf49", "sell"
      const allowed = elig[key] !== false;

      // włącz / wyłącz sam radio
      r.disabled = !allowed;

      // karta wariantu (po prawej) – przyciemniamy gdy niedostępna
      const card = variantCards[key];
      if (card) {
        card.style.opacity = allowed ? "1" : "0.4";
        card.style.pointerEvents = allowed ? "auto" : "none";
      }

      if (allowed && !firstAllowedRadio) {
        firstAllowedRadio = r;
      }
    });

    // jeśli zaznaczony jest wariant niedostępny → przeskocz na pierwszy dostępny
    const currentSelected = Array.from(variantRadios).find((r) => r.checked);
    if (currentSelected && currentSelected.disabled && firstAllowedRadio) {
      currentSelected.checked = false;
      firstAllowedRadio.checked = true;
    }
  }

  // Reakcja na zmianę checkboxów kwalifikacji
  [eligSf50, eligSf49, eligSell].forEach((chk) => {
    if (!chk) return;
    chk.addEventListener("change", () => {
      refreshVariantAvailabilityFromEligibility();
    });
  });
  // POMOCNICZE FUNKCJE
  const toBool = (v, def = true) => {
    if (v === undefined || v === null) return def;
    if (v === true || v === false) return v;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
    if (v === 1) return true;
    if (v === 0) return false;
    return !!v;
  };

  const parseNumber = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const cleaned = String(value).replace(/\s/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
  // Formatowanie liczb jako "15 691"
  function formatPln(n) {
    if (n == null || isNaN(n)) return "—";
    return Number(n).toLocaleString("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  // 🔥 GŁÓWNA FUNKCJA SYMULACJI WYPŁAT
  function recomputePayoutSimulation() {
    // jeśli nie mamy elementów symulacji w DOM → nic nie rób
    if (!simNowEl && !simLaterEl && !simTotalEl) return;

    // 1) WPS bazowy: najpierw ostateczny, potem prognoza
    const wpsFinal = parseNumber(wpsFinalInput?.value);
    const wpsForecast = parseNumber(wpsForecastInput?.value);
    const baseWps = wpsFinal ?? wpsForecast ?? null;

    // 2) Umorzone przyszłe odsetki – zawsze 100% dla klienta
    const futureInterestRaw = parseNumber(futureInterestInput?.value);
    const futureInterest =
      futureInterestRaw && futureInterestRaw > 0 ? futureInterestRaw : 0;

    if (!baseWps || !isFinite(baseWps) || baseWps <= 0) {
      if (simNowEl) simNowEl.textContent = "—";
      if (simLaterEl) simLaterEl.textContent = "—";
      if (simTotalEl) simTotalEl.textContent = "—";
      return;
    }

    // 3) Aktualnie wybrany wariant
    let currentVariant = "sf50";
    if (variantRadios && variantRadios.length) {
      const selected = Array.from(variantRadios).find((r) => r.checked);
      if (selected) currentVariant = selected.value;
    }

    // 4) Gotówka dla klienta: teraz / później
    let now = 0;
    let later = 0;

    if (currentVariant === "sf50") {
      // Success Fee 50/50
      now = 0;
      later = baseWps * 0.5;
    } else if (currentVariant === "sf49") {
      // Success Fee 51% dla klienta
      now = 0;
      later = baseWps * 0.51;
    } else if (currentVariant === "sell") {
      // Sprzedaż roszczenia – klient dostaje kwotę z góry
      const rawPct = parseNumber(buyoutPctInput?.value); // np. 8, 12, 20

      // efektywny procent do obliczeń (twardy zakres 10–15)
      let effectivePct;
      if (rawPct != null && isFinite(rawPct)) {
        effectivePct = Math.min(15, Math.max(10, rawPct));
      } else {
        effectivePct = 10; // domyślnie 10%
      }

      // 🔔 obsługa komunikatu o zakresie
      const warningEl = document.getElementById("buyoutWarning");
      if (warningEl) {
        if (rawPct != null && isFinite(rawPct) && (rawPct < 10 || rawPct > 15)) {
          warningEl.style.display = "block";
        } else {
          warningEl.style.display = "none";
        }
      }

      const clientShare = effectivePct / 100; // 0.10–0.15

      now = baseWps * clientShare;
      later = 0;
    } else {
      // fallback: traktuj jak 50/50
      now = 0;
      later = baseWps * 0.5;
    }

    // 5) Łączna gotówka z WPS:
    const cashTotal = now + later;

    // 6) SUMA DLA KLIENTA = GOTÓWKA + UMORZONE ODSETKI
    const totalWithInterest = cashTotal + futureInterest;

    // 7) Wrzucamy do UI
    if (simNowEl) simNowEl.textContent = formatPln(now) + " zł";
    if (simLaterEl) simLaterEl.textContent = formatPln(later) + " zł";
    if (simTotalEl) simTotalEl.textContent = formatPln(totalWithInterest) + " zł";
  }
  // 🔁 Przeliczanie przy zmianach WPS / odsetek / prowizji / wariantu
  [wpsForecastInput, wpsFinalInput, futureInterestInput, buyoutPctInput].forEach((el) => {
    if (!el) return;
    el.addEventListener("input", () => {
      recomputePayoutSimulation();
    });
  });

  if (variantRadios && variantRadios.length) {
    Array.from(variantRadios).forEach((r) => {
      r.addEventListener("change", () => {
        recomputePayoutSimulation();
      });
    });
  }

  // Pierwsze przeliczenie zaraz po inicjalizacji
  recomputePayoutSimulation();

  // 🔥 CHOWANIE / POKAZYWANIE KAFELKÓW
  const syncVariantVisibility = (eligObj) => {
    if (!eligObj) return;

    const allowed = {
      sf50: toBool(eligObj.sf50, true),
      sf49: toBool(eligObj.sf49, true),
      sell: toBool(eligObj.sell, true),
    };

    if (variantCards.sf50) variantCards.sf50.style.display = allowed.sf50 ? "" : "none";
    if (variantCards.sf49) variantCards.sf49.style.display = allowed.sf49 ? "" : "none";
    if (variantCards.sell) variantCards.sell.style.display = allowed.sell ? "" : "none";

    // jeśli aktualnie wybrany wariant stał się niedozwolony → wybierz pierwszy dostępny
    if (variantRadios && variantRadios.length) {
      const radiosArr = Array.from(variantRadios);
      let current = radiosArr.find((r) => r.checked);

      if (!current || !allowed[current.value]) {
        const firstAllowed = radiosArr.find((r) => allowed[r.value]);
        if (firstAllowed) firstAllowed.checked = true;
      }
    }
  };

  // 🔥 WYPEŁNIENIE FORMULARZA DANYMI
  const applyStateToForm = (state) => {
    if (!state) return;

    const offer = state.offer_skd || {};
    const elig = offer.eligibility || {};

    console.log("SKD_v2 → applyStateToForm, eligibility:", elig);

    // najważniejsze: chowamy / pokazujemy warianty
    syncVariantVisibility(elig);

    // checkboxy
    if (eligSf50) eligSf50.checked = toBool(elig.sf50, true);
    if (eligSf49) eligSf49.checked = toBool(elig.sf49, true);
    if (eligSell) eligSell.checked = toBool(elig.sell, true);

    // kwoty
    if (wpsForecastInput && typeof state.wps_forecast === "number")
      wpsForecastInput.value = String(state.wps_forecast).replace(".", ",");

    if (wpsFinalInput && typeof offer.wps_final === "number")
      wpsFinalInput.value = String(offer.wps_final).replace(".", ",");

    if (futureInterestInput && typeof offer.future_interest === "number")
      futureInterestInput.value = String(offer.future_interest).replace(".", ",");

    if (buyoutPctInput && typeof offer.buyout_pct === "number")
      buyoutPctInput.value = String(offer.buyout_pct * 100);

    if (notesInput) notesInput.value = offer.notes || "";

    // wariant (radio)
    if (variantRadios && offer.variant) {
      variantRadios.forEach((r) => {
        r.checked = r.value === offer.variant;
      });
    }
  };

  // 🔥 DYNAMICZNE REAGOWANIE NA ZMIANĘ CHECKBOXÓW
  [eligSf50, eligSf49, eligSell].forEach((el) => {
    if (!el) return;
    el.addEventListener("change", () => {
      syncVariantVisibility({
        sf50: !!eligSf50.checked,
        sf49: !!eligSf49.checked,
        sell: !!eligSell.checked,
      });
    });
  });

  // 🔥 PRZYCISK "ZAPISZ" – bindowany tylko raz
  const saveBtn = document.getElementById("skdOfferSaveBtn");
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";

    const markDirty = () => {
      saveBtn.style.display = "inline-block";
    };

    root.querySelectorAll("input, textarea, select").forEach((el) => {
      el.addEventListener("input", markDirty);
      el.addEventListener("change", markDirty);
    });

    saveBtn.addEventListener("click", async () => {
      if (!window.currentCaseId) {
        alert("Brak ID sprawy – nie mogę zapisać oferty SKD.");
        return;
      }

      const forecastVal = parseNumber(wpsForecastInput?.value);
      const finalVal = parseNumber(wpsFinalInput?.value);
      const futureInterestVal = parseNumber(futureInterestInput?.value);

      // jeśli jest WPS ostateczny → on rządzi, inaczej prognoza
      const wpsForecast = finalVal ?? forecastVal ?? null;

      // wariant
      let selectedVariant = "sf50";
      const selectedRadio = Array.from(variantRadios || []).find((r) => r.checked);
      if (selectedRadio) selectedVariant = selectedRadio.value;

      const buyoutPctRaw = parseNumber(buyoutPctInput?.value);

      const offerData = {
        variant: selectedVariant,
        upfront_fee: null,
        buyout_pct: buyoutPctRaw != null ? buyoutPctRaw / 100 : null,
        notes: notesInput?.value || "",
        eligibility: {
          sf50: !!eligSf50?.checked,
          sf49: !!eligSf49?.checked,
          sell: !!eligSell?.checked,
        },
        wps_final: finalVal,
        future_interest: futureInterestVal,
        estimates: {},
      };

      // 🔥 PODPIĘCIE WPS POD OFERTĘ (jak miałeś wcześniej)
      if (wpsForecast != null) {
        offerData.estimates.wps_forecast = wpsForecast;

        if (offerData.buyout_pct != null) {
          const w = Number(wpsForecast);
          const p = offerData.buyout_pct;

          offerData.estimates.sell_client_amount = Math.round(w * (1 - p));
          offerData.estimates.sell_gross = Math.round(w * p);
        }
      }

      console.log("▶ Zapis SKD dla sprawy", window.currentCaseId, {
        wps_forecast: wpsForecast,
        offer_skd: offerData,
      });

      try {
        await saveSkdOffer(window.currentCaseId, {
          wps_forecast: wpsForecast,
          offer_skd: offerData,
        });

        console.log("✅ Oferta SKD zapisana poprawnie");
        saveBtn.style.display = "none";
      } catch (err) {
        console.error("❌ Błąd zapisu oferty SKD:", err);
        alert("Nie udało się zapisać oferty SKD. Sprawdź konsolę.");
      }
    });

  }

  // 🔥 1) ZAŁADUJ DANE Z caseData — BEZ normalizeSkdOffer
  const initialState = {
    // WPS prognoza z caseData (kolumna w bazie)
    wps_forecast:
      caseData.wps_forecast !== undefined && caseData.wps_forecast !== null
        ? caseData.wps_forecast
        : null,
    // Reszta oferty z caseData (offer_skd z bazy)
    ...(caseData.offer_skd || {}),
  };

  console.log("SKD_v2 initialState z caseData:", initialState);
  applyStateToForm(initialState);

  // 🔥 2) NADPISZ DANYMI Z BACKENDU
  (async () => {
    try {
      const res = await fetch(`/api/cases/${caseData.id}/skd-offer`);
      if (!res.ok) return;

      const data = await res.json();
      console.log("SKD_v2: wczytuję ofertę z backendu:", data);

      const apiState = {
        wps_forecast:
          data.wps_forecast !== undefined && data.wps_forecast !== null
            ? data.wps_forecast
            : null,
        ...(data.offer_skd || {}),
      };

      console.log("SKD_v2 (API) →", apiState);
      applyStateToForm(apiState);

      // 🔥 RĘCZNE ODTWORZENIE OFERTY SKD W FORMULARZU
      const offer = data.offer_skd || {};

      try {
        // 1) WPS (prognoza)
        if (typeof wpsForecastInput !== "undefined" && wpsForecastInput) {
          const wpsValue =
            apiState.wps_forecast ??
            (offer.estimates && offer.estimates.wps_forecast) ??
            data.wps_forecast ??
            null;

          if (wpsValue != null) {
            wpsForecastInput.value = wpsValue;
          } else {
            wpsForecastInput.value = "";
          }
        }

        // 2) Wariant (sf50 / sf49 / sell)
        if (
          typeof variantRadios !== "undefined" &&
          variantRadios &&
          variantRadios.length
        ) {
          const v = offer.variant || apiState.variant || "sf50";
          Array.from(variantRadios).forEach((r) => {
            r.checked = r.value === v;
          });
        }

        // 3) Procent wykupu (formularz ma %, w bazie 0.1 itp.)
        if (typeof buyoutPctInput !== "undefined" && buyoutPctInput) {
          const buyoutPct =
            typeof offer.buyout_pct === "number"
              ? offer.buyout_pct
              : typeof apiState.buyout_pct === "number"
                ? apiState.buyout_pct
                : null;

          if (buyoutPct != null) {
            buyoutPctInput.value = String(Math.round(buyoutPct * 100));
          } else {
            buyoutPctInput.value = "";
          }
        }
        // 3b) Przyszłe odsetki (future_interest)
        if (typeof futureInterestInput !== "undefined" && futureInterestInput) {
          let fi = null;

          // Najpierw bierz z offer.future_interest (czyli z offer_skd)
          if (offer.future_interest !== undefined && offer.future_interest !== null) {
            fi = offer.future_interest;
          }
          // ewentualny fallback, gdybyś kiedyś miał to spłaszczone w apiState
          else if (apiState.future_interest !== undefined && apiState.future_interest !== null) {
            fi = apiState.future_interest;
          }

          if (fi !== null) {
            futureInterestInput.value = String(fi).replace(".", ",");
          } else {
            futureInterestInput.value = "";
          }
        }
        // 4) Eligibility (checkboxy)
        if (offer.eligibility) {
          if (
            typeof eligSf50 !== "undefined" &&
            eligSf50 &&
            typeof offer.eligibility.sf50 !== "undefined"
          ) {
            eligSf50.checked = !!offer.eligibility.sf50;
          }
          if (
            typeof eligSf49 !== "undefined" &&
            eligSf49 &&
            typeof offer.eligibility.sf49 !== "undefined"
          ) {
            eligSf49.checked = !!offer.eligibility.sf49;
          }
          if (
            typeof eligSell !== "undefined" &&
            eligSell &&
            typeof offer.eligibility.sell !== "undefined"
          ) {
            eligSell.checked = !!offer.eligibility.sell;
          }
        }

        // 5) Notatki
        if (typeof notesInput !== "undefined" && notesInput) {
          notesInput.value = offer.notes || apiState.notes || "";
        }
        refreshVariantAvailabilityFromEligibility();
        // 🔥 po odtworzeniu oferty – przelicz symulację wypłat
        recomputePayoutSimulation();
        console.log("SKD_v2: UI po odtworzeniu oferty:", {
          wpsForecast: wpsForecastInput?.value,
          variant: offer.variant,
          buyout_pct: offer.buyout_pct,
          eligibility: offer.eligibility,
          notes: offer.notes,
        });
      } catch (e) {
        console.warn("SKD_v2: błąd przy ręcznym odtwarzaniu oferty:", e);
      }
    } catch (err) {
      console.error("SKD_v2: błąd pobierania oferty:", err);
    }
  })();
}

window.initSkdOffer = initSkdOffer_v2;
// nadpisujemy starą nazwę funkcji, żeby wszystko używało v2
try {
  initSkdOffer = initSkdOffer_v2;
} catch (e) {
  console.warn("Nie udało się nadpisać initSkdOffer:", e);
}

// ← domknięcie brakującego bloku, np. funkcji lub DOMContentLoaded

// ===============================
//   WPS BASIC — obsługa UI + zapis + oferta SKD
// ===============================
let lastWpsBasic = null;

(function setupWpsBasicUI() {
  const btnCalc = document.getElementById("wpsCalcBtn");
  if (!btnCalc) return; // jeśli nie ma panelu, nic nie rób

  const btnSave = document.getElementById("wpsSaveBtn");
  const btnApply = document.getElementById("wpsApplyToSkdBtn");
  const loanNetInput = document.getElementById("wpsLoanNet");
  const loanTotalInput = document.getElementById("wpsLoanTotal");
  const termInput = document.getElementById("wpsLoanTerm");
  const paidInput = document.getElementById("wpsInstallmentsPaid");
  const installmentRealInput = document.getElementById("wpsInstallmentReal");
  const resultEl = document.getElementById("wpsResultValue");
  const interestInput = document.getElementById("wpsInterestInput");

  // 🔹 ID sprawy – z pola, window.caseData albo URL
  function resolveCaseId() {
    let caseId = null;

    const caseIdInput = document.getElementById("wpsCaseId");
    if (caseIdInput && caseIdInput.value) {
      const parsed = Number(caseIdInput.value);
      if (Number.isFinite(parsed)) caseId = parsed;
    }

    if (!caseId && window.caseData && window.caseData.id) {
      const parsed = Number(window.caseData.id);
      if (Number.isFinite(parsed)) caseId = parsed;
    }

    if (!caseId) {
      const path = window.location.pathname;
      const matches = path.match(/\d+/g);
      if (matches && matches.length > 0) {
        const last = Number(matches[matches.length - 1]);
        if (Number.isFinite(last)) caseId = last;
      }
    }

    return caseId;
  }

  function parseNumber(el) {
    if (!el) return null;
    const raw = (el.value || "").toString().replace(",", ".").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  // 🔹 Odczyt parametrów kredytu z localStorage (per sprawa)
  function loadWpsInputsFromStorage() {
    const caseId = resolveCaseId();
    if (!caseId) return;

    const raw = localStorage.getItem(`wps_basic_inputs:${caseId}`);
    if (!raw) return;

    try {
      const data = JSON.parse(raw);
      if (loanNetInput && data.loan_amount_net != null) loanNetInput.value = data.loan_amount_net;
      if (loanTotalInput && data.loan_amount_total != null) loanTotalInput.value = data.loan_amount_total;
      if (termInput && data.loan_term_months != null) termInput.value = data.loan_term_months;
      if (paidInput && data.installments_paid != null) paidInput.value = data.installments_paid;
      if (installmentRealInput && data.installment_amount_real != null) installmentRealInput.value = data.installment_amount_real;
      if (interestInput && data.interest_nominal != null) interestInput.value = data.interest_nominal;
    } catch (e) {
      console.warn("WPS: nie udało się odczytać localStorage:", e);
    }
  }

  // 🔹 Zapis parametrów kredytu do localStorage (per sprawa)
  function saveWpsInputsToStorage() {
    const caseId = resolveCaseId();
    if (!caseId) return;

    const payload = {
      loan_amount_net: loanNetInput?.value || "",
      loan_amount_total: loanTotalInput?.value || "",
      loan_term_months: termInput?.value || "",
      installments_paid: paidInput?.value || "",
      installment_amount_real: installmentRealInput?.value || "",
      interest_nominal: interestInput?.value || "",
    };

    try {
      localStorage.setItem(`wps_basic_inputs:${caseId}`, JSON.stringify(payload));
    } catch (e) {
      console.warn("WPS: nie udało się zapisać localStorage:", e);
    }
  }
  // Udostępniamy helper globalnie, żeby można go było wywołać przy otwarciu modala
  window.PK_WPS = window.PK_WPS || {};
  window.PK_WPS.reloadForCurrentCase = loadWpsInputsFromStorage;

  // 🔥 Na starcie spróbuj odtworzyć wpisane wcześniej dane
  loadWpsInputsFromStorage();

  // 1) wylicz ratę z oprocentowania, jeśli trzeba
  if (interestInput && installmentRealInput) {
    interestInput.addEventListener("input", () => {
      const interest = parseNumber(interestInput);
      const total = parseNumber(loanTotalInput);
      const term = parseNumber(termInput);

      if (!interest || !total || !term) return;

      const r = (interest / 100) / 12; // miesięczna stopa
      const monthly = total * (r / (1 - Math.pow(1 + r, -term)));

      if (Number.isFinite(monthly)) {
        installmentRealInput.value = monthly.toFixed(2);
      }
    });
  }

  // 2) PRZELICZ WPS
  btnCalc.addEventListener("click", () => {
    const loan_amount_net = parseNumber(loanNetInput);
    const loan_amount_total = parseNumber(loanTotalInput);
    const loan_term_months = parseNumber(termInput);
    const installments_paid = parseNumber(paidInput);
    const installment_amount_real = parseNumber(installmentRealInput);

    if (!loan_amount_net || !loan_term_months || !installments_paid) {
      alert("Uzupełnij kwotę netto, okres kredytu i liczbę zapłaconych rat.");
      return;
    }

    if (!installment_amount_real && !loan_amount_total) {
      alert("Podaj ratę faktyczną ALBO kwotę całkowitą umowy (żeby ją wyliczyć).");
      return;
    }

    const wps = calculateWpsBasic({
      loan_amount_net,
      loan_amount_total,
      loan_term_months,
      installments_paid,
      installment_amount_real,
    });

    if (wps === null) {
      resultEl.textContent = "brak danych";
      lastWpsBasic = null;
      if (btnSave) btnSave.disabled = true;
      if (btnApply) btnApply.disabled = true;
      return;
    }

    lastWpsBasic = wps;

    const formatted = wps.toLocaleString("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    resultEl.textContent = `${formatted} zł`;

    if (btnSave) btnSave.disabled = false;
    if (btnApply) btnApply.disabled = false;

    // 💾 zapisz wprowadzone dane kredytu dla tej sprawy
    saveWpsInputsToStorage();
  });

  // 3) ZAPISZ WPS DO SPRAWY (PATCH)
  if (btnSave) {
    btnSave.addEventListener("click", async () => {
      if (!lastWpsBasic) {
        alert("Najpierw przelicz WPS.");
        return;
      }

      const caseId = resolveCaseId();
      if (!caseId) {
        alert("Brak ID sprawy – nie mogę zapisać WPS.");
        return;
      }

      btnSave.disabled = true;
      btnSave.textContent = "Zapisywanie...";

      try {
        const res = await fetch(`/api/cases/${caseId}/wps-basic`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wps_forecast: lastWpsBasic }),
        });

        if (!res.ok) {
          console.error("Błąd zapisu WPS:", res.status);
          alert("Nie udało się zapisać WPS. Spróbuj ponownie.");
          return;
        }

        alert("WPS został zapisany do sprawy.");
      } catch (err) {
        console.error("Błąd zapisu WPS:", err);
        alert("Wystąpił błąd przy zapisie WPS.");
      } finally {
        btnSave.disabled = false;
        btnSave.textContent = "Zapisz WPS do sprawy";
      }
    });
  }

  // 4) UŻYJ WPS W OFERCIE SKD
  if (btnApply) {
    btnApply.addEventListener("click", () => {
      if (!lastWpsBasic) {
        alert("Najpierw przelicz WPS.");
        return;
      }

      const wpsInput =
        document.querySelector('[data-skd-field="wps_forecast"]') ||
        document.getElementById("skdWpsForecast");

      if (!wpsInput) {
        alert("Nie znaleziono pola WPS w ofercie SKD (wps_forecast).");
        return;
      }

      wpsInput.value = lastWpsBasic;

      try {
        if (typeof window.syncSkdFormToState === "function") {
          window.syncSkdFormToState();
        }
      } catch (e) {
        console.warn("syncSkdFormToState rzucił błąd:", e);
      }

      alert("WPS został przepisany do oferty SKD.");
    });
  }
})(); // ← DOMKNIĘCIE IIFE setupWpsBasicUI (BARDZO WAŻNE)

// ===== Ostrzeżenie przy opuszczaniu strony, gdy oferta SKD ma niezapisane zmiany =====
window.addEventListener("beforeunload", (e) => {
  try {
    if (!window.PK_SKD || typeof PK_SKD._getCtx !== "function") return;
    const ctx = PK_SKD._getCtx();
    if (!ctx || !ctx.dirty) return;

    e.preventDefault();
    e.returnValue =
      "Masz niezapisane zmiany w ofercie SKD. Na pewno chcesz opuścić stronę?";
  } catch {
    // w razie czego nie blokujemy wyjścia
  }
});

// ==========================================
//    DELETE CASE + POWIADOMIENIA
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("deleteCaseBtn");
  console.log("[caseDelete] init, btn =", btn);

  // ⬇️ Jeśli przycisk istnieje → podpinamy kasowanie
  if (btn) {
    btn.addEventListener("click", async () => {
      console.log("[caseDelete] klik!");
      let caseId = null;

      // 1) spróbuj z ukrytego pola
      const caseIdInput = document.getElementById("wpsCaseId");
      if (caseIdInput && caseIdInput.value) {
        const parsed = Number(caseIdInput.value);
        if (Number.isFinite(parsed)) caseId = parsed;
      }

      // 2) fallback: window.currentCaseId
      if (!caseId && window.currentCaseId) {
        const parsed = Number(window.currentCaseId);
        if (Number.isFinite(parsed)) caseId = parsed;
      }

      // 3) fallback: z URL
      if (!caseId) {
        const path = window.location.pathname;
        const matches = path.match(/\d+/g);
        if (matches && matches.length > 0) {
          const last = Number(matches[matches.length - 1]);
          if (Number.isFinite(last)) caseId = last;
        }
      }

      console.log("[caseDelete] caseId →", caseId);

      if (!caseId) {
        alert("Brak ID sprawy – nie mogę usunąć.");
        return;
      }

      // triple confirm
      if (!confirm("Czy na pewno chcesz usunąć tę sprawę?")) return;
      if (!confirm("Ta operacja jest nieodwracalna. Usunąć?")) return;

      const phrase = prompt('Aby potwierdzić, wpisz słowo: USUŃ');
      if (!phrase || phrase.trim().toUpperCase() !== "USUŃ") {
        alert("Nie potwierdziłeś usunięcia.");
        return;
      }

      try {
        const res = await fetch(`/api/cases/${caseId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          console.error("Błąd podczas usuwania sprawy:", res.status);
          alert("Błąd podczas usuwania sprawy.");
          return;
        }

        alert("Sprawa została trwale usunięta.");
        window.location.href = "/dashboard.html";
      } catch (e) {
        console.error("Błąd DELETE:", e);
        alert("Nie udało się usunąć sprawy.");
      }
    });
  }

  // ============================
  // POWIADOMIENIA
  // ============================

  async function fetchNotifications(onlyUnread = true) {
    try {
      const res = await fetch(
        `/api/notifications?onlyUnread=${onlyUnread ? "1" : "0"}`,
        { credentials: "include" }
      );

      const data = await res.json();
      if (!data.ok) return;

      const items = data.items;
      const badge = document.getElementById("notificationsBadge");
      const list = document.getElementById("notificationsList");

      // Badge
      if (items.length > 0) {
        badge.style.display = "inline-block";
        badge.textContent = items.length > 9 ? "9+" : items.length;
      } else {
        badge.style.display = "none";
      }

      // Lista
      list.innerHTML = "";
      items.forEach((n) => {
        const div = document.createElement("div");
        div.className = "notif-item unread";
        div.dataset.id = n.id;
        div.innerHTML = `
          <div>${n.title}</div>
          <div class="notif-item-time">${new Date(n.created_at).toLocaleString()}</div>
          <div style="font-size:12px; color:#555">${n.body}</div>
        `;
        div.addEventListener("click", () => {
          markNotificationsRead([n.id]);
          div.classList.remove("unread");
        });
        list.appendChild(div);
      });
    } catch (err) {
      console.error("fetchNotifications error:", err);
    }
  }

  async function markNotificationsRead(ids) {
    await fetch("/api/notifications/read", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });

    fetchNotifications(true);
  }

  function initNotifications() {
    const btnNotif = document.getElementById("notificationsButton");
    const panel = document.getElementById("notificationsPanel");

    if (!btnNotif || !panel) return;

    btnNotif.addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";

      if (panel.style.display === "block") {
        fetchNotifications(true);
      }
    });

    // initial fetch
    fetchNotifications(true);

    // auto-refresh co 60 sek
    setInterval(() => fetchNotifications(true), 60000);
  }

  initNotifications();
});

