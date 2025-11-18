console.log('case.js loaded');

// ========== Helpers ==========
const authHeaders = () => ({ Authorization: 'Bearer ' + (localStorage.getItem('pk_token') || '') });
const fmtDateTime = (s) => (s ? new Date(s).toLocaleString('pl-PL') : '—');
const getCaseId = () => new URLSearchParams(location.search).get('id') || '';

const LS = {
  get: (k, d=null) => {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

const lsKeyNotes  = (id) => `pk_case_${id}_notes`;
const lsKeyFiles  = (id) => `pk_case_${id}_files`;
const lsKeyProbeN =        `pk_api_notes_pattern`; // '/api/...:id' albo 'none'
const lsKeyProbeF =        `pk_api_files_pattern`;

let USING_LOCAL_NOTES = false;
let USING_LOCAL_FILES = false;

// ========== “Probe once” – ciche wykrycie i cache wzorca ==========
const NOTE_CANDIDATES = (id) => [
  `/api/notes?case_id=${id}`,
  `/api/notes?caseId=${id}`,
  `/api/cases/${id}/notes`,
  `/api/case/${id}/notes`,
  `/api/notes/${id}`,
  `/api/case-notes?case_id=${id}`,
  `/api/case-notes?caseId=${id}`,
  `/api/notes` // może zwrócić wszystkie – ok
];

const FILE_CANDIDATES = (id) => [
  `/api/files?case_id=${id}`,
  `/api/files?caseId=${id}`,
  `/api/attachments?case_id=${id}`,
  `/api/attachments?caseId=${id}`,
  `/api/cases/${id}/files`,
  `/api/case/${id}/files`,
  `/api/files/${id}`,
  `/api/files`,
  `/api/attachments`
];

// Nie hałasujemy w konsoli; próbujemy GET i akceptujemy ok/204/405
async function tryGetSilent(url) {
  try {
    const r = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (r.ok || r.status === 204 || r.status === 405) return r.status;
  } catch {}
  return 404;
}

// Zwraca pattern z ':id' albo 'none'. Cache w localStorage.
async function resolvePatternOnce(kind, rawId) {
  const id = encodeURIComponent(rawId);
  const lsKey = kind === 'notes' ? lsKeyProbeN : lsKeyProbeF;
  const cached = LS.get(lsKey, null);
  if (cached === 'none' || (typeof cached === 'string' && cached.includes('/'))) return cached;

  const candidates = (kind === 'notes' ? NOTE_CANDIDATES(id) : FILE_CANDIDATES(id));
  for (const url of candidates) {
    const st = await tryGetSilent(url);
    if (st !== 404) {
      const pattern = url.replace(id, ':id');
      LS.set(lsKey, pattern);
      return pattern;
    }
  }
  LS.set(lsKey, 'none');
  return 'none';
}

const makeUrlFromPattern = (pattern, rawId) => {
  const id = encodeURIComponent(rawId);
  if (!pattern || pattern === 'none') return null;
  if (pattern.includes(':id')) return pattern.replace(':id', id);
  return pattern; // płaski endpoint, np. /api/notes
};

// Czy endpoint “płaski” → trzeba dorzucić case_id w body/query
const needsCaseIdInBody = (pattern) =>
  !pattern || pattern === 'none' || (!pattern.includes(':id') && !pattern.includes('?case_id=') && !pattern.includes('?caseId='));


// Ustala ID sprawy z różnych źródeł (URL / data-attributes)
function resolveCaseId() {
  // 1) Jeśli backend kiedyś doda data-case-id na <body>, to też to obsłużymy
  const fromBody = document.body?.dataset?.caseId;
  if (fromBody) {
    return fromBody;
  }

  // 2) Ścieżka w stylu /cases/123
  const path = window.location.pathname || "";
  const m = path.match(/\/cases\/(\d+)/);
  if (m && m[1]) {
    return m[1];
  }

  // 3) Fallback: query param ?id=123 (na wszelki wypadek)
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("id");
  if (fromQuery) {
    return fromQuery;
  }

  // 4) Nic nie znaleźliśmy
  return null;
}
// ========== Case details ==========
async function fetchCaseDetails() {
  const caseId = resolveCaseId();
  if (!caseId) {
    console.error("Brak poprawnego ID sprawy (resolveCaseId zwróciło null)");
    alert("Nie udało się ustalić ID sprawy z adresu strony.");
    return;
  }

  try {
    const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    console.log("[case] details:", data);

    // ===== Tytuł + status w nagłówku =====
    const caseTitleEl  = document.getElementById("caseTitle");
    const caseIdEl     = document.getElementById("caseId");
    const caseStatusEl = document.getElementById("caseStatus");
    const badgeEl      = document.getElementById("caseStatusBadge");

    if (caseTitleEl)  caseTitleEl.textContent  = `Sprawa #${data.id ?? "—"}`;
    if (caseIdEl)     caseIdEl.textContent     = data.id ?? "—";
    if (caseStatusEl) caseStatusEl.textContent = data.status_label ?? data.status ?? "—";
    if (badgeEl) {
      badgeEl.className =
        "badge badge--" + String(data.status || "").replace(/\s+/g, "");
    }

    // ===== Linijka pod tytułem =====
    const headerClientName   = document.getElementById("headerClientName");
    const headerBankName     = document.getElementById("headerBankName");
    const headerContractDate = document.getElementById("headerContractDate");

    if (headerClientName)   headerClientName.textContent   = data.client ?? "—";
    if (headerBankName)     headerBankName.textContent     = data.bank ?? "—";
    if (headerContractDate) headerContractDate.textContent = data.contract_date ?? "—";

    // ===== KPIs WPS / korzyść klienta =====
    const headerWpsForecast   = document.getElementById("headerWpsForecast");
    const headerWpsFinal      = document.getElementById("headerWpsFinal");
    const headerClientBenefit = document.getElementById("headerClientBenefit");

    const fmt = (n) =>
      n == null
        ? "—"
        : Number(n).toLocaleString("pl-PL", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          });

    if (headerWpsForecast) {
      const v =
        data.wps_forecast_display ??
        (data.wps_forecast != null ? fmt(data.wps_forecast) : "—");
      headerWpsForecast.textContent = v;
    }

    if (headerWpsFinal) {
      const v =
        data.wps_final_display ??
        (data.wps_final != null ? fmt(data.wps_final) : "—");
      headerWpsFinal.textContent = v;
    }

    if (headerClientBenefit) {
      const v =
        data.client_benefit_display ??
        (data.client_benefit != null ? fmt(data.client_benefit) : "—");
      headerClientBenefit.textContent = v;
    }

    // ===== Dane klienta (sekcja "Dane klienta") =====
    const clientNameEl    = document.getElementById("clientName");
    const clientPhoneEl   = document.getElementById("clientPhone");
    const clientEmailEl   = document.getElementById("clientEmail");
    const clientAddressEl = document.getElementById("clientAddress");
    const clientPeselEl   = document.getElementById("clientPesel");

    if (clientNameEl)    clientNameEl.textContent    = data.client ?? "—";
    if (clientPhoneEl)   clientPhoneEl.textContent   = data.phone ?? "—";
    if (clientEmailEl)   clientEmailEl.textContent   = data.email ?? "—";
    if (clientAddressEl) clientAddressEl.textContent = data.address ?? "—";
    if (clientPeselEl)   clientPeselEl.textContent   = data.pesel ?? "—";
    // ===== Wypełnienie formularza "Dane do umowy" =====
    const clientInp   = document.getElementById("caseClientInput");
    const phoneInp    = document.getElementById("casePhoneInput");
    const emailInp    = document.getElementById("caseEmailInput");
    const addressInp  = document.getElementById("caseAddressInput");
    const peselInp    = document.getElementById("casePeselInput");
    const loanInp     = document.getElementById("caseLoanAmountInput");
    const bankInp     = document.getElementById("caseBankInput");
    const contractInp = document.getElementById("caseContractDateInput");

    if (clientInp)   clientInp.value   = data.client  ?? "";
    if (phoneInp)    phoneInp.value    = data.phone   ?? "";
    if (emailInp)    emailInp.value    = data.email   ?? "";
    if (addressInp)  addressInp.value  = data.address ?? "";
    if (peselInp)    peselInp.value    = data.pesel   ?? "";
    if (loanInp)     loanInp.value     = data.loan_amount != null ? String(data.loan_amount) : "";
    if (bankInp)     bankInp.value     = data.bank ?? "";
    if (contractInp) contractInp.value = data.contract_date ?? "";
// ========== Auto-save "Dane umowy" ==========
document.addEventListener("input", async (ev) => {
  const t = ev.target;
  if (!t.closest("#caseContractSection")) return;

  const payload = {
    loan_amount: document.getElementById("caseLoanInput")?.value ?? null,
    bank: document.getElementById("caseBankInput")?.value ?? null,
    contract_date: document.getElementById("caseContractDateInput")?.value ?? null,
  };

  try {
    await fetch(`/api/cases/${caseId}/contract`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {}
});
  } catch (err) {
    console.error("Case fetch error:", err);
    alert("Nie udało się pobrać szczegółów sprawy.");
  }
}
// === ZAPIS DANYCH UMOWY (3B) ===
document.addEventListener("DOMContentLoaded", async () => {
  console.log("case.js loaded");

  // 1) Najpierw ładujemy dane sprawy
  await fetchCaseDetails();

  // 2) Podpinamy klik do "Zapisz dane umowy"
  const saveBtn = document.getElementById("caseContractSaveBtn");
  if (!saveBtn) {
    console.warn("Brak przycisku #caseContractSaveBtn w DOM");
  } else {
    saveBtn.addEventListener("click", async () => {
      console.log("[case] kliknięto Zapisz dane umowy");

      const caseId = resolveCaseId();
      if (!caseId) {
        alert("Brak ID sprawy – nie mogę zapisać danych umowy.");
        return;
      }

      // TE SAME ID, których używasz wyżej w fetchCaseDetails
      const clientInp    = document.getElementById("caseClientInput");
      const phoneInp     = document.getElementById("casePhoneInput");
      const emailInp     = document.getElementById("caseEmailInput");
      const addressInp   = document.getElementById("caseAddressInput");
      const peselInp     = document.getElementById("casePeselInput");
      const loanInp      = document.getElementById("caseLoanInput");
      const bankInp      = document.getElementById("caseBankInput");
      const contractInp  = document.getElementById("caseContractDateInput");

      const payload = {};

      if (clientInp)   payload.client        = clientInp.value || null;
      if (phoneInp)    payload.phone         = phoneInp.value || null;
      if (emailInp)    payload.email         = emailInp.value || null;
      if (addressInp)  payload.address       = addressInp.value || null;
      if (peselInp)    payload.pesel         = peselInp.value || null;
      if (loanInp)     payload.loan_amount   = loanInp.value || null;
      if (bankInp)     payload.bank          = bankInp.value || null;
      if (contractInp) payload.contract_date = contractInp.value || null;

      try {
        const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error("HTTP " + res.status);

        console.log("[case] dane umowy zapisane", payload);
        alert("Dane umowy zostały zapisane.");
      } catch (err) {
        console.error("Błąd zapisu danych umowy:", err);
        alert("Nie udało się zapisać danych umowy. Sprawdź konsolę.");
      }
    });
  }

  console.log("[case] hooks ready");
});

// ========== Local fallback ==========
const readNotesLS = (id) => LS.get(lsKeyNotes(id), []);
const writeNotesLS = (id, arr) => LS.set(lsKeyNotes(id), arr);
const readFilesLS = (id) => LS.get(lsKeyFiles(id), []);
const writeFilesLS = (id, arr) => LS.set(lsKeyFiles(id), arr);

// ========== Notes ==========
function renderNotes(items) {
  const box = document.getElementById('notesList');
  if (!box) return;
  if (!items.length) { box.innerHTML = 'Brak notatek'; return; }
  box.innerHTML = items.map(n => `
    <div class="note" data-id="${n.id}">
      <div>
        <div style="font-weight:700">
          ${n.text || n.content || n.message || ''}
          ${n.__local ? '<span style="font-size:11px;color:#9ca3af"> (lokalnie)</span>' : ''}
        </div>
        <div style="font-size:12px;color:#6b7280">
          ${(n.author || 'System')} · ${fmtDateTime(n.created_at || n.createdAt)}
        </div>
      </div>
      <button class="btn btn-light" data-act="del-note">Usuń</button>
    </div>
  `).join('');
}

async function loadNotes(caseId) {
  USING_LOCAL_NOTES = false;

  // Spróbuj raz ustalić pattern (cache w LS). Jeśli brak – bez próbowania GET → LS.
  const pattern = await resolvePatternOnce('notes', caseId);
  if (pattern === 'none') {
    USING_LOCAL_NOTES = true;
    renderNotes(readNotesLS(caseId));
    return;
  }

  const url = makeUrlFromPattern(pattern, caseId);
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw 0;
    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    renderNotes(list);
  } catch {
    USING_LOCAL_NOTES = true;
    renderNotes(readNotesLS(caseId));
  }
}

async function addNote(caseId, text) {
  // Lokalny fallback
  const addLocal = () => {
    const list = readNotesLS(caseId);
    list.unshift({
      id: 'local_' + Date.now(),
      text,
      author: 'Ty',
      created_at: new Date().toISOString(),
      __local: true
    });
    writeNotesLS(caseId, list);
    return true;
  };

  const pattern = await resolvePatternOnce('notes', caseId);
  if (pattern === 'none') { USING_LOCAL_NOTES = true; return addLocal(); }

  const url = makeUrlFromPattern(pattern, caseId);
  const body = { text, content: text, message: text };
  if (needsCaseIdInBody(pattern)) { body.case_id = caseId; body.caseId = caseId; }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw 0;
    return true;
  } catch {
    USING_LOCAL_NOTES = true;
    return addLocal();
  }
}

async function deleteNote(caseId, noteId) {
  if (String(noteId).startsWith('local_') || USING_LOCAL_NOTES) {
    writeNotesLS(caseId, readNotesLS(caseId).filter(n => n.id !== noteId));
    return true;
  }
  const pattern = await resolvePatternOnce('notes', caseId);
  if (pattern === 'none') {
    writeNotesLS(caseId, readNotesLS(caseId).filter(n => n.id !== noteId));
    USING_LOCAL_NOTES = true;
    return true;
  }

  // Konstruujemy kandydatów DELETE na podstawie patternu GET
  const id = encodeURIComponent(caseId);
  const nid = encodeURIComponent(noteId);
  const delUrls = [
    `/api/notes/${nid}`,
    `/api/cases/${id}/notes/${nid}`,
    `/api/case/${id}/notes/${nid}`,
    `/api/case-notes/${nid}`
  ];
  for (const u of delUrls) {
    try {
      const r = await fetch(u, { method: 'DELETE', headers: authHeaders() });
      if (r.ok) return true;
    } catch {}
  }
  // jeśli nic nie poszło – usuń lokalnie
  writeNotesLS(caseId, readNotesLS(caseId).filter(n => n.id !== noteId));
  USING_LOCAL_NOTES = true;
  return true;
}

// ========== Files ==========
function renderFiles(items) {
  const box = document.getElementById('attachmentsList');
  if (!box) return;
  if (!items.length) { box.innerHTML = 'Brak załączników'; return; }
  box.innerHTML = items.map(f => `
    <div class="file" data-id="${f.id}">
      <div>
        <div style="font-weight:700">
          ${f.filename || f.name || 'plik'}
          ${f.__local ? '<span style="font-size:11px;color:#9ca3af"> (lokalnie)</span>' : ''}
        </div>
        <div style="font-size:12px;color:#6b7280">
          ${(((f.size || 0) / 1024) | 0)} KB · ${fmtDateTime(f.created_at || f.createdAt)}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        ${f.url ? `<a class="btn btn-light" href="${f.url}" target="_blank">Podgląd</a>` : ''}
        ${f.url ? `<a class="btn btn-light" href="${f.url}" download>Pobierz</a>` : ''}
        <button class="btn btn-light" data-act="del-file">Usuń</button>
      </div>
    </div>
  `).join('');
}

async function loadFiles(caseId) {
  USING_LOCAL_FILES = false;

  const pattern = await resolvePatternOnce('files', caseId);
  if (pattern === 'none') {
    USING_LOCAL_FILES = true;
    renderFiles(readFilesLS(caseId));
    return;
  }

  const url = makeUrlFromPattern(pattern, caseId);
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok) throw 0;
    const data = await r.json().catch(() => []);
    const list = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    renderFiles(list);
  } catch {
    USING_LOCAL_FILES = true;
    renderFiles(readFilesLS(caseId));
  }
}

async function uploadFiles(caseId, files) {
  if (!files?.length) return false;

  // lokalny zapis metadanych (bez realnego uploadu)
  const addLocal = () => {
    const local = readFilesLS(caseId);
    const now = Date.now();
    files.forEach((f, i) => {
      local.unshift({
        id: `local_${now}_${i}`,
        filename: f.name,
        size: f.size,
        created_at: new Date().toISOString(),
        url: null,
        __local: true
      });
    });
    writeFilesLS(caseId, local);
    return true;
  };

  const pattern = await resolvePatternOnce('files', caseId);
  if (pattern === 'none') { USING_LOCAL_FILES = true; return addLocal(); }

  // realny upload
  const url = makeUrlFromPattern(pattern, caseId);
  const fd = new FormData();
  files.forEach(f => { fd.append('file', f); fd.append('files', f); fd.append('files[]', f); });
  if (needsCaseIdInBody(pattern)) { fd.append('case_id', caseId); fd.append('caseId', caseId); }

  try {
    const resp = await fetch(url, { method: 'POST', headers: authHeaders(), body: fd });
    if (!resp.ok) throw 0;
    return true;
  } catch {
    USING_LOCAL_FILES = true;
    return addLocal();
  }
}

async function deleteFile(caseId, fileId) {
  if (String(fileId).startsWith('local_') || USING_LOCAL_FILES) {
    writeFilesLS(caseId, readFilesLS(caseId).filter(f => f.id !== fileId));
    return true;
  }

  const id = encodeURIComponent(caseId);
  const fid = encodeURIComponent(fileId);
  const delUrls = [
    `/api/files/${fid}`,
    `/api/attachments/${fid}`,
    `/api/cases/${id}/files/${fid}`,
    `/api/case/${id}/files/${fid}`
  ];
  for (const u of delUrls) {
    try {
      const r = await fetch(u, { method: 'DELETE', headers: authHeaders() });
      if (r.ok) return true;
    } catch {}
  }
  // fallback
  writeFilesLS(caseId, readFilesLS(caseId).filter(f => f.id !== fileId));
  USING_LOCAL_FILES = true;
  return true;
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  const id = getCaseId();
  if (!id) { alert('Brak ID sprawy'); return; }

  await fetchCaseDetails();
  await loadNotes(id);
  await loadFiles(id);

  // Dodaj notatkę
  const noteBtn = document.getElementById('noteAdd');
  const noteInp = document.getElementById('noteInput');
  if (noteBtn && noteInp) {
    noteBtn.addEventListener('click', async () => {
      const text = (noteInp.value || '').trim();
      if (!text) return;
      const ok = await addNote(id, text);
      if (ok) { noteInp.value = ''; await loadNotes(id); }
    });
  }

  // + Dodaj plik → selektor
  document.getElementById('attachAddBtn')?.addEventListener('click', () =>
    document.getElementById('fileInput')?.click()
  );

  // Dropzone
  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('fileInput');
  if (dz && fi) {
    dz.addEventListener('click', () => fi.click());
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.style.background = '#f3f4f6'; });
    dz.addEventListener('dragleave', () => { dz.style.background = '#fafafa'; });
    dz.addEventListener('drop', async (e) => {
      e.preventDefault(); dz.style.background = '#fafafa';
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      const ok = await uploadFiles(id, files);
      if (ok) await loadFiles(id);
    });
    fi.addEventListener('change', async () => {
      const files = [...(fi.files || [])];
      if (!files.length) return;
      const ok = await uploadFiles(id, files);
      fi.value = '';
      if (ok) await loadFiles(id);
    });
  }

  // Delegacje: usuń
  document.getElementById('notesList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act="del-note"]');
    if (!btn) return;
    const row = btn.closest('.note');
    const nid = row?.dataset.id;
    if (!nid) return;
    const ok = await deleteNote(id, nid);
    if (!ok) return alert('Nie udało się usunąć notatki');
    row.remove();
  });

  document.getElementById('attachmentsList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act="del-file"]');
    if (!btn) return;
    const row = btn.closest('.file');
    const fid = row?.dataset.id;
    if (!fid) return;
    const ok = await deleteFile(id, fid);
    if (!ok) return alert('Nie udało się usunąć pliku');
    row.remove();
  });

  // Szybkie akcje
  document.getElementById('actSendMail')?.addEventListener('click', () => {
    const email = document.getElementById('clientEmail')?.textContent || '';
    if (!email || email === '—') return alert('Brak adresu e-mail klienta.');
    window.location.href = `mailto:${email}?subject=Sprawa%20${encodeURIComponent(document.getElementById('caseId')?.textContent || '')}`;
  });
  document.getElementById('actExportPdf')?.addEventListener('click', () => {
    window.open(`/api/cases/${encodeURIComponent(id)}/export`, '_blank');
  });
  document.getElementById('actDelete')?.addEventListener('click', async () => {
    if (!confirm('Na pewno usunąć tę sprawę?')) return;
    const r = await fetch(`/api/cases/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) return alert('Nie udało się usunąć sprawy.');
    location.href = '/dashboard.html';
  });

  console.log('[case] hooks ready');
});