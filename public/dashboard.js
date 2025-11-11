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

    } catch (err) {
      console.error('Modal load error:', err);
      alert('Nie udało się pobrać szczegółów sprawy.');
    }

  });
}


  // Zamknięcie modala
  const cmCloseEl = document.getElementById("cmClose");
  if (cmCloseEl && cmModal) {
    cmCloseEl.addEventListener("click", () => (cmModal.style.display = "none"));
    cmModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop"))
        cmModal.style.display = "none";
    });
  }
// --- Zakładki w modalu ---
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

  // Zapis w modalu
  const cmSave = document.getElementById("cmSave");
  if (cmSave && cmModal) {
    cmSave.addEventListener("click", async () => {
      const id = cmModal.dataset.caseId || "";
      if (!id) {
        alert("Brak ID sprawy.");
        return;
      }

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
} catch {}

      } catch (e) {
        console.error("SAVE ERROR", e);
        alert("Nie udało się zapisać: " + (e?.message || e));
      }
    });
  }
  
  // === DIAGNOSTYKA / OVERLAY (auto-inject) ===
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

// (opcjonalnie, jeśli gdziekolwiek wywołujesz hideDiag)
function hideDiag() {
  const el = document.getElementById('pkDiag');
  if (el) el.style.opacity = '0';
}

// ===== BOOTSTRAP (jedyny DOMContentLoaded) =====
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
  await loadAndRenderAllCases(); // <-- DODAJ TĘ LINIĘ

  // === [B] Inicjalizacja pola wyszukiwarki ===
(function initCaseSearch() {
  const input = document.getElementById("caseSearch");
  const clearBtn = document.getElementById("clearCaseSearch");
  const countEl = document.getElementById("caseSearchCount");

  if (!input) return; // bezpiecznik, jeśli nie ma pola w DOM

  // Trzymamy w pamięci pełną listę spraw po pierwszym pobraniu
  // (ustawiamy to w bloku [C])
  window.casesCache = window.casesCache || [];

  function updateCount(n, q) {
    if (!q) {
      countEl.textContent = "";
      return;
    }
    countEl.textContent = n === 1 ? "Znaleziono 1 sprawę" : `Znaleziono: ${n}`;
  }

 const apply = debounce(() => {
  const base = Array.isArray(window.casesCache) ? window.casesCache : [];
  console.log('[PK][search] cache size:', base.length);

  const q = (input.value || '').trim();
  const nq = normalize(q);

  // Celujemy w GŁÓWNĄ tabelę na dashboardzie: bierzemy ostatnią <table> na stronie
  const tables = document.querySelectorAll('table');
  const mainTbody = tables.length ? tables[tables.length - 1].querySelector('tbody') : null;

  if (!mainTbody) {
    console.warn('[PK][search] Nie znaleziono głównej tabeli (tbody).');
    updateCount(0, q);
    return;
  }

  const rows = Array.from(mainTbody.querySelectorAll('tr'));

  // PUSTE ZAPYTANIE → pokaż wszystkie wiersze i wyczyść licznik
  if (!nq) {
    rows.forEach(tr => { tr.style.display = ''; });
    updateCount('', '');
    return;
  }

  // Filtr: ukrywamy wiersze, które nie zawierają frazy (po normalizacji)
  let shown = 0;
  rows.forEach(tr => {
    const txt = normalize(tr.textContent || '');
    const hit = txt.includes(nq);
    tr.style.display = hit ? '' : 'none';
    if (hit) shown++;
  });

  updateCount(shown, q);

  // Jeśli dokładnie 1 widoczny wiersz → spróbuj otworzyć modal (ID z 1. komórki)
  if (shown === 1 && typeof openCaseModal === 'function') {
    const onlyTr = rows.find(tr => tr.style.display !== 'none');
    const idCell = onlyTr ? onlyTr.querySelector('td,th') : null;
    const caseId = idCell ? (idCell.textContent || '').trim() : null;
    if (caseId) {
      setTimeout(() => openCaseModal(caseId), 80);
    }
  }
}, 200);


  input.addEventListener("input", apply);

  // Enter — natychmiast zastosuj (i ewentualnie otwórz modal)
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply();
    if (e.key === "Escape") {
      input.value = "";
      apply();
      input.blur();
    }
  });

  // Wyczyść przyciskiem „×”
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      input.value = "";
      input.focus();
      apply();
    });
  }

  // Skrót klawiaturowy Ctrl/Cmd+K — focus na wyszukiwarkę
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    if ((isMac && e.metaKey && e.key.toLowerCase() === "k") ||
        (!isMac && e.ctrlKey && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
})();

});
