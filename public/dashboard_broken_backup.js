// === SAFE SHIMS (guardy zanim definicje się załadują) ===
window.recalcMoneyKPIFromDOM = window.recalcMoneyKPIFromDOM || function () { };
window.attachRowsObserver = window.attachRowsObserver || function () { };
window.watchForTbodyReplacement = window.watchForTbodyReplacement || function () { };
window.initWpsKpiWatcher = window.initWpsKpiWatcher || function () {
    try { window.recalcMoneyKPIFromDOM(); } catch (e) { }
    try { window.attachRowsObserver(); } catch (e) { }
    try { window.watchForTbodyReplacement(); } catch (e) { }
};

// === global diagnostics (poza DOMContentLoaded) ===
window.addEventListener('error', (e) => {
    console.error('GLOBAL JS ERROR →', e.message, 'at', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('UNHANDLED PROMISE →', e.reason);
});
console.log('dashboard.js loaded');

(async function loadCasesList() {
    console.log('loadCasesList() start');

    const token = localStorage.getItem('token');
    if (!token) {
        console.warn('Brak tokena — przekierowanie do logowania');
        window.location.href = '/login.html';
        return;
    }

    const r = await fetch('/api/cases', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
        console.error('Błąd pobierania /api/cases', r.status);
        return;
    }

    const d = await r.json();
    const items = d.items || [];
    console.log('Załadowano', items.length, 'spraw');

    const tbody = document.getElementById('caseTableBody') || document.querySelector('tbody');
    if (!tbody) return console.error('Brak <tbody> do renderowania');

    const pln = n => Number(n || 0).toLocaleString('pl-PL', { minimumFractionDigits: 0 });
    tbody.innerHTML = items.map(c => `
    <tr>
      <td>${c.id ?? ''}</td>
      <td>${c.client ?? ''}</td>
      <td>${pln(c.loan_amount)}</td>
      <td>${pln(c.wps)}</td>
      <td>${c.bank ?? ''}</td>
      <td>${c.status ?? ''}</td>
    </tr>
  `).join('');

    // przelicz KPI po wyrenderowaniu listy
    if (typeof window.recalcMoneyKPIFromDOM === 'function') {
        window.recalcMoneyKPIFromDOM();
    }
})();
// === Pasek KPI + render liczb (stała wersja, nie-fixed) ===
function ensureKpiBarAndRender() {
    // gdzie wstawić
    const host =
        document.querySelector('.col-left')
        || document.querySelector('#caseTableBody')?.closest('section,div')
        || document.querySelector('table')?.parentElement
        || document.body;

    // jeśli nie ma paska – utwórz
    let bar = document.getElementById('kpiBarInjected');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'kpiBarInjected';
        Object.assign(bar.style, {
            margin: '12px 0 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px'
        });
        bar.innerHTML = `
      <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
        <div class="kpiLabel">Wszystkie WPS</div>
        <div id="kpiWszystkie" class="kpiValue">0</div>
      </div>
      <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
        <div class="kpiLabel">W toku (WPS)</div>
        <div id="kpiOpen" class="kpiValue">0</div>
      </div>
      <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
        <div class="kpiLabel">W toku (alias)</div>
        <div id="kpiWtok" class="kpiValue">0</div>
      </div>
      <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
        <div class="kpiLabel">Śr. WPS (w toku)</div>
        <div id="kpiAvg" class="kpiValue">0</div>
      </div>`;
        host.prepend(bar);
    }

    // przelicz z DOM i wpisz
    if (typeof window.recalcMoneyKPIFromDOM === 'function') window.recalcMoneyKPIFromDOM();
    const w = window.__wps || { sumAll: 0, sumOpen: 0, avgOpen: 0 };
    const pln = n => Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 0 });
    [['kpiWszystkie', w.sumAll], ['kpiOpen', w.sumOpen], ['kpiWtok', w.sumOpen], ['kpiAvg', w.avgOpen]]
        .forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.textContent = pln(val); });
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOMContentLoaded start');

    let lastItems = [];

    // --- auth check ---
    const token = localStorage.getItem('pk_token');
    if (!token) {
        location.href = '/login.html';
        return;
    }
    console.log('token ok');

    // --- helper: fetchJSON (z Bearer) ---
    function authHeaders() {
        return { Authorization: 'Bearer ' + localStorage.getItem('pk_token') };
    }
    async function fetchJSON(url, opts = {}) {
        const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(t || res.statusText);
        }
        const ct = res.headers.get('content-type') || '';
        return ct.includes('application/json') ? res.json() : res.text();
    }
    console.log('fetchJSON ready');

    // --- optional: logout (jeśli element istnieje) ---
    const logoutBtn = document.getElementById('logout');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            localStorage.removeItem('pk_token');
            localStorage.removeItem('pk_user');
            location.href = '/login.html';
        };
    }
    // --- lista banków + helper do wypełniania selecta ---
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
        "VeloBank",
        "Bank Spółdzielczy"
    ];

    function fillBankSelect(sel, current) {
        if (!sel) return;
        sel.innerHTML =
            '<option value="">— wybierz —</option>' +
            BANKS.map(b => `<option value="${b}">${b}</option>`).join('');
        if (current) sel.val
        ue = current;
    }

    // --- optional: health (jeśli #out istnieje) ---
    const outData = document.getElementById('out');
    if (outData) {
        try {
            const health = await fetchJSON('/api/health');
            outData.textContent = JSON.stringify(
                { ok: true, health, user: JSON.parse(localStorage.getItem('pk_user') || 'null') },
                null, 2
            );
        } catch (e) {
            outData.textContent = 'Błąd: ' + e.message;
        }
    }

    // === KPI ===


    async function fetchKPI() {
        console.log('fetchKPI() start');
        try {
            // pobierz listę spraw i policz KPI na froncie
            const d = await fetchJSON('/api/cases');
            const items = Array.isArray(d.items) ? d.items : [];

            // liczniki (DODAJ nowa = 0)
            let all = 0, nowa = 0, open = 0, success = 0, lost = 0, thisMonth = 0;

            // ...w pętli:
            const s = normStatus(c.status);
            // „nowa” NIE wlicza się do „W toku”
            if (s === 'new') nowa++;
            else if (s === 'in_progress') open++;
            else if (s === 'success') success++;
            else if (s === 'lost') lost++;

            const now = new Date();
            const mNow = now.getMonth();
            const yNow = now.getFullYear();

            for (const c of items) {
                all++;

                // używamy Twojej istniejącej funkcji normStatus(s)
                const s = normStatus(c.status);

                // „nowa” NIE wlicza się do „W toku”
                if (s === 'new') nowa++;
                else if (s === 'in_progress') open++;
                else if (s === 'success') success++;
                else if (s === 'lost') lost++;

                // wybierz sensowną datę do KPI „thisMonth”
                const dt = c.created_at || c.createdAt || c.contract_date || c.contractDate || null;
                const cd = dt ? new Date(dt) : null;
                if (cd && cd.getFullYear() === yNow && cd.getMonth() === mNow) thisMonth++;
            }

            // helper: ustaw tę samą wartość dla wielu możliwych ID
            const setAny = (ids, val) => {
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.textContent = String(Number.isFinite(val) ? val : 0);
                });
            };

            // podłącz pod różne warianty nazw ID (PL/EN)
            setAny(['kpiAll', 'kpiTotal', 'kpiWszystkie'], all);
            setAny(['kpiNowe', 'kpiNew'], nowa);
            setAny(['kpiAnaliza', 'kpiPositive', 'kpiSuccess', 'kpiAnalizaPozytywna'], success);
            setAny(['kpiW_toku', 'kpiWtok', 'kpiOpen', 'kpiInProgress'], open);
            setAny(['kpiOdrzucone', 'kpiRejected', 'kpiLost'], lost);
            setAny(['kpiThisMonth', 'kpiMiesiac'], thisMonth);

            // diagnostyka: pokaż, które ID faktycznie znaleźliśmy
            console.log('KPI rendered to IDs:', Array.from(document.querySelectorAll('[id^="kpi"]')).map(n => n.id));

        } catch (e) {
            console.error('fetchKPI(front) error:', e);
            ['kpiAll', 'kpiOpen', 'kpiSuccess', 'kpiLost', 'kpiThisMonth'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '0';
                ['kpiAll', 'kpiNowe', 'kpiAnaliza', 'kpiOpen', 'kpiSuccess', 'kpiLost', 'kpiThisMonth']
                    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });

            });
        }
    }
    function pln(n) {
        const x = Number(n);
        return Number.isFinite(x) ? x.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }) : '—';
    }

    // policz WPS dla aktualnego zestawu wierszy (po filtrze)


    function bindKPI() {
        const btn = document.getElementById('kpiRefresh');
        if (btn) btn.addEventListener('click', fetchKPI);
    }
    // ===== KPI (All/Open/Success/Lost) =====
    // —— dokładne mapowanie KPI ——
    // UWAGA: „nowa” NIE liczy się do „W toku”
    function normStatus(s) {
        const x = String(s || "").trim().toLowerCase();

        // tylko realne "w toku"
        if (x === "w toku" || x === "in_progress" || x === "open" || x === "otwarta")
            return "in_progress";

        // sukcesy / zakończone pozytywnie
        if (x === "sukces" || x === "wygrana" || x === "zakończona" ||
            x === "closed" || x === "done" || x === "finished" || x === "success")
            return "success";

        // przegrane / odrzucone
        if (x === "przegrana" || x === "odrzucona" || x === "lost" ||
            x === "rejected" || x === "zamknięta bez sukcesu")
            return "lost";

        // nowe sprawy traktujemy osobno (NIE wliczamy do „W toku”)
        if (x === "nowa" || x === "nowy" || x === "new") return "new";

        return "other";
    }

    function computeKpis(items) {
        const list = Array.isArray(items) ? items : [];
        const total = list.length;
        let open = 0, success = 0, lost = 0;

        for (const c of list) {
            const st = normStatus(c.status || c.case_status);
            if (st === "in_progress") open++;
            else if (st === "success") success++;
            else if (st === "lost") lost++;
            // „new” i „other” nie zwiększają żadnego z trzech liczników
        }
        return { total, open, success, lost };
    }

    // === KPI WPS z aktualnie widocznych wierszy ===
    // === KPI WPS z aktualnie widocznych wierszy — auto-wykrywanie kolumn ===
    function recalcMoneyKPIFromDOM() {
        try {
            const tbody = document.getElementById('caseTableBody') || document.querySelector('tbody');
            if (!tbody) return;

            // wykryj indeksy kolumn po nagłówkach
            const thead = tbody.closest('table')?.querySelector('thead');
            let colWps = 3, colStatus = 5; // domyślne fallbacki
            if (thead) {
                const heads = Array.from(thead.querySelectorAll('th')).map(th => (th.textContent || '').trim().toLowerCase());
                const findIdx = (rxs, def) => {
                    for (let i = 0; i < heads.length; i++) {
                        const h = heads[i];
                        if (rxs.some(rx => rx.test(h))) return i;
                    }
                    return def;
                };
                colWps = findIdx([/wps/, /kwota.*sprawy/, /wartość.*przedmiotu.*sporu/, /wartość.*wps/], colWps);
                colStatus = findIdx([/status/, /stan/, /etap/], colStatus);
            }

            // bierzemy tylko wiersze widoczne
            const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
            if (rows.length === 0) {
                ['kpiWszystkie', 'kpiAll', 'kpiTotal', 'kpiOpen', 'kpiWtok', 'kpiInProgress', 'kpiAvg', 'kpiAverage', 'kpiSrednia']
                    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
                return;
            }

            let sumAll = 0, sumOpen = 0, countOpen = 0;

            for (const tr of rows) {
                const tds = tr.querySelectorAll('td');
                const rawWps = (tds[colWps]?.textContent || '0')
                    .replace(/\u00A0/g, '')            // twarde spacje
                    .replace(/\s|[^0-9.,-]/g, '')      // zostaw cyfry i . ,
                    .replace(',', '.');
                const wps = Number(rawWps) || 0;

                const status = (tds[colStatus]?.textContent || '').toLowerCase().trim();

                sumAll += wps;
                if (/(^|\s)(w\s*toku|in[_\s]?progress|open|otwarta)(\s|$)/i.test(status)) {
                    sumOpen += wps;
                    countOpen++;
                }
            }

            const avgOpen = countOpen ? Math.round(sumOpen / countOpen) : 0;
            const pln = n => Number(n).toLocaleString('pl-PL', { minimumFractionDigits: 0 });

            // helper do wpisywania pod różne możliwe ID
            const setAny = (ids, val) => {
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.textContent = pln(val);
                        el.classList?.add?.('kpiValue-updated');
                        setTimeout(() => el.classList?.remove?.('kpiValue-updated'), 600);
                    }
                });
            };

            setAny(['kpiWszystkie', 'kpiAll', 'kpiTotal'], sumAll);
            setAny(['kpiOpen', 'kpiWtok', 'kpiInProgress'], sumOpen);
            setAny(['kpiAvg', 'kpiAverage', 'kpiSrednia'], avgOpen);

            window.__wps = { sumAll, sumOpen, avgOpen };
        } catch (err) {
            // cicho – nie spamujemy konsoli
        }
    }


    // udostępniamy globalnie
    window.recalcMoneyKPIFromDOM = window.recalcMoneyKPIFromDOM || recalcMoneyKPIFromDOM;


    // === lekki harmonogram (bez pętli) ===
    let _wpsRaf = null;
    function scheduleRecalcMoneyKPI() {
        if (_wpsRaf) cancelAnimationFrame(_wpsRaf);
        _wpsRaf = requestAnimationFrame(() => recalcMoneyKPIFromDOM());
    }


    // === obserwuj WYŁĄCZNIE dodanie/usunięcie wierszy w #caseTableBody ===
    let _moRows = null;
    function attachRowsObserver() {
        const tbody = document.getElementById('caseTableBody');
        if (!tbody) return;

        if (_moRows) _moRows.disconnect();
        _moRows = new MutationObserver(muts => {
            const realChange = muts.some(m =>
                m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
            );
            if (realChange) scheduleRecalcMoneyKPI();
        });

        _moRows.observe(tbody, {
            childList: true,
            subtree: false,
            attributes: false,
            characterData: false
        });
    }


    // === jeśli podmieniono całe <tbody>, podepnij observer ponownie ===
    let _moTbodySwap = null;
    function watchForTbodyReplacement() {
        if (_moTbodySwap) _moTbodySwap.disconnect();
        _moTbodySwap = new MutationObserver(() => {
            const tbody = document.getElementById('caseTableBody');
            if (tbody) attachRowsObserver();
        });
        _moTbodySwap.observe(document.body, { childList: true, subtree: true });
    }
});
// --- wystawienie funkcji globalnie (naprawa scope) ---
window.recalcMoneyKPIFromDOM = recalcMoneyKPIFromDOM;
window.attachRowsObserver = typeof attachRowsObserver === 'function' ? attachRowsObserver : function () { };
window.watchForTbodyReplacement = typeof watchForTbodyReplacement === 'function' ? watchForTbodyReplacement : function () { };


// === fallback: jeśli attachRowsObserver / watchForTbodyReplacement nie są zdefiniowane ===

// obserwuje zmiany wierszy tabeli
window.attachRowsObserver = window.attachRowsObserver || function attachRowsObserver() {
    const tbody = document.getElementById('caseTableBody');
    if (!tbody) return;

    if (window._moRows) window._moRows.disconnect();
    window._moRows = new MutationObserver(muts => {
        const realChange = muts.some(m =>
            m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
        );
        if (realChange && typeof window.recalcMoneyKPIFromDOM === 'function') {
            window.recalcMoneyKPIFromDOM();
        }
    });

    window._moRows.observe(tbody, {
        childList: true,
        subtree: false
    });
};

// obserwuje wymianę całego <tbody>
window.watchForTbodyReplacement = window.watchForTbodyReplacement || function watchForTbodyReplacement() {
    if (window._moTbodySwap) window._moTbodySwap.disconnect();
    window._moTbodySwap = new MutationObserver(() => {
        const tbody = document.getElementById('caseTableBody');
        if (tbody) window.attachRowsObserver();
    });
    window._moTbodySwap.observe(document.body, { childList: true, subtree: true });
};
// === HARD-GLOBAL defs (na wypadek zasięgu/module) ===
window.recalcMoneyKPIFromDOM = window.recalcMoneyKPIFromDOM || function () { };

// obserwator zmian wierszy tabeli (childList only)
window.attachRowsObserver = window.attachRowsObserver || function attachRowsObserver() {
    const tbody = document.getElementById('caseTableBody');
    if (!tbody) return;
    if (window._moRows) window._moRows.disconnect();
    window._moRows = new MutationObserver(muts => {
        const realChange = muts.some(m => m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length));
        if (realChange && typeof window.recalcMoneyKPIFromDOM === 'function') window.recalcMoneyKPIFromDOM();
    });
    window._moRows.observe(tbody, { childList: true, subtree: false });
};

// obserwator podmiany całego <tbody>
window.watchForTbodyReplacement = window.watchForTbodyReplacement || function watchForTbodyReplacement() {
    if (window._moTbodySwap) window._moTbodySwap.disconnect();
    window._moTbodySwap = new MutationObserver(() => {
        const tbody = document.getElementById('caseTableBody');
        if (tbody) window.attachRowsObserver();
    });
    window._moTbodySwap.observe(document.body, { childList: true, subtree: true });
};
// === jeśli pasek KPI nie istnieje, utwórz go z właściwymi ID ===
function ensureKpiBar() {
    // jeśli już jest któryś z docelowych elementów — nic nie rób
    if (
        document.getElementById('kpiWszystkie') ||
        document.getElementById('kpiOpen') ||
        document.getElementById('kpiWtok') ||
        document.getElementById('kpiAvg')
    ) return;

    const bar = document.createElement('div');
    bar.id = 'kpiBar';
    bar.style.marginBottom = '16px';
    bar.style.display = 'grid';
    bar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
    bar.style.gap = '12px';
    bar.innerHTML = `
    <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
      <div class="kpiLabel">Wszystkie WPS</div>
      <div id="kpiWszystkie" class="kpiValue">0</div>
    </div>
    <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
      <div class="kpiLabel">W toku (WPS)</div>
      <div id="kpiOpen" class="kpiValue">0</div>
    </div>
    <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
      <div class="kpiLabel">W toku (alias)</div>
      <div id="kpiWtok" class="kpiValue">0</div>
    </div>
    <div class="kpiBox" style="background:#f8f9fa;border-radius:12px;padding:10px 12px;text-align:center;">
      <div class="kpiLabel">Śr. WPS (w toku)</div>
      <div id="kpiAvg" class="kpiValue">0</div>
    </div>
  `;

    // wstaw pasek nad tabelą
    const tableContainer =
        document.querySelector('#caseTableBody')?.closest('section,div') ||
        document.querySelector('table')?.parentElement ||
        document.body;
    tableContainer.prepend(bar);
}


// === start po załadowaniu strony ===
document.addEventListener('DOMContentLoaded', () => {
    ensureKpiBar();

    try { window.recalcMoneyKPIFromDOM && window.recalcMoneyKPIFromDOM(); } catch (e) { }
    try { typeof bindKpiFilters === 'function' && bindKpiFilters(); } catch (e) { }
    window.attachRowsObserver();
    window.watchForTbodyReplacement();
    // dogrywka, gdy tabela ładuje się chwilę później:
    setTimeout(() => { try { window.recalcMoneyKPIFromDOM(); } catch (e) { } }, 300);
});

// === AWARYJNY pasek KPI (działa zawsze) ===
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const tbody = document.getElementById('caseTableBody') || document.querySelector('tbody');
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (!rows.length) return;

        let sumAll = 0, sumOpen = 0, countOpen = 0;
        for (const tr of rows) {
            const tds = tr.querySelectorAll('td');
            const kwota = Number((tds[3]?.textContent || '0')
                .replace(/\s|[^0-9.,-]/g, '')
                .replace(',', '.')) || 0;
            const status = (tds[5]?.textContent || '').toLowerCase().trim();
            sumAll += kwota;
            if (/w\s*toku|open|in[_\s]?progress/i.test(status)) {
                sumOpen += kwota;
                countOpen++;
            }
        }

        const avgOpen = countOpen ? Math.round(sumOpen / countOpen) : 0;
        const pln = n => n.toLocaleString('pl-PL', { minimumFractionDigits: 0 });

        // usuń stare paski
        document.getElementById('kpiBarInjected')?.remove();

        // wstaw nowy pasek
        const bar = document.createElement('div');
        bar.id = 'kpiBarInjected';
        bar.style.cssText = `
      display:grid;
      grid-template-columns:repeat(4,1fr);
      gap:12px;
      background:#fff;
      margin:16px 0;
    `;
        bar.innerHTML = `
      <div style="background:#f8f9fa;padding:10px;border-radius:12px;text-align:center;">
        <div>Wszystkie WPS</div><div style="font-weight:700">${pln(sumAll)} zł</div>
      </div>
      <div style="background:#f8f9fa;padding:10px;border-radius:12px;text-align:center;">
        <div>W toku (WPS)</div><div style="font-weight:700">${pln(sumOpen)} zł</div>
      </div>
      <div style="background:#f8f9fa;padding:10px;border-radius:12px;text-align:center;">
        <div>Śr. WPS (w toku)</div><div style="font-weight:700">${pln(avgOpen)} zł</div>
      </div>
      <div style="background:#fff"></div>
    `;

        const table = document.querySelector('table');
        table?.parentElement?.insertBefore(bar, table);
        console.log('✅ Pasek KPI awaryjny odświeżony', { sumAll, sumOpen, avgOpen });
    }, 800);
});