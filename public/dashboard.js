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
        await fetchKPI(); // KPI na razie globalnie (bez filtra)
    });

    // --- referencje modala (raz, globalnie) ---
    const cmModal = document.getElementById('caseModal');
    const cmClient = document.getElementById('cmClient');
    const cmWps = document.getElementById('cmWps');
    const cmStatus = document.getElementById('cmStatus');
    const cmAmount = document.getElementById('cmAmount'); // ✅ tu
    const cmDate = document.getElementById('cmDate');   // ✅ tu
    if (cmAmount) cmAmount.setAttribute('step', 'any');

    bindKPI();
    await fetchKPI();

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
                await fetchKPI();
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

            try {
                await fetchJSON(`/api/cases/${encodeURIComponent(id)}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                // zamknij modal i odśwież widoki
                modalElSave.style.display = 'none';
                await loadCases();
                await fetchKPI();
            } catch (e) {
                console.error('SAVE ERROR', e);
                alert('Nie udało się zapisać: ' + (e?.message || e));
            }
        });

    }


    console.log('init done');
});
