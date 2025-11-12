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

// === User Role Context ===
const USER_ROLE = document.body.dataset.role || 'agent';
const IS_ADMIN = USER_ROLE === 'admin';
console.log('Zalogowany jako:', USER_ROLE);

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
const log  = (...a) => FLAGS.VERBOSE_LOGS && console.log('[PK]', ...a);
const warn = (...a) => console.warn('[PK:WARN]', ...a);
const err  = (...a) => console.error('[PK:ERR]', ...a);

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
function authHeaders() {
  return { Authorization: "Bearer " + localStorage.getItem("pk_token") };
}
async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders() },
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
  return Number.isFinite(num) ? num.toLocaleString('pl-PL', { style:'currency', currency:'PLN' }) : String(n);
}
function pickStatus(row) {
  return row?.status || row?.state || row?.stan || '—';
}


// === Ładowanie pełnej listy spraw + Blok C ===
async function loadAndRenderAllCases() {
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
function getOffers(ctx){
  const { bank, status, wps=0, loan_amount=0 } = ctx;
  const out = [];
  if (status === 'w toku' || status === 'analiza') {
    out.push({ name:'Zwrot prowizji', meta:'Wypłata w 7–14 dni', cta:'Zleć analizę' });
  }
  if (wps >= 5000) {
    out.push({ name:'SKD — Sankcja Kredytu Darmowego', meta:`Szac. WPS: ${Number(wps).toLocaleString('pl-PL')} PLN`, cta:'Sprawdź kwalifikację' });
  }
  if (loan_amount >= 20000) {
    out.push({ name:'Ugoda refinansująca', meta:`Kwota kredytu: ${Number(loan_amount).toLocaleString('pl-PL')} PLN`, cta:'Zapytaj o warunki' });
  }
  if (/mBank|Santander|PKO|ING|Millennium|Pekao/i.test(bank || '')) {
    out.push({ name:`Oferta dedykowana — ${bank}`, meta:'Specjalne warunki partnera', cta:'Kontakt z opiekunem' });
  }
  if (!out.length) out.push({ name:'Brak gotowych dopasowań', meta:'Doprecyzuj dane klienta', cta:'Otwórz pełny widok' });
  return out;
}
function renderOffers(ctx){
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
  const token = localStorage.getItem('pk_token');
  if (!token) {
    location.href = '/login.html';
    return false;
  }
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
        const bankStr   = c.bank ? String(c.bank) : '—';
        const amountStr = (c.loan_amount ?? c.amount ?? null) != null ? fmtPL(c.loan_amount ?? c.amount) : '—';
        const wpsStr    = (c.wps ?? '') !== '' ? fmtPL(c.wps) : '—';
        const statusStr = String(c.status || '—');
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

  // klikalne KPI (zakładam że masz już setActiveKpi/applyStatusFilter)
  document.querySelectorAll('#kpiBar .kpi-card').forEach(card => {
    card.addEventListener('click', () => {
      const code = card.dataset.status || '';
      applyStatusFilter(code);
    });
  });

  setActiveKpi('');
}

function bindModalAndLogout() {
  const cmCloseEl = document.getElementById('cmClose');
  const cmModal = document.getElementById('caseModal');
  if (cmCloseEl && cmModal) {
    cmCloseEl.addEventListener('click', () => (cmModal.style.display = 'none'));
    cmModal.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-backdrop')) cmModal.style.display = 'none';
    });
  }

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
  });
}
// ===== BOOT MODULES — END =====

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
  const wpsSum  = sumNum(list, (x) => x.wps);
  const loanSum = sumNum(list, (x) => x.loan_amount ?? x.amount);
  const wpsCnt  = list.reduce((n, x) => n + (x.wps !== null && x.wps !== undefined && x.wps !== "" ? 1 : 0), 0);
  const wpsAvg  = wpsCnt ? wpsSum / wpsCnt : 0;
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
    Array.isArray(data)        ? data        : [];

  window.__PK_ITEMS_ALL__ = itemsAll; // przyda się do ponownego przeliczenia KPI
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
      const bankStr   = c.bank ? String(c.bank) : '—';
      const amountStr = (c.loan_amount ?? c.amount ?? null) != null ? fmtPL(c.loan_amount ?? c.amount) : '—';
      const wpsStr    = (c.wps ?? '') !== '' ? fmtPL(c.wps) : '—';
      const statusStr = String(c.status || '—');

      return `
<tr data-id="${c.id ?? ''}">
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


  // Dodawanie sprawy (prawa kolumna)
  const addBtn = document.getElementById("addCaseBtn");
  const addClientEl = document.getElementById("addClient");
  const addAmountEl = document.getElementById("addAmount");
  const addBankEl = document.getElementById("addBank");

  addBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const client = addClientEl?.value?.trim() || "";
    const amountRaw = (addAmountEl?.value || "").replace(",", ".");
    const amount = parseFloat(amountRaw);
    const bank = addBankEl?.value || "";
    if (!client) return alert("Podaj klienta");
    if (Number.isNaN(amount)) return alert("Podaj poprawną kwotę");

    const payload = {
      client,
      loan_amount: amount,
      status: "nowa",
      bank: bank || null,
    };
    try {
      await fetchJSON("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      addClientEl.value = "";
      addAmountEl.value = "";
      addBankEl.value = "";
      const flt = document.getElementById("flt_status");
      if (flt) flt.value = "";
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

      (document.getElementById('cmInfoClient')  || {}).textContent = data.client || '—';
      (document.getElementById('cmInfoBank')    || {}).textContent = data.bank || '—';
      (document.getElementById('cmInfoAmount')  || {}).textContent = data.loan_amount == null ? '—' : Number(data.loan_amount).toLocaleString('pl-PL');
      (document.getElementById('cmInfoWps')     || {}).textContent = data.wps == null ? '—' : Number(data.wps).toLocaleString('pl-PL');
      (document.getElementById('cmInfoStatus')  || {}).textContent = data.status || '—';
      (document.getElementById('cmInfoDate')    || {}).textContent = data.contract_date || '—';
      (document.getElementById('cmInfoPhone')   || {}).textContent = data.phone || '—';
      (document.getElementById('cmInfoEmail')   || {}).textContent = data.email || '—';
      (document.getElementById('cmInfoAddress') || {}).textContent = data.address || '—';

      renderOffers({
        bank: data.bank || '',
        status: (data.status || '').toLowerCase(),
        wps: Number(data.wps || 0),
        loan_amount: Number(data.loan_amount || 0)
      });

      document.getElementById('openFullCase')?.addEventListener('click', (e) => {
        e.preventDefault();
        const cid = String(data.id || caseId);
        window.open(`/case.html?id=${encodeURIComponent(cid)}`, '_blank');
      });

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

// ===== Zamknięcie modala (X i backdrop) =====
const cmCloseEl = document.getElementById("cmClose");
if (cmCloseEl && cmModal) {
  cmCloseEl.addEventListener("click", () => (cmModal.style.display = "none"));
  cmModal.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) cmModal.style.display = "none";
  });
}

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
    const cmDate   = document.getElementById("cmDate");
    const cmBank   = document.getElementById("cmBank");

    const wpsRaw    = document.getElementById("cmWps")?.value?.trim() ?? "";
    const statusVal = document.getElementById("cmStatus")?.value ?? "nowa";
    const amountRaw = cmAmount ? cmAmount.value.trim() : "";
    const dateRaw   = cmDate ? cmDate.value.trim() : "";

    const normNum = (v) => {
      if (v === "" || v == null) return null;
      const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const wpsNorm    = normNum(wpsRaw);
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
      await fetchJSON(`/api/cases/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
  "PKO BP","Santander","mBank","ING","Alior","Millennium","BNP Paribas",
  "Credit Agricole","BOŚ","Pekao SA","Nest Bank","Citi Handlowy","VeloBank"
];

// === Modal SKD (blok 1/3): bootstrap + template + render (bez zapisu do API) ===
(function skdBootstrap(){
  const $ = (id)=>document.getElementById(id);
  const money = (n)=> (n==null || Number.isNaN(+n)) ? '' : (+n).toFixed(2);
  const STATUS = [
    {v:'draft',l:'Szkic'},{v:'sent',l:'Wysłana'},{v:'accepted',l:'Zaakceptowana'},
    {v:'declined',l:'Odrzucona'},{v:'archived',l:'Zarchiwizowana'}
  ];
  const ctx = { offer:null, role:'agent', dirty:false };
  window.PK_SKD = window.PK_SKD || {};
  window.PK_SKD._getCtx = ()=>ctx;

  // ——— wstrzyknięcie szablonu (tylko jeśli brak) ———
  function ensureTemplate(){
    if ($('skdOfferModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
<div id="skdOfferModal" class="modal" style="display:none;">
  <div class="modal-dialog" style="background:#fff;border-radius:14px;box-shadow:0 10px 28px rgba(0,0,0,.15);max-width:980px;margin:40px auto;overflow:hidden">
    <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f8f9fb">
      <h3 style="margin:0;font-weight:700;">Oferta SKD</h3>
      <button class="modal-close" aria-label="Zamknij" style="background:transparent;border:0;font-size:20px;cursor:pointer">×</button>
    </div>

    <div class="modal-tabs" style="display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid #e6e8ec">
      <button class="tab active" data-tab="summary" style="padding:6px 10px;border:1px solid #e6e8ec;border-bottom:0;border-radius:8px 8px 0 0;background:#fff;font-weight:700;cursor:pointer">Podsumowanie</button>
      <button class="tab" data-tab="params"  style="padding:6px 10px;border:1px solid #e6e8ec;border-bottom:0;border-radius:8px 8px 0 0;background:#fafbfc;cursor:pointer">Parametry</button>
      <button class="tab" data-tab="schedule"style="padding:6px 10px;border:1px solid #e6e8ec;border-bottom:0;border-radius:8px 8px 0 0;background:#fafbfc;cursor:pointer">Harmonogram</button>
      <button class="tab" data-tab="history" style="padding:6px 10px;border:1px solid #e6e8ec;border-bottom:0;border-radius:8px 8px 0 0;background:#fafbfc;cursor:pointer">Historia</button>
    </div>

    <div class="modal-body" style="padding:14px 16px">
      <section class="tab-panel" id="skdTab-summary">
        <div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Klient</label><div id="skdClientName">—</div></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Status</label><select id="skdStatus" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></select></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Wariant</label>
            <select id="skdVariant" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px">
              <option value="success_fee">Prowizja za sukces</option>
              <option value="upfront_buyout">Wykup z góry</option>
            </select>
          </div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Bank</label><select id="skdBank" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></select></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">WPS (prognoza)</label><input id="skdWpsForecast" type="number" step="0.01" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Prowizja (%)</label><input id="skdFeePercent" type="number" step="0.1" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Prowizja (PLN)</label><input id="skdFeeAmount" type="number" step="0.01" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Ważna do</label><input id="skdValidUntil" type="date" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
        </div>
      </section>

      <section class="tab-panel" id="skdTab-params" style="display:none">
        <div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Kwota kredytu (PLN)</label><input id="skdLoanAmount" type="number" step="0.01" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Okres (m-ce)</label><input id="skdTenor" type="number" step="1" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">RRSO (%)</label><input id="skdApr" type="number" step="0.01" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></div>
          <div><label style="display:block;font-size:.86rem;color:#556;opacity:.9;margin-bottom:4px">Uwagi wewnętrzne</label><textarea id="skdInternalNote" rows="3" style="width:100%;padding:8px;border:1px solid #dde0e6;border-radius:8px"></textarea></div>
        </div>
      </section>

      <section class="tab-panel" id="skdTab-schedule" style="display:none"><pre id="skdScheduleBox" style="white-space:pre-wrap;margin:0;color:#667085">Brak harmonogramu do wyświetlenia.</pre></section>
      <section class="tab-panel" id="skdTab-history"  style="display:none"><ol id="skdHistoryList" style="margin:0;padding-left:18px"></ol></section>
    </div>

    <div class="modal-footer" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f8f9fb">
      <div id="skdDirtyHint" style="display:none;color:#667085">Niezapisane zmiany…</div>
      <div>
        <button id="skdDeleteBtn" style="padding:8px 12px;border-radius:10px;border:0;background:#ef4444;color:#fff;cursor:pointer;display:none">Usuń</button>
        <button id="skdSaveBtn"   style="padding:8px 12px;border-radius:10px;border:0;background:#2f6fed;color:#fff;cursor:pointer">Zapisz</button>
      </div>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap.firstElementChild);
  }

  // ——— util: readOnly/disabled wg roli ———
  function setRO(node, flag){ if(!node) return; node.readOnly=!!flag; node.disabled=!!flag; }
  function computeFee(o){ return (o && o.wps_forecast && o.fee_percent) ? (Number(o.wps_forecast)*Number(o.fee_percent)/100) : null; }
  function setDirty(f){ const hint=$('skdDirtyHint'); if(hint) hint.style.display=f?'block':'none'; ctx.dirty=!!f; }

  // ——— lista banków (globalna lub API, z fallbackiem) ———
  async function loadBanks(){
    if (Array.isArray(window.bankList) && window.bankList.length) return window.bankList;
    try{ const r=await fetch('/api/banks'); if(!r.ok) throw 0; const d=await r.json(); window.bankList=d; return d; }
    catch(_){ return ["PKO BP","Santander","mBank","ING","Alior","Millennium","BNP Paribas"]; }
  }

  // ——— render ———
  async function render(){
    const o = ctx.offer || {};
    $('skdClientName').textContent = o.client_name || '—';

    // status
    const st = $('skdStatus'); st.innerHTML='';
    STATUS.forEach(s=>{ const opt=document.createElement('option'); opt.value=s.v; opt.textContent=s.l; if(o.status===s.v) opt.selected=true; st.appendChild(opt); });

    // wariant + bank
    $('skdVariant').value = o.variant || 'success_fee';
    const bl = await loadBanks(); const bs = $('skdBank'); bs.innerHTML='';
    bl.forEach(b=>{ const opt=document.createElement('option'); opt.value=b; opt.textContent=b; if(o.bank===b) opt.selected=true; bs.appendChild(opt); });

    // liczby / daty / notatka
    $('skdWpsForecast').value = o.wps_forecast ?? '';
    $('skdFeePercent').value  = o.fee_percent ?? '';
    $('skdFeeAmount').value   = o.fee_amount ?? '';
    $('skdValidUntil').value  = (o.valid_until||'').substring(0,10);
    $('skdLoanAmount').value  = o.loan_amount ?? '';
    $('skdTenor').value       = o.tenor_months ?? '';
    $('skdApr').value         = o.apr_percent ?? '';
    $('skdInternalNote').value= o.internal_note ?? '';

    // schedule
    const sb = $('skdScheduleBox');
    if (Array.isArray(o.schedule) && o.schedule.length){
      sb.textContent = o.schedule.map(r=>`${r.no}. ${r.date} — ${money(r.amount)} PLN`).join('\n');
    } else { sb.textContent = 'Brak harmonogramu do wyświetlenia.'; }

    // historia
    const hl = $('skdHistoryList'); hl.innerHTML='';
    (o.history||[]).slice().reverse().forEach(h=>{
      const li=document.createElement('li');
      li.textContent = `${new Date(h.ts).toLocaleString()} — ${h.by}: ${h.msg}`;
      hl.appendChild(li);
    });

    // role
    const isAdmin = ctx.role === 'admin';
    ['skdStatus','skdBank','skdWpsForecast','skdFeePercent','skdFeeAmount','skdValidUntil','skdLoanAmount','skdTenor','skdApr'].forEach(id=> setRO($(id), !isAdmin));
    setRO($('skdVariant'), false);
    setRO($('skdInternalNote'), false);
    $('skdDeleteBtn').style.display = isAdmin ? 'inline-block' : 'none';

    bindInputs(); setDirty(false);
        window.dispatchEvent(new Event('pk_skd_render'));

  }

  // ——— eventy pól (lokalne, bez API) ———
  function bindInputs(){
    const bind = (id, fn)=>{ const n=$(id); if(!n) return; n.oninput = n.onchange = fn; };
    bind('skdStatus', ()=>{ ctx.offer.status = $('skdStatus').value; setDirty(true); });
    bind('skdVariant',()=>{ ctx.offer.variant= $('skdVariant').value; setDirty(true); });
    bind('skdBank',   ()=>{ ctx.offer.bank   = $('skdBank').value; setDirty(true); });

    bind('skdWpsForecast', ()=>{ ctx.offer.wps_forecast = +$('skdWpsForecast').value || null; recalcFee(); setDirty(true); });
    bind('skdFeePercent',  ()=>{ ctx.offer.fee_percent  = +$('skdFeePercent').value  || null; recalcFee(); setDirty(true); });
    bind('skdFeeAmount',   ()=>{ ctx.offer.fee_amount   = +$('skdFeeAmount').value   || null; setDirty(true); });

    bind('skdValidUntil',  ()=>{ ctx.offer.valid_until  = $('skdValidUntil').value; setDirty(true); });
    bind('skdLoanAmount',  ()=>{ ctx.offer.loan_amount  = +$('skdLoanAmount').value || null; setDirty(true); });
    bind('skdTenor',       ()=>{ ctx.offer.tenor_months = +$('skdTenor').value      || null; setDirty(true); });
    bind('skdApr',         ()=>{ ctx.offer.apr_percent  = +$('skdApr').value        || null; setDirty(true); });
    bind('skdInternalNote',()=>{ ctx.offer.internal_note= $('skdInternalNote').value; setDirty(true); });

    $('skdSaveBtn').onclick   = ()=> alert('Zapis pojawi się w bloku 2 (PUT /api/offers/:id).');
    $('skdDeleteBtn').onclick = ()=> alert('Usuwanie pojawi się w bloku 2 (DELETE /api/offers/:id).');
  }

  function recalcFee(){
    const f = computeFee(ctx.offer);
    if (f!=null){ ctx.offer.fee_amount = f; $('skdFeeAmount').value = money(f); }
  }

  // ——— taby + zamykanie ———
  function wireChrome(){
    const modal = $('skdOfferModal');
    modal.querySelector('.modal-close').onclick = close;
    modal.addEventListener('click', (e)=>{ if(e.target===modal) close(); });

    modal.querySelectorAll('.modal-tabs .tab').forEach(tab=>{
      tab.onclick = ()=>{
        modal.querySelectorAll('.modal-tabs .tab').forEach(t=>t.classList.remove('active'));
        tab.classList.add('active');
        const tn = tab.dataset.tab;
        modal.querySelectorAll('.tab-panel').forEach(p=> p.style.display = 'none');
        $('skdTab-'+tn).style.display = '';
      };
    });
  }

  function open(offer, role){
    ctx.offer = structuredClone(offer||{});
    ctx.role  = role || 'agent';
    $('skdOfferModal').style.display = 'block';
    document.body.classList.add('modal-open');
    render();
  }

  function close(){
    $('skdOfferModal').style.display = 'none';
    document.body.classList.remove('modal-open');
  }

  // ——— publiczny interfejs ———
  ensureTemplate(); wireChrome();
  window.PK_SKD = window.PK_SKD || {};
  window.PK_SKD.openOffer = open;    // użyj: PK_SKD.openOffer(offerObj, 'admin'|'agent')
  window.PK_SKD.close     = close;
})();
// === Modal SKD: sekcja Opcje (admin toggluje, agent podgląda) ===
(function skdOptionsSection(){
  const $ = (id)=>document.getElementById(id);
  function ensureHost(){
    const host = document.createElement('div'); host.id = 'skdOptionsHost';
    const summary = document.getElementById('skdTab-summary');
    if (!summary) return;
    // wstrzykuj pod istniejące pola
    summary.appendChild(document.createElement('hr'));
    const h = document.createElement('h4'); h.textContent = 'Opcje oferty'; h.style.margin='8px 0';
    summary.appendChild(h);
    summary.appendChild(host);
  }

  function renderOptions(){
    if (!window.PK_SKD || !PK_SKD._getCtx) return;
    const ctx = PK_SKD._getCtx();
    const host = document.getElementById('skdOptionsHost'); if (!host) return;
    const isAdmin = ctx.role === 'admin';
    const opts = Array.isArray(ctx.offer.options) ? ctx.offer.options : (ctx.offer.options = []);

    host.innerHTML = '';
    if (isAdmin){
      // admin: checkboxy + edycja opisu
      opts.forEach((o, idx)=>{
        const row = document.createElement('div'); row.style.display='grid'; row.style.gridTemplateColumns='24px 220px 1fr'; row.style.gap='8px'; row.style.alignItems='center'; row.style.margin='6px 0';
        const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=!!o.enabled;
        cb.onchange = ()=>{ o.enabled = cb.checked; markDirty(); };
        const label = document.createElement('div'); label.textContent = o.label || o.key;
        const desc = document.createElement('input'); desc.type='text'; desc.value = o.desc || ''; desc.placeholder='Krótki opis opcji';
        desc.oninput = ()=>{ o.desc = desc.value; markDirty(); };
        row.appendChild(cb); row.appendChild(label); row.appendChild(desc);
        host.appendChild(row);
      });
      // dodawanie nowej opcji (prosty dodaj)
      const add = document.createElement('button');
      add.textContent = 'Dodaj opcję'; add.style.marginTop='6px'; add.style.padding='6px 10px'; add.style.border='0'; add.style.borderRadius='8px'; add.style.background='#eef2ff'; add.style.cursor='pointer';
      add.onclick = ()=>{
        const key = prompt('Klucz opcji (np. expedite)'); if(!key) return;
        const label = prompt('Etykieta (np. Tryb przyspieszony)') || key;
        const desc = prompt('Opis krótki (opcjonalnie)') || '';
        ctx.offer.options.push({key, label, desc, enabled:true}); markDirty(); renderOptions();
      };
      host.appendChild(add);
    } else {
      // agent: tylko włączone opcje (lista)
      const enabled = opts.filter(o=>o.enabled);
      if (!enabled.length){ host.textContent = 'Brak dostępnych opcji od administratora.'; return; }
      enabled.forEach(o=>{
        const row = document.createElement('div'); row.style.margin='6px 0';
        const strong = document.createElement('div'); strong.style.fontWeight='600'; strong.textContent = o.label || o.key;
        const d = document.createElement('div'); d.style.color='#667085'; d.textContent = o.desc || '';
        row.appendChild(strong); row.appendChild(d); host.appendChild(row);
      });
    }
  }

  function markDirty(){ const hint=document.getElementById('skdDirtyHint'); if(hint) hint.style.display='block'; if (window.PK_SKD && PK_SKD._getCtx) PK_SKD._getCtx().dirty = true; }

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
function getCsrf(){ return document.querySelector('meta[name="csrf-token"]')?.content || null; }

async function apiFetch(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers || {});
  if (window.API.authToken) headers['Authorization'] = 'Bearer ' + window.API.authToken;
  const csrf = getCsrf(); if (csrf) headers['X-CSRF-Token'] = csrf;

  return fetch(`${window.API.base}${path}`, {
    ...opts,
    headers,
    credentials: 'include',   // ważne przy ciasteczkach
  });
}

// === Modal SKD (blok 2/3): zapis (PUT), usuwanie (DELETE), walidacje — z DEV fallback ===
(function skdPersist(){
  if(!window.PK_SKD || !PK_SKD._getCtx){ console.warn('PK_SKD ctx not ready'); return; }
  const $ = (id)=>document.getElementById(id);

  function toast(msg){ if(window.showToast) showToast(msg); else alert(msg); }
  function disable(btn, flag){ if(btn){ btn.disabled=!!flag; btn.style.opacity=flag?0.6:1; } }

  function validate(o){
    const errs=[];
    if(!o.status) errs.push('Wybierz status.');
    if(!o.bank) errs.push('Wybierz bank.');
    if(!o.variant) errs.push('Wybierz wariant.');
    if(o.variant==='success_fee' && !o.fee_percent && !o.fee_amount) errs.push('Podaj prowizję (%, PLN lub oba).');
    if(o.fee_percent!=null && (o.fee_percent<0 || o.fee_percent>100)) errs.push('Prowizja % musi być 0–100.');
    if(o.wps_forecast!=null && o.wps_forecast<0) errs.push('WPS nie może być ujemny.');
    if(o.fee_amount!=null && o.fee_amount<0) errs.push('Prowizja (PLN) nie może być ujemna.');
    return errs;
  }

  async function save(){
    const ctx = PK_SKD._getCtx(); const o = ctx.offer||{};
    const errs = validate(o);
    if(errs.length){ toast('Popraw dane:\n• '+errs.join('\n• ')); return; }

    const btn = $('skdSaveBtn'); disable(btn,true);
    try{
      const r = await apiFetch(`/offers/${encodeURIComponent(o.id)}`,{
        method:'PUT',
        body: JSON.stringify({ offer_skd: o })
      });

      if(r.status === 401){
        // DEV fallback: zapis do localStorage
        localStorage.setItem('skd_offers:'+o.id, JSON.stringify(o));
        ctx.offer = o; ctx.dirty = false;
        const hint = $('skdDirtyHint'); if(hint) hint.style.display='none';
        if(window.refreshCasesRow) window.refreshCasesRow(o.id, { offer_skd: ctx.offer });
        toast('Tryb DEV: zapis lokalny (backend 401).');
        return;
      }
      if(!r.ok) throw new Error('HTTP '+r.status);

      const out = await r.json();
      ctx.offer = out.offer_skd || o;
      ctx.dirty = false;
      const hint = $('skdDirtyHint'); if(hint) hint.style.display='none';
      if(window.refreshCasesRow) window.refreshCasesRow(o.id, { offer_skd: ctx.offer });
      toast('Zapisano ofertę SKD.');
    }catch(e){
      console.error(e);
      toast('Nie udało się zapisać (sprawdź uprawnienia/API).');
    }finally{
      disable(btn,false);
    }
  }

  async function del(){
    const ctx = PK_SKD._getCtx(); const o = ctx.offer||{};
    if(ctx.role!=='admin'){ toast('Usuwanie dostępne tylko dla administratora.'); return; }
    if(!confirm('Na pewno usunąć tę ofertę?')) return;

    const btn = $('skdDeleteBtn'); disable(btn,true);
    try{
      const r = await apiFetch(`/offers/${encodeURIComponent(o.id)}`,{ method:'DELETE' });

      if(r.status === 401){
        // DEV fallback: usuń lokalny zapis
        localStorage.removeItem('skd_offers:'+o.id);
        if(window.removeCaseRow) window.removeCaseRow(o.id);
        if(window.PK_SKD && PK_SKD.close) PK_SKD.close();
        toast('Tryb DEV: lokalne usunięcie (backend 401).');
        return;
      }
      if(!r.ok && r.status!==204) throw new Error('HTTP '+r.status);

      if(window.removeCaseRow) window.removeCaseRow(o.id);
      if(window.PK_SKD && PK_SKD.close) PK_SKD.close();
      toast('Usunięto ofertę SKD.');
    }catch(e){
      console.error(e);
      toast('Nie udało się usunąć (sprawdź uprawnienia/API).');
    }finally{
      disable(btn,false);
    }
  }

  function bindButtons(){
    const saveBtn = $('skdSaveBtn');
    const delBtn  = $('skdDeleteBtn');
    if(saveBtn) saveBtn.onclick = save;
    if(delBtn)  delBtn.onclick  = del;
  }

  window.addEventListener('pk_skd_render', bindButtons);
})();
// === Modal SKD (blok 3/3): podpięcie do tabeli + badge statusu + walidacja daty ===
(function skdWireAndUX(){
  const $ = (id)=>document.getElementById(id);

  // ——— Mini CSS na badge (wstrzyknięcie raz) ———
  (function injectBadgeCss(){
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
  function makeBadge(statusText){
    const s = (statusText||'').toLowerCase();
    const span = document.createElement('span');
    span.className = `skd-badge ${s}`;
    span.textContent = ({draft:'Szkic',sent:'Wysłana',accepted:'Zaakceptowana',declined:'Odrzucona',archived:'Zarchiwizowana'})[s] || statusText || '—';
    return span;
  }

  // ——— Pomaluj badge w tabeli (dla elementów z atrybutem data-offer-status) ———
  function paintBadges(root=document){
    root.querySelectorAll('[data-offer-status]').forEach(el=>{
      const txt = (el.getAttribute('data-offer-status') || el.textContent || '').trim();
      el.innerHTML = ''; el.appendChild(makeBadge(txt));
    });
  }

  // ——— Walidacja daty „ważna do” (po renderze modala) ———
  function validateValidUntil(){
    const input = $('skdValidUntil'); if(!input) return;
    const warnId = 'skdValidWarn';
    const old = $(warnId); if(old) old.remove();

    const v = input.value;
    if(!v) { input.classList.remove('skd-field-error'); return; }

    // porównanie z „dziś” (lokalnie)
    const today = new Date(); today.setHours(0,0,0,0);
    const dt = new Date(v);   dt.setHours(0,0,0,0);

    if(dt < today){
      input.classList.add('skd-field-error');
      const w = document.createElement('div');
      w.id = warnId; w.className = 'skd-warn';
      w.textContent = 'Uwaga: data ważności minęła. Zaktualizuj, aby oferta była aktualna.';
      // wstrzykuj bezpośrednio pod polem
      const parent = input.parentElement || input.closest('div') || $('skdTab-summary');
      (parent||input).appendChild(w);
    }else{
      input.classList.remove('skd-field-error');
    }
  }

  // ——— Listener: po każdym renderze modala ———
  window.addEventListener('pk_skd_render', ()=>{
    validateValidUntil();
    paintBadges(); // na wypadek, gdyby status pokazywał się także w modalu
  });

  // ——— Podpięcie do tabeli spraw: data-action="open-skd" ———
  (function wireCasesTable(){
    const table = document.getElementById('casesTable');
    if(!table) return;

    table.addEventListener('click', async (e)=>{
      const btn = e.target.closest('[data-action="open-skd"]');
      if(!btn) return;

      const id = btn.getAttribute('data-offer-id') || btn.getAttribute('data-id') || btn.dataset.offerId || btn.dataset.id;
      if(!id) return;

      // Pobierz ofertę z modelu lub API (z fallbakiem DEV, jeżeli masz 401)
      let offer = (window.getOfferById && window.getOfferById(id)) || null;
      if(!offer){
        try{
          const r = await apiFetch(`/offers/${encodeURIComponent(id)}`, { method:'GET' });
          if(r.status === 401){
            const local = localStorage.getItem('skd_offers:'+id);
            offer = local ? JSON.parse(local) : null;
          }else if(r.ok){
            const json = await r.json();
            offer = json.offer_skd || json.offer || null;
          }
        }catch(_){}
      }

      // jeżeli dalej brak — utwórz pusty szkielet, żeby admin mógł uzupełnić
      if(!offer) offer = { id, status:'draft', variant:'success_fee', history:[], options:[] };

      const role = (window.currentUser && window.currentUser.role) || 'agent';
      if(window.PK_SKD && PK_SKD.openOffer) PK_SKD.openOffer(offer, role);
    });

    // Pomaluj badge od razu i po ewentualnym re-renderze tabeli
    paintBadges(table);
    window.addEventListener('cases_rendered', ()=>paintBadges(table)); // wywołaj to eventem z Twojego renderCases()
  })();
})();
// === Modal SKD: UX agenta — filtr wariantów wg opcji admina ===
(function skdAgentVariantWhitelist(){
  const $ = (id)=>document.getElementById(id);

  function enabledOptionKeys(opts){
    return (Array.isArray(opts)?opts:[]).filter(o=>o.enabled).map(o=>o.key);
  }
  function labelForKey(opts, key){
    const o = (opts||[]).find(x=>x.key===key);
    return (o && (o.label||o.key)) || key;
  }
  function rebuildVariantForAgent(ctx){
    const sel = $('skdVariant'); if(!sel) return;
    const keys = enabledOptionKeys(ctx.offer.options);
    if(!keys.length){
      // brak dostępnych opcji -> zablokuj wybór + komunikat
      sel.innerHTML = `<option value="">— brak opcji od administratora —</option>`;
      sel.disabled = true;
      return;
    }
    // zbuduj tylko dozwolone warianty
    sel.innerHTML = '';
    keys.forEach(k=>{
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = labelForKey(ctx.offer.options, k);
      sel.appendChild(opt);
    });
    sel.disabled = false;

    // jeśli bieżący wariant niedozwolony -> przestaw na 1. dozwolony
    if(!keys.includes(ctx.offer.variant)){
      ctx.offer.variant = keys[0];
      sel.value = keys[0];
      const hint = document.getElementById('skdDirtyHint'); if(hint) hint.style.display='block';
      if (window.PK_SKD && PK_SKD._getCtx) PK_SKD._getCtx().dirty = true;
    }else{
      sel.value = ctx.offer.variant;
    }
  }

  // po każdym renderze modala — jeśli agent, odfiltruj warianty
  window.addEventListener('pk_skd_render', ()=>{
    if(!window.PK_SKD || !PK_SKD._getCtx) return;
    const ctx = PK_SKD._getCtx();
    if(ctx.role !== 'admin') rebuildVariantForAgent(ctx);
  });
})();

// === PATCH 1: Walidacja "Ważna do" — live na input/change ===
(function skdValidUntilLive(){
  const $ = (id)=>document.getElementById(id);

  function validate(){
    const input = $('skdValidUntil'); if(!input) return;
    const warnId = 'skdValidWarn';
    const old = document.getElementById(warnId); if(old) old.remove();

    const v = input.value;
    if(!v){ input.classList.remove('skd-field-error'); return; }

    const today = new Date(); today.setHours(0,0,0,0);
    const dt = new Date(v);   dt.setHours(0,0,0,0);

    if(dt < today){
      input.classList.add('skd-field-error');
      const w = document.createElement('div');
      w.id = warnId; w.className = 'skd-warn';
      w.textContent = 'Uwaga: data ważności minęła. Zaktualizuj, aby oferta była aktualna.';
      (input.parentElement || input.closest('div') || document.getElementById('skdTab-summary') || input).appendChild(w);
    }else{
      input.classList.remove('skd-field-error');
    }
  }

  function bind(){ const i = $('skdValidUntil'); if(!i) return; i.oninput = i.onchange = validate; validate(); }
  window.addEventListener('pk_skd_render', bind);
})();
// === PATCH 2: Badge statusu — globalne malowanie + eventy ===
(function skdBadgesGlobal(){
  function makeBadge(statusText){
    const s = (statusText||'').toLowerCase();
    const span = document.createElement('span');
    span.className = `skd-badge ${s}`;
    span.textContent = ({draft:'Szkic',sent:'Wysłana',accepted:'Zaakceptowana',declined:'Odrzucona',archived:'Zarchiwizowana'})[s] || (statusText||'—');
    return span;
  }
  function paint(root=document){
    root.querySelectorAll('[data-offer-status]').forEach(el=>{
      const txt = (el.getAttribute('data-offer-status') || el.textContent || '').trim();
      // jeżeli już jest badge — pomiń
      if(el.firstElementChild && el.firstElementChild.className.includes('skd-badge')) return;
      el.textContent = ''; el.appendChild(makeBadge(txt));
    });
  }

  // maluj na start, po renderze modala, po renderze tabeli i na żądanie
  setTimeout(()=>paint(document), 0);
  window.addEventListener('pk_skd_render', ()=>paint(document));
  window.addEventListener('cases_rendered', ()=>paint(document));
  window.addEventListener('paint_skd_badges', ()=>paint(document));
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

// ===== BOOTSTRAP =====
document.addEventListener('DOMContentLoaded', async () => {
  try {
    showDiag('🚀 Boot: start');
    await step('Auth', initAuth);
    await step('Bank selects', initBanks);
    await step('Tabela + KPI', initTableAndKpi);
    await step('Filtry & KPI-click', bindFilters);
    await step('Modal & Logout', bindModalAndLogout);
    showDiag('✅ Dashboard gotowy');
    log('✅ dashboard ready');
  } catch (e) {
    console.error('[PK:ERR] BOOT FAIL', e);
    showDiag('❌ Boot zatrzymany: ' + (e?.message || e));
  }

    await loadAndRenderAllCases();

  // === Szukajka ===
  (function initCaseSearch() {
    const input    = document.getElementById("caseSearch");
    const clearBtn = document.getElementById("clearCaseSearch");
    const countEl  = document.getElementById("caseSearchCount");
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
      const q  = (input.value || "").trim();
      const nq = normalize(q);

      const tables    = document.querySelectorAll("table");
      const mainTbody = tables.length ? tables[tables.length - 1].querySelector("tbody") : null;
      if (!mainTbody) { updateCount(0, q); return; }

      const rows = Array.from(mainTbody.querySelectorAll("tr"));
      if (!nq) { rows.forEach(tr => tr.style.display = ""); updateCount("", ""); return; }

      let shown = 0;
      rows.forEach(tr => {
        const txt = normalize(tr.textContent || "");
        const hit = txt.includes(nq);
        tr.style.display = hit ? "" : "none";
        if (hit) shown++;
      });
      updateCount(shown, q);

      if (shown === 1 && typeof openCaseModal === "function") {
        const onlyTr = rows.find(tr => tr.style.display !== "none");
        const idCell = onlyTr ? onlyTr.querySelector("td,th") : null;
        const caseId = idCell ? (idCell.textContent || "").trim() : null;
        if (caseId) setTimeout(() => openCaseModal(caseId), 80);
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
});     // ← JEDYNE zamknięcie addEventListener('DOMContentLoaded', ...)

// ===== SKD Offer – inicjalizacja/logika =====
function initSkdOffer(caseData) {
  console.log('%cinitSkdOffer uruchomione','color:#fff;background:#900;padding:2px 6px;border-radius:4px;');
  console.log('initSkdOffer → caseData.id =', caseData && caseData.id);
  if (!caseData) { console.warn('initSkdOffer: brak caseData'); return; }

  const root = document.getElementById('skdOffer');
  if (!root) { console.warn('initSkdOffer: brak #skdOffer w DOM'); return; }

  const lastId = root.dataset.initedFor;
  if (lastId && String(lastId) === String(caseData.id || '')) {
    console.log('%cinitSkdOffer: pominięto (już aktywne dla tej sprawy)','color:gray');
    return;
  }
  root.dataset.initedFor = String(caseData.id || '');
  root.dataset.caseId    = String(caseData.id || '');

  const $ = (s) => root.querySelector(s);
  const wpsInput   = $('#wpsForecastInput');
  const copyBtn    = $('#btnCopyWpsToForecast');
  const saveBtn    = $('#skdOfferSaveBtn');
  const sub        = $('#skdOfferSub');
  const notesEl    = $('#skdOfferNotes');
  const buyoutEl   = $('#buyoutPctInput');
  const upfrontEl  = $('#upfrontFeeInput');
  const rads       = root.querySelectorAll('input[name="skdVariant"]');
  const isAdmin    = (document.body.dataset.role === 'admin');

  const state = normalizeSkdOffer(caseData);
const fallbackWps = Number(caseData?.wps || 0);
if (isAdmin && (!state.wps_forecast || Number(state.wps_forecast) === 0) && fallbackWps > 0) {
  state.wps_forecast = fallbackWps;
  wpsInput && (wpsInput.value = String(fallbackWps));
}
  const eligBox  = $('#skdEligibilityGroup');
  const prefBox  = $('#clientPreferenceBlock');
  if (isAdmin) {
    if (eligBox) eligBox.style.display = '';
    if (prefBox) prefBox.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'inline-block';
  } else {
    if (eligBox) eligBox.style.display = 'none';
    if (prefBox) prefBox.style.display = '';
    if (saveBtn) saveBtn.style.display = 'none';
  }

  const chkSf50 = $('#eligSf50');
  const chkSf49 = $('#eligSf49');
  const chkSell = $('#eligSell');
  const currentElig = (state.offer_skd && state.offer_skd.eligibility) || { sf50:true, sf49:true, sell:true };
  if (chkSf50) chkSf50.checked = !!currentElig.sf50;
  if (chkSf49) chkSf49.checked = !!currentElig.sf49;
  if (chkSell) chkSell.checked = !!currentElig.sell;

  function filterVariantsForAgent() {
    const elig = state.offer_skd?.eligibility || { sf50:true, sf49:true, sell:true };
    if (isAdmin) {
      ['sf50','sf49','sell'].forEach(k=>{
        root.querySelectorAll(`[data-variant="${k}"]`).forEach(b=> b.classList.remove('hidden'));
      });
      return;
    }
    ['sf50','sf49','sell'].forEach(k=>{
      const allow = !!elig[k];
      root.querySelectorAll(`[data-variant="${k}"]`).forEach(b=> b.classList.toggle('hidden', !allow));
    });
    const current = state.offer_skd?.variant || null;
    if (current && !(state.offer_skd?.eligibility||{})[current]) {
      root.querySelectorAll('input[name="skdVariant"]').forEach(r=> r.checked = false);
    }
  }
  filterVariantsForAgent();

  if (isAdmin && eligBox) {
    let tSaveElig = null;
    const scheduleSaveEligibility = () => {
      clearTimeout(tSaveElig);
      tSaveElig = setTimeout(async () => {
        try {
          state.offer_skd = state.offer_skd || {};
          state.offer_skd.eligibility = {
            sf50: !!chkSf50?.checked,
            sf49: !!chkSf49?.checked,
            sell: !!chkSell?.checked
          };
          await saveSkdOffer(caseData.id, {
            wps_forecast: toNum(state.wps_forecast),
            offer_skd: state.offer_skd
          });
          filterVariantsForAgent();
          if (sub) { sub.textContent = 'Zapisano dostępność wariantów'; setTimeout(()=>{ sub.textContent = '—'; }, 1200); }
        } catch (e) {
          console.error('save eligibility failed', e);
          if (sub) sub.textContent = 'Błąd zapisu (401?)';
        }
      }, 350);
    };
    [chkSf50, chkSf49, chkSell].forEach(el => el?.addEventListener('change', scheduleSaveEligibility));
  }

  if (wpsInput) wpsInput.value = state.wps_forecast ?? '';
  if (notesEl)  notesEl.value  = state.offer_skd.notes || '';
  const initialVariant = state.offer_skd.variant || 'sf50';
  const initialRadio   = root.querySelector(`input[name="skdVariant"][value="${initialVariant}"]`);
  if (initialRadio) initialRadio.checked = true;
  if (state.offer_skd.upfront_fee != null && upfrontEl) upfrontEl.value = num(state.offer_skd.upfront_fee);
  if (state.offer_skd.buyout_pct != null && buyoutEl)  buyoutEl.value  = pct(state.offer_skd.buyout_pct);

  toggleSection();
  function filterVariantsForAgent() {
  const elig = state.offer_skd?.eligibility || { sf50:true, sf49:true, sell:true };
  ['sf50','sf49','sell'].forEach(k=>{
    root.querySelectorAll(`[data-variant="${k}"]`).forEach(el=>{
      el.style.display = elig[k] ? '' : 'none';
    });
    root.querySelectorAll(`input[name="skdVariant"][value="${k}"]`).forEach(inp=>{
      const box = inp.closest('.radio') || inp;
      box.style.display = elig[k] ? '' : 'none';
      inp.disabled = !elig[k];
    });
  });
}

// po normalize + prefill:
toggleSection();
filterVariantsForAgent();  
  refreshExtrasVisibility(initialVariant);
  recomputeAndRender();

  wpsInput?.addEventListener('input', ()=>{
    state.wps_forecast = num(wpsInput.value);
    toggleSection(); recomputeAndRender(); scheduleSave();
  });
  notesEl?.addEventListener('input', ()=>{
    state.offer_skd.notes = notesEl.value || '';
    scheduleSave();
  });
  rads.forEach(r=>{
    r.addEventListener('change', ()=>{
      if(!r.checked) return;
      state.offer_skd.variant = r.value;
      refreshExtrasVisibility(r.value);
      recomputeAndRender();
      scheduleSave();
    });
  });
  upfrontEl?.addEventListener('input', ()=>{
    state.offer_skd.upfront_fee = num(upfrontEl.value);
    recomputeAndRender();
    scheduleSave();
  });
  buyoutEl?.addEventListener('input', ()=>{
    state.offer_skd.buyout_pct = clamp(num(buyoutEl.value)/100, 0, 1);
    recomputeAndRender();
    scheduleSave();
  });
  copyBtn?.addEventListener('click', ()=>{
    const domWps = extractDomWps();
    if(domWps > 0){
      if (wpsInput) wpsInput.value = String(domWps);
      state.wps_forecast = domWps;
      toggleSection(); recomputeAndRender(); scheduleSave();
    } else {
      alert('Brak wartości WPS w podsumowaniu.');
    }
  });
  saveBtn?.addEventListener('click', scheduleSave);

function toggleSection(){
  const forecast = Number(state.wps_forecast || 0);
  const baseWps  = Number(caseData?.wps || 0);
  const show = isAdmin ? true : (forecast > 0 || baseWps > 0);
  root.style.display = show ? '' : 'none';
}
  function refreshExtrasVisibility(v){
    root.querySelectorAll('[data-extra]').forEach(el=>{
      el.style.display = (el.getAttribute('data-extra') === v) ? '' : 'none';
    });
  }
  function recomputeAndRender(){
    const wps = num(state.wps_forecast);
    const v   = state.offer_skd.variant || 'sf50';
    let now=0, later=0;
    if(v==='sf50'){ now=0; later = wps*0.50; }
    else if(v==='sf49'){ now = -Math.max(0, num(state.offer_skd.upfront_fee)); later = wps*0.51; }
    else if(v==='sell'){ now = wps*clamp(state.offer_skd.buyout_pct ?? 0.30, 0, 1); later = 0; }
    const total = now + later;
    state.offer_skd.estimates = { client_now: r2(now), client_later: r2(later), total_client: r2(total) };
    $('#estNow')   && ($('#estNow').textContent   = fmt(state.offer_skd.estimates.client_now));
    $('#estLater') && ($('#estLater').textContent = fmt(state.offer_skd.estimates.client_later));
    $('#estTotal') && ($('#estTotal').textContent = fmt(state.offer_skd.estimates.total_client));
    const labels = { sf50:'SF 50% (bez ryzyka)', sf49:'SF 49% (z opłatą początkową)', sell:'Sprzedaż roszczenia' };
    if (sub) sub.textContent = `WPS prognoza: ${fmt(wps)} • Wariant: ${labels[v]}`;
    if (saveBtn) saveBtn.style.display = 'inline-block';
  }

  let t = null;
  let blockSaves401 = false;
  function scheduleSave(){
    if (blockSaves401) return;
    clearTimeout(t);
    t = setTimeout(async ()=>{
      try{
        await saveSkdOffer(caseData.id, {
          wps_forecast: toNum(state.wps_forecast),
          offer_skd: state.offer_skd
        });
        if (saveBtn) saveBtn.style.display = 'none';
        blockSaves401 = false;
        window.dispatchEvent(new CustomEvent('case:offerSkdUpdated', { detail:{ caseId: caseData.id } }));
      }catch(e){
        console.error(e);
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (String(e.message).includes('401') || String(e).includes('Unauthorized')) {
          blockSaves401 = true;
          alert('Nie jesteś zalogowany / brak autoryzacji (401). Zaloguj się i odśwież stronę.');
        }
      }
    }, 450);
  }

  function normalizeSkdOffer(cd){
    return {
      wps_forecast: cd?.wps_forecast ? Number(cd.wps_forecast) : 0,
      offer_skd: {
        variant: cd?.offer_skd?.variant || 'sf50',
        upfront_fee: cd?.offer_skd?.upfront_fee ?? null,
        buyout_pct: cd?.offer_skd?.buyout_pct ?? 0.30,
        notes: cd?.offer_skd?.notes || '',
        eligibility: cd?.offer_skd?.eligibility || { sf50:true, sf49:true, sell:true },
        estimates: cd?.offer_skd?.estimates || { client_now:0, client_later:0, total_client:0 }
      }
    };
  }
  function extractDomWps(){
    const el = document.getElementById('caseWpsValue');
    if(!el) return 0;
    return num(el.textContent);
  }
  function num(v){ return Number(String(v).replace(/\s/g,'').replace(',', '.')) || 0; }
  function r2(v){ return Math.round(v*100)/100; }
  function clamp(v,min,max){ return Math.min(max, Math.max(min, v)); }
  function fmt(v){
    const sign = v>=0 ? '' : '−';
    return sign + Math.abs(v).toLocaleString('pl-PL',{minimumFractionDigits:2, maximumFractionDigits:2}) + ' zł';
  }
  function pct(v){ return (Number(v)*100).toFixed(1); }
  function toNum(v){
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/\s/g,'').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
}

// ===== API helper =====
async function saveSkdOffer(caseId, payload) {
  const res = await fetch(`/api/cases/${caseId}/skd-offer`, {
  method: 'PUT',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  credentials: 'include',
  body: JSON.stringify(payload)
});
  if (!res.ok) throw new Error(`saveSkdOffer ${res.status}`);
  try {
    return await res.json();
  } catch {
    return {};
  }
}

window.initSkdOffer = initSkdOffer;
} // ← domknięcie brakującego bloku, np. funkcji lub DOMContentLoaded
