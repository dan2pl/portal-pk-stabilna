document.addEventListener('DOMContentLoaded', async () => {
    const out = document.getElementById('out');
    const token = localStorage.getItem('pk_token');
    if (!token) location.href = '/login.html';

    document.getElementById('logout').onclick = () => {
        localStorage.removeItem('pk_token');
        localStorage.removeItem('pk_user');
        location.href = '/login.html';
    };

    const outData = document.getElementById('out');
    try {
        const r = await fetch('/api/health');
        const data = await r.json();
        outData.textContent = JSON.stringify({ ok: true, health: data, user: JSON.parse(localStorage.getItem('pk_user') || 'null') }, null, 2);
    } catch (e) {
        outData.textContent = 'Błąd: ' + e.message;
    }
    await loadCases();
    async function loadCases() {
        const tbody = document.querySelector('#casesTable tbody');
        try {
            const r = await fetch('/api/cases');
            const d = await r.json();
            if (!d.items?.length) {
                tbody.innerHTML = '<tr><td colspan="5">Brak spraw w bazie</td></tr>';
                return;
            }
            tbody.innerHTML = d.items.map(c => {
                const raw = String(c.created_at || '');
                const norm = raw.includes('T') ? raw : raw.replace(' ', 'T');
                const dObj = new Date(norm);
                const dateStr = isNaN(dObj) ? '' : dObj.toLocaleDateString('pl-PL');
                return `
        <tr>
          <td>${c.id}</td>
          <td>${c.client}</td>
          <td>${Number(c.loan_amount).toLocaleString('pl-PL')}</td>
          <td>${c.status}</td>
          <td>${dateStr}</td>
        </tr>`;
            }).join('');
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="5">Błąd /api/cases: ${e.message}</td></tr>`;
        }
    }
    const form = document.getElementById('newCaseForm');
    const msg = document.getElementById('nc_msg');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        msg.textContent = 'Zapisywanie…';

        const client = document.getElementById('nc_client').value.trim();
        const loan_amount = Number(document.getElementById('nc_amount').value);
        const status = document.getElementById('nc_status').value;

        try {
            const r = await fetch('/api/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client, loan_amount, status })
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.message || err.error || `HTTP ${r.status}`);
            }
            form.reset();
            msg.textContent = 'Dodano ✔︎';
            await loadCases();                   // odśwież tabelę
            setTimeout(() => (msg.textContent = ''), 1200);
        } catch (e) {
            msg.textContent = 'Błąd: ' + e.message;
        }
    });


});
