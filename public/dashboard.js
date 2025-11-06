// === global diagnostics (poza DOMContentLoaded) ===
window.addEventListener('error', (e) => {
    console.error('GLOBAL JS ERROR →', e.message, 'at', e.filename + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('UNHANDLED PROMISE →', e.reason);
});
console.log('dashboard.js loaded');

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
        const data = await fetchJSON('/api/kpi');
        (document.getElementById('kpiAll') || {}).textContent = Number(data.all ?? 0);
        (document.getElementById('kpiOpen') || {}).textContent = Number(data.open ?? 0);
        (document.getElementById('kpiSuccess') || {}).textContent = Number(data.success ?? 0);
        (document.getElementById('kpiLost') || {}).textContent = Number(data.lost ?? 0);
        (document.getElementById('kpiThisMonth') || {}).textContent = Number(data.thisMonth ?? 0);
        console.log('KPI fetched');
    }

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


    function renderKpis(k) {
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            // czyścimy placeholdery i wpisujemy liczby
            el.textContent = "";
            el.innerText = String(val);
        };
        set("kpiAll", k.total);
        set("kpiOpen", k.open);
        set("kpiSuccess", k.success);
        set("kpiLost", k.lost);
    }
    // ===== /KPI =====




    // === LISTA SPRAW ===
    async function loadCases(status = '') {
        console.log('loadCases() start');
        const tBody = document.getElementById('caseTableBody');
        if (!tBody) { console.warn('Brak #caseTableBody w loadCases'); return; }

        tBody.innerHTML = '<tr><td colspan="5">Ładowanie…</td></tr>';

        let d;
        try {
            d = await fetchJSON('/api/cases');
        } catch (e) {
            tBody.innerHTML = `<tr><td colspan="5">Błąd /api/cases: ${e.message}</td></tr>`;
            return;
        }
        async function loadCases() {
            // ... Twój fetch:
            const d = await fetchJSON('/api/cases?...');    // albo jakkolwiek to masz

            // ... tu renderujesz tabelę z d.items ...

            // --- KPI z tych samych danych co tabela ---
            try {
                console.log('🔸 items for KPI', items);
                const k = computeKpis(items);
                console.log('✅ KPI recalculated:', k);
                renderKpis(k);
                console.log('📊 renderKpis called');
            } catch (e) {
                console.warn('KPI compute error:', e);
            }


        }

        const statusNorm = String(status || '').toLowerCase();
        const itemsAll = Array.isArray(d?.items) ? d.items : [];
        const items = statusNorm
            ? itemsAll.filter(c => String(c.status || '').toLowerCase() === statusNorm)
            : itemsAll;

        if (!items.length) {
            tBody.innerHTML = '<tr><td colspan="5">Brak spraw w bazie</td></tr>';
            return;
        }

        tBody.innerHTML = items.map(c => {
            console.log('CASE row →', c); // 👈 log diagnostyczny – pokaże dokładnie dane
            const amountStr = Number(c.loan_amount ?? 0).toLocaleString('pl-PL');

            // upewniamy się, że WPS istnieje i jest liczbowy
            const wpsStr =
                c.wps !== null && c.wps !== undefined && c.wps !== ''
                    ? Number(c.wps).toLocaleString('pl-PL')
                    : '—';

            const raw = String(c.contract_date || c.signed_at || c.created_at || '');
            const norm = raw.includes('T') ? raw : raw.replace(' ', 'T');
            const dObj = new Date(norm);
            const dateStr = isNaN(dObj) ? '—' : dObj.toLocaleDateString('pl-PL');
            const statusStr = String(c.status || '—');
            // --- KPI: licz z dokładnie tych samych danych co tabela ---
            try {
                const items = Array.isArray(d?.items) ? d.items : (Array.isArray(d) ? d : []);
                lastItems = items;

                const k = computeKpis(items);
                requestAnimationFrame(() => {
                    renderKpis(k);
                    console.log("✅ KPI recalculated & rendered:", k);
                });
            } catch (e) {
                console.warn("KPI compute/render error:", e);
            }

            return `
<tr data-id="${c.id ?? ''}">
  <td>${c.client ?? '—'}</td>
  <td>${amountStr}</td>
  <td>${wpsStr}</td>
  <td>${dateStr}</td>
  <td>${statusStr}</td>
</tr>`;
        }).join('');

        console.log('loadCases() done');
    }

    // === INIT: tabela + KPI ===
    console.log('before loadCases');
    await loadCases();
    console.log('after loadCases');

    // Filtr statusu (jeśli jest)
    const sel = document.getElementById('flt_status');
    const btn = document.getElementById('flt_refresh');
    if (btn && sel) btn.addEventListener('click', async () => {
        await loadCases(sel.value || '');
        /*await fetchKPI(); // KPI na razie globalnie (bez filtra)*/
    });

    // --- referencje modala (raz, globalnie) ---
    const cmModal = document.getElementById('caseModal');
    const cmClient = document.getElementById('cmClient');
    const cmWps = document.getElementById('cmWps');
    const cmStatus = document.getElementById('cmStatus');
    const cmAmount = document.getElementById('cmAmount'); // ✅ tu
    const cmDate = document.getElementById('cmDate');   // ✅ tu
    if (cmAmount) cmAmount.setAttribute('step', 'any');
    const addBank = document.getElementById('addBank'); // z formularza „Dodaj nową sprawę”
    const cmBank = document.getElementById('cmBank');  // z modala

    fillBankSelect(addBank, "");
    fillBankSelect(cmBank, "");

    // === Dodawanie nowej sprawy ===
    const addBtn = document.getElementById('addCaseBtn');
    const addClientEl = document.getElementById('addClient');
    const addAmountEl = document.getElementById('addAmount');
    const addBankEl = document.getElementById('addBank');

    addBtn?.addEventListener('click', async (e) => {
        e.preventDefault();

        const client = addClientEl?.value?.trim() || '';
        const amountRaw = (addAmountEl?.value || '').replace(',', '.');
        const amount = parseFloat(amountRaw);
        const bank = addBankEl?.value || '';

        if (!client) return alert('Podaj klienta');
        if (Number.isNaN(amount)) return alert('Podaj poprawną kwotę');

        const payload = {
            client,
            loan_amount: amount,
            status: 'nowa',
            bank: bank || null
        };

        console.log('POST /api/cases payload =', payload);

        try {
            await fetchJSON('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // wyczyść formularz
            addClientEl.value = '';
            addAmountEl.value = '';
            addBankEl.value = '';

            // pokaż wszystkie sprawy i odśwież tabelę
            const flt = document.getElementById('flt_status');
            if (flt) flt.value = '';
            await loadCases?.('');

        } catch (err) {
            console.error('Add case error:', err);
            alert('Nie udało się dodać sprawy: ' + (err?.message || ''));
        }
    });


    /*bindKPI();*/
    //await fetchKPI();//


    // === Modal: otwieranie po kliknięciu w wiersz ===
    const tbodyEl = document.getElementById('caseTableBody');
    if (tbodyEl) {
        tbodyEl.addEventListener('click', (ev) => {
            const tr = ev.target.closest('tr');
            if (!tr) return;

            const caseId = tr.getAttribute('data-id') || '';
            if (!caseId) return;

            const modalEl = cmModal; // użyj globalnej referencji
            if (!modalEl || !cmClient || !cmWps || !cmStatus) return;

            // mini "loading" / reset
            cmClient.value = 'ładowanie…';
            cmWps.value = '';
            cmStatus.value = 'nowa';
            if (cmAmount) cmAmount.value = '';
            if (cmDate) cmDate.value = '';

            fetchJSON(`/api/cases/${encodeURIComponent(caseId)}`)
                .then(d => {
                    cmClient.value = d.client || ''; // zmiana z client_name
                    cmWps.value = (d.wps ?? '') !== '' ? String(d.wps) : '';
                    cmStatus.value = d.status || 'nowa';

                    if (cmAmount) cmAmount.value = d.loan_amount == null ? '' : String(Number(d.loan_amount));
                    if (cmDate) {
                        cmDate.removeAttribute('disabled'); // pozwól mu się wypełnić
                        console.log('contract_date=', d.contract_date);
                        cmDate.value = d.contract_date || '';
                        cmDate.setAttribute('disabled', true); // z powrotem zablokuj
                    }

                    // --- BANK w modalu: ustaw wartość z rekordu ---
                    if (cmBank) {
                        const val = d.bank || "";

                        // jeśli select nie był jeszcze wypełniony → wypełnij i od razu wybierz wartość
                        if (!cmBank.options.length) {
                            fillBankSelect(cmBank, val);
                        } else {
                            // jeśli tego banku nie ma na liście (np. stara nazwa) → dodaj tymczasowo
                            if (val && ![...cmBank.options].some(o => o.value === val)) {
                                const opt = document.createElement('option');
                                opt.value = val;
                                opt.textContent = val;
                                cmBank.appendChild(opt);
                            }
                            cmBank.value = val;
                        }

                        console.log('🧾 modal: ustawiam bank =', val);
                    }


                    modalEl.dataset.caseId = String(d.id || caseId);
                    modalEl.style.display = 'block';
                })
                .catch(err => {
                    console.error('DETAILS ERROR', err);
                    alert('Nie udało się pobrać szczegółów sprawy.');
                });
        });
    }



    // === Modal: zamykanie ===
    const cmCloseEl = document.getElementById('cmClose');
    const modalEl2 = document.getElementById('caseModal');
    if (cmCloseEl && modalEl2) {
        cmCloseEl.addEventListener('click', () => (modalEl2.style.display = 'none'));
        modalEl2.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-backdrop')) modalEl2.style.display = 'none';
        });
    }

    // === Formularz dodawania sprawy (jeśli istnieje w prawej kolumnie) ===
    const form = document.getElementById('newCaseForm');
    const msg = document.getElementById('nc_msg');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (msg) msg.textContent = 'Zapisywanie…';

            const client = document.getElementById('nc_client').value.trim();
            const loan_amount = Number(document.getElementById('nc_amount').value);
            const status = document.getElementById('nc_status').value;

            try {
                await fetchJSON('/api/cases', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client, loan_amount, status })
                });
                form.reset();
                if (msg) msg.textContent = 'Dodano ✔︎';
                await loadCases();
                /*await fetchKPI();*/
                if (msg) setTimeout(() => (msg.textContent = ''), 1200);
            } catch (err) {
                if (msg) msg.textContent = 'Błąd: ' + err.message;
            }
        });
    }
    // MODAL: zapis WPS / Status
    const cmSave = document.getElementById('cmSave');
    const modalElSave = document.getElementById('caseModal');

    if (cmSave && modalElSave) {
        cmSave.addEventListener('click', async () => {
            const id = modalElSave.dataset.caseId || '';
            if (!id) { alert('Brak ID sprawy.'); return; }

            // pobranie wartości z pól
            const wpsRaw = document.getElementById('cmWps')?.value?.trim() ?? '';
            const statusVal = document.getElementById('cmStatus')?.value ?? 'nowa';
            const elAmount = document.getElementById('cmAmount');
            const amountRaw = elAmount ? elAmount.value.trim() : '';

            const dateRaw = document.getElementById('cmDate')?.value?.trim() ?? '';

            // normalizacja liczb (usuń spacje, zamień przecinek na kropkę)
            const normNum = (v) => {
                if (v === '' || v == null) return null;
                const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
                return Number.isFinite(n) ? n : null;
            };

            const wpsNorm = normNum(wpsRaw);
            const amountNorm = normNum(amountRaw);

            // walidacja daty (YYYY-MM-DD) – jeśli pusta, traktuj jako null
            let dateNorm = null;
            if (dateRaw) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
                    alert('Nieprawidłowy format daty. Użyj YYYY-MM-DD.');
                    return;
                }
                dateNorm = dateRaw;
            }

            // budujemy payload tylko z wartościami, które mamy
            const payload = {
                wps: wpsNorm,                // może być null → COALESCE po stronie backendu
                status: statusVal || null,
                loan_amount: amountNorm,     // NOWE
                contract_date: dateNorm      // NOWE
            };
            if (cmBank) payload.bank = cmBank.value || null;

            try {
                await fetchJSON(`/api/cases/${encodeURIComponent(id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                // zamknij modal i odśwież widoki
                modalElSave.style.display = 'none';
                await loadCases();
                /*await fetchKPI();*/
            } catch (e) {
                console.error('SAVE ERROR', e);
                alert('Nie udało się zapisać: ' + (e?.message || e));
            }
        });

    }

    // --- Wylogowanie ---
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        localStorage.removeItem('token');
        window.location.href = '/login.html';
    });

    console.log('init done');
});
