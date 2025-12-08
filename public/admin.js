// public/admin.js

// === TABS ===
const tabs = document.querySelectorAll(".admin-tab");
const panels = document.querySelectorAll(".admin-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;

    let leadsCache = [];
    // aktywny tab
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    // aktywny panel
    panels.forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === target);
    });

    // przełączanie logiki
    if (target === "users") {
      loadUsers();
    } else if (target === "cases") {
      loadAdminCases();
    } else if (target === "stats") {
      loadAdminStats();
    } else if (target === "leads") {
      loadLeads();
    }
  });
});

// === ŁADOWANIE UŻYTKOWNIKÓW ===
async function loadUsers() {
  try {
    const res = await fetch("/api/admin/users", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await res.json();

    if (res.status === 403) {
      alert("Brak uprawnień do panelu administratora.");
      window.location.href = "/dashboard.html";
      return;
    }

    if (!res.ok) {
      console.error("Błąd ładowania użytkowników:", data);
      alert("Błąd ładowania użytkowników");
      return;
    }

    renderUsers(data.users || []);
  } catch (e) {
    console.error("Load users error:", e);
    alert("Błąd połączenia przy ładowaniu użytkowników");
  }
}

function renderUsers(users) {
  const tbody = document.querySelector("#usersTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  users.forEach((u) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.email}</td>
      <td>${u.name}</td>
      <td>
        ${u.role === "admin"
        ? '<span class="badge-admin">Admin</span>'
        : '<span class="badge-agent">Agent</span>'
      }
      </td>
      <td>${u.is_active ? "✔️" : "❌"}</td>
      <td>${u.last_login
        ? new Date(u.last_login).toLocaleString("pl-PL")
        : "—"
      }</td>
    `;

    tbody.appendChild(tr);
  });
}

// === MODAL: DODAWANIE UŻYTKOWNIKA ===
const addUserModal = document.getElementById("addUserModal");
const btnAddUser = document.getElementById("btnAddUser");
const btnCancelNewUser = document.getElementById("cancelNewUser");
const btnSaveNewUser = document.getElementById("saveNewUser");

function openAddUserModal() {
  if (addUserModal) {
    addUserModal.style.display = "flex";
  }
}

function closeAddUserModal() {
  if (addUserModal) {
    addUserModal.style.display = "none";
  }
}

if (btnAddUser) {
  btnAddUser.addEventListener("click", () => {
    console.log("CLICK btnAddUser");
    openAddUserModal();
  });
}

if (btnCancelNewUser) {
  btnCancelNewUser.addEventListener("click", () => {
    closeAddUserModal();
  });
}

if (btnSaveNewUser) {
  btnSaveNewUser.addEventListener("click", async () => {
    const emailEl = document.getElementById("newUserEmail");
    const nameEl = document.getElementById("newUserName");
    const passEl = document.getElementById("newUserPassword");
    const roleEl = document.getElementById("newUserRole");

    if (!emailEl || !nameEl || !passEl || !roleEl) {
      alert("Brakuje pól w formularzu (sprawdź HTML modala).");
      return;
    }

    const email = emailEl.value.trim();
    const name = nameEl.value.trim();
    const password = passEl.value.trim();
    const role = roleEl.value;

    if (!email || !name || !password) {
      alert("Uzupełnij wszystkie pola");
      return;
    }

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, role }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Błąd POST /api/admin/users:", data);
        alert("Błąd: " + (data.error || res.status));
        return;
      }

      alert("Użytkownik dodany!");

      emailEl.value = "";
      nameEl.value = "";
      passEl.value = "";
      roleEl.value = "agent";

      closeAddUserModal();
      loadUsers();
    } catch (err) {
      console.error(err);
      alert("Błąd połączenia przy dodawaniu użytkownika");
    }
  });
}

// ===== STAN SPRAW (dla filtrów i paginacji) =====
let adminCasesAll = [];
let adminCasesPage = 1;
const ADMIN_CASES_PAGE_SIZE = 20;

// === ADMIN: LISTA SPRAW ===
function renderAdminCases(cases) {
  const table = document.getElementById("adminCasesTable");
  const empty = document.getElementById("adminCasesEmpty");

  if (!table || !table.tBodies || !table.tBodies[0]) return;
  const tbody = table.tBodies[0];
  tbody.innerHTML = "";

  if (!cases || cases.length === 0) {
    if (empty) empty.style.display = "block";
    table.style.display = "none";
    return;
  }

  if (empty) empty.style.display = "none";
  table.style.display = "table";

  cases.forEach((c) => {
    const tr = document.createElement("tr");

    const amountNum =
      c.loan_amount != null ? Number(c.loan_amount) : null;
    const amountDisplay =
      amountNum != null && !Number.isNaN(amountNum)
        ? amountNum.toLocaleString("pl-PL", {
          maximumFractionDigits: 0,
        }) + " zł"
        : "—";

    const created = c.created_at
      ? new Date(c.created_at).toLocaleDateString("pl-PL")
      : "—";

    const ownerLabel = c.owner_name
      ? c.owner_email
        ? `${c.owner_name} (${c.owner_email})`
        : c.owner_name
      : "—";

    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.client || "—"}</td>
      <td>${c.bank || "—"}</td>
      <td>${amountDisplay}</td>
      <td>${c.status || "—"}</td>
      <td>${ownerLabel}</td>
      <td>${created}</td>
    `;

    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => {
      if (!c.id) return;
      window.location.href = `/case.html?id=${c.id}`;
    });

    tbody.appendChild(tr);
  });
}

async function loadAdminCases() {
  try {
    const res = await fetch("/api/admin/cases", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      console.error("GET /api/admin/cases error:", res.status);
      return;
    }

    const data = await res.json();
    adminCasesAll = data.cases || [];
    adminCasesPage = 1;

    buildCasesOwnerFilter(adminCasesAll);
    applyCasesFiltersAndRender();
  } catch (err) {
    console.error("loadAdminCases error:", err);
  }
}
function buildCasesOwnerFilter(cases) {
  const select = document.getElementById("casesOwnerFilter");
  if (!select) return;

  // wyczyść stare opcje poza "wszyscy"
  select.innerHTML = '<option value="">Wszyscy ownerzy</option>';

  const ownersMap = new Map();

  cases.forEach((c) => {
    const key = c.owner_email || c.owner_name;
    if (!key) return;

    const label = c.owner_email
      ? `${c.owner_name || "Agent"} (${c.owner_email})`
      : c.owner_name;

    if (!ownersMap.has(key)) {
      ownersMap.set(key, label);
    }
  });

  Array.from(ownersMap.entries()).forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
}
function applyCasesFiltersAndRender() {
  const searchInput = document.getElementById("casesSearchInput");
  const statusSelect = document.getElementById("casesStatusFilter");
  const ownerSelect = document.getElementById("casesOwnerFilter");

  const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const statusFilter = statusSelect ? statusSelect.value : "";
  const ownerFilter = ownerSelect ? ownerSelect.value : "";

  let filtered = adminCasesAll.slice();

  if (search) {
    filtered = filtered.filter((c) => {
      const haystack = [
        c.id?.toString() || "",
        c.client || "",
        c.bank || "",
        c.status || "",
        c.owner_name || "",
        c.owner_email || "",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }

  if (statusFilter) {
    filtered = filtered.filter((c) => (c.status || "") === statusFilter);
  }

  if (ownerFilter) {
    filtered = filtered.filter((c) => {
      const key = c.owner_email || c.owner_name;
      return key === ownerFilter;
    });
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / ADMIN_CASES_PAGE_SIZE));

  if (adminCasesPage > totalPages) {
    adminCasesPage = totalPages;
  }

  const start = (adminCasesPage - 1) * ADMIN_CASES_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + ADMIN_CASES_PAGE_SIZE);

  renderAdminCases(pageItems);
  renderCasesPagination(totalPages, total);
}
function renderCasesPagination(totalPages, totalItems) {
  const wrap = document.getElementById("adminCasesPagination");
  if (!wrap) return;

  wrap.innerHTML = "";

  if (totalPages <= 1) {
    if (totalItems === 0) {
      wrap.textContent = "Brak spraw do wyświetlenia.";
    } else {
      wrap.textContent = `Łącznie: ${totalItems}`;
    }
    return;
  }

  const info = document.createElement("span");
  info.textContent = `Strona ${adminCasesPage} z ${totalPages} (łącznie: ${totalItems})`;
  wrap.appendChild(info);

  const prev = document.createElement("button");
  prev.className = "admin-page-btn";
  prev.textContent = "«";
  prev.disabled = adminCasesPage <= 1;
  prev.addEventListener("click", () => {
    if (adminCasesPage > 1) {
      adminCasesPage--;
      applyCasesFiltersAndRender();
    }
  });
  wrap.appendChild(prev);

  for (let p = 1; p <= totalPages; p++) {
    const btn = document.createElement("button");
    btn.className = "admin-page-btn";
    if (p === adminCasesPage) btn.classList.add("active");
    btn.textContent = String(p);
    btn.addEventListener("click", () => {
      adminCasesPage = p;
      applyCasesFiltersAndRender();
    });
    wrap.appendChild(btn);
  }

  const next = document.createElement("button");
  next.className = "admin-page-btn";
  next.textContent = "»";
  next.disabled = adminCasesPage >= totalPages;
  next.addEventListener("click", () => {
    if (adminCasesPage < totalPages) {
      adminCasesPage++;
      applyCasesFiltersAndRender();
    }
  });
  wrap.appendChild(next);
}
// === STATYSTYKI ADMINA ===

function formatPLN(n) {
  if (n == null) return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return "—";
  return (
    num.toLocaleString("pl-PL", { maximumFractionDigits: 0 }) + " zł"
  );
}

async function loadAdminStats() {
  try {
    const res = await fetch("/api/admin/stats", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error("GET /api/admin/stats error:", res.status);
      return;
    }

    const data = await res.json();
    renderAdminStatsKpi(data.stats || {});
    renderAdminStatsBanks(data.topBanks || []);
    renderAdminStatsAgents(data.topAgents || []);
    renderAdminStatsLast7(data.last7 || []);
  } catch (err) {
    console.error("loadAdminStats error:", err);
  }
}

function renderAdminStatsKpi(stats) {
  const wrap = document.getElementById("adminStatsKpi");
  if (!wrap) return;

  const totalCases = stats.total_cases ?? 0;
  const openCases = stats.open_cases ?? 0;
  const newCases = stats.new_cases ?? 0;
  const totalWps = stats.total_wps ?? 0;
  const avgLoan = stats.avg_loan_amount ?? 0;

  wrap.innerHTML = `
    <div class="stats-card">
      <div class="stats-card-label">Wszystkie sprawy</div>
      <div class="stats-card-value">${totalCases}</div>
      <div class="stats-card-sub">łącznie w systemie</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-label">Sprawy otwarte</div>
      <div class="stats-card-value">${openCases}</div>
      <div class="stats-card-sub">niezamknięte / niearchiwalne</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-label">Nowe sprawy</div>
      <div class="stats-card-value">${newCases}</div>
      <div class="stats-card-sub">status = "nowa"</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-label">Suma WPS</div>
      <div class="stats-card-value">${formatPLN(totalWps)}</div>
      <div class="stats-card-sub">łącznie (forecast)</div>
    </div>
    <div class="stats-card">
      <div class="stats-card-label">Śr. kwota kredytu</div>
      <div class="stats-card-value">${formatPLN(avgLoan)}</div>
      <div class="stats-card-sub">na sprawę</div>
    </div>
  `;
}

function renderAdminStatsBanks(banks) {
  const box = document.getElementById("adminStatsBanks");
  if (!box) return;

  if (!banks.length) {
    box.innerHTML = '<div class="stats-list-row">Brak danych</div>';
    return;
  }

  box.innerHTML = "";
  banks.forEach((b) => {
    const row = document.createElement("div");
    row.className = "stats-list-row";
    row.innerHTML = `
      <span>${b.bank}</span>
      <span>${b.count}</span>
    `;
    box.appendChild(row);
  });
}

function renderLeads(leads) {
  const tbody = document.querySelector("#leadsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!leads || leads.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8">Brak leadów</td>`;
    tbody.appendChild(tr);
    return;
  }

  leads.forEach((lead) => {
    const tr = document.createElement("tr");
    tr.dataset.leadId = lead.id;

    const created =
      lead.created_at
        ? new Date(lead.created_at).toLocaleString("pl-PL")
        : "—";

    const statusLabel = mapLeadStatusLabel(lead.status);
    const statusClass = mapLeadStatusClass(lead.status);

    tr.innerHTML = `
      <td>${lead.id}</td>
      <td>${lead.type || "—"}</td>
      <td>${lead.source || "—"}</td>
      <td>${lead.full_name || "—"}</td>
      <td>${lead.email || "—"}</td>
      <td>${lead.phone || "—"}</td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td>${created}</td>
    `;

    // Kliknięcie = otwieramy modal ze szczegółami
    tr.addEventListener("click", () => openLeadModal(lead));
    tbody.appendChild(tr);
  });
}

let currentLead = null;

function openLeadModal(lead) {
  currentLead = lead;

  const box = document.getElementById("leadDetailsBox");
  if (box) {
    box.innerHTML = `
      <p><b>ID:</b> ${lead.id}</p>
      <p><b>Imię i nazwisko:</b> ${lead.full_name || "—"}</p>
      <p><b>Email:</b> ${lead.email || "—"}</p>
      <p><b>Telefon:</b> ${lead.phone || "—"}</p>
      <p><b>Typ:</b> ${lead.type || "—"}</p>
      <p><b>Źródło:</b> ${lead.source || "—"}</p>
      <p><b>Data:</b> ${lead.created_at
        ? new Date(lead.created_at).toLocaleString("pl-PL")
        : "—"
      }</p>
    `;
  }

  // ustawiamy status w select
  const select = document.getElementById("leadStatusSelect");
  if (select && lead.status) {
    select.value = lead.status;
  }

  const modal = document.getElementById("leadModal");
  if (modal) modal.style.display = "flex";
}

// zamykanie modala
const leadModalCloseBtn = document.getElementById("leadModalCloseBtn");
if (leadModalCloseBtn) {
  leadModalCloseBtn.addEventListener("click", () => {
    const modal = document.getElementById("leadModal");
    if (modal) modal.style.display = "none";
  });
}

// zapis statusu leada
const leadStatusSaveBtn = document.getElementById("leadStatusSaveBtn");
if (leadStatusSaveBtn) {
  leadStatusSaveBtn.addEventListener("click", async () => {
    if (!currentLead) return;

    const select = document.getElementById("leadStatusSelect");
    if (!select) return;

    const newStatus = select.value;
    console.log("🔎 PATCH lead status →", {
      id: currentLead.id,
      status: newStatus,
    });

    try {
      const res = await fetch(`/api/admin/leads/${currentLead.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        alert("Błąd przy zapisie statusu");
        return;
      }

      alert("Status zapisany");

      // przeładuj listę leadów
      if (typeof loadLeads === "function") {
        loadLeads();
      }

      // zamknij modal
      const modal = document.getElementById("leadModal");
      if (modal) modal.style.display = "none";
    } catch (err) {
      console.error(err);
      alert("Błąd połączenia przy zapisie statusu leada");
    }
  });
}

// ➕ UTWÓRZ SPRAWĘ Z LEADA
const leadConvertBtn = document.getElementById("leadConvertBtn");
if (leadConvertBtn) {
  leadConvertBtn.addEventListener("click", async () => {
    if (!currentLead) return;

    try {
      const res = await fetch(
        `/api/admin/leads/${currentLead.id}/convert-to-case`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" }
        }
      );

      const data = await res.json();

      if (!res.ok || !data.ok) {
        console.error("Błąd konwersji leada:", data);
        alert("Nie udało się utworzyć sprawy z tego leada.");
        return;
      }

      alert(
        `Sprawa została utworzona. ID sprawy: ${data.case_id}\nPrzechodzę do szczegółów sprawy.`
      );

      window.location.href = `/case.html?id=${data.case_id}`;
    } catch (err) {
      console.error("Wyjątek przy konwersji leada:", err);
      alert("Błąd połączenia podczas tworzenia sprawy.");
    }
  });
}
function mapLeadStatusLabel(status) {
  switch (status) {
    case "new":
      return "Nowy";
    case "in_progress":
      return "W analizie";
    case "qualified":
      return "Kwalifikuje się";
    case "rejected":
      return "Nie kwalifikuje się";
    case "processed":
      return "Przerobiony";
    default:
      return status || "—";
  }
}

function mapLeadStatusClass(status) {
  switch (status) {
    case "new":
      return "badge-lead badge-lead-new";
    case "in_progress":
      return "badge-lead badge-lead-progress";
    case "qualified":
      return "badge-lead badge-lead-qualified";
    case "rejected":
      return "badge-lead badge-lead-rejected";
    case "processed":
      return "badge-lead badge-lead-processed";
    default:
      return "badge-lead";
  }

}

function updateLeadsBadge(count) {
  const badge = document.getElementById("leadsCounterBadge");
  if (!badge) return;

  if (!count) {
    badge.style.display = "none";
    return;
  }

  badge.textContent = count;
  badge.style.display = "inline-block";
}

// === MODAL SZCZEGÓŁÓW LEADA ===

const leadModal = document.getElementById("leadDetailsModal");
const leadModalClose = document.getElementById("leadDetailsClose");
const leadMarkProcessedBtn = document.getElementById("leadMarkProcessed");

function openLeadDetailsModal(leadId) {
  if (!leadModal) return;

  const lead = leadsCache.find((l) => l.id === leadId);
  if (!lead) return;

  // Podstawowe pola
  const created = lead.created_at
    ? new Date(lead.created_at).toLocaleString("pl-PL")
    : "—";

  const status = lead.status || "new";

  document.getElementById("leadDetailsTitle").textContent =
    lead.full_name || "Szczegóły leada";
  document.getElementById("leadDetailsId").textContent = lead.id;
  document.getElementById("leadDetailsCreated").textContent = created;
  document.getElementById("leadDetailsType").textContent = lead.type || "—";
  document.getElementById("leadDetailsSource").textContent = lead.source || "—";
  document.getElementById("leadDetailsName").textContent =
    lead.full_name || "—";
  document.getElementById("leadDetailsPhone").textContent =
    lead.phone || "—";
  document.getElementById("leadDetailsEmail").textContent =
    lead.email || "—";

  document.getElementById("leadStatusLabel").textContent =
    status === "processed" ? "przetworzony" : "nowy";

  const metaPre = document.getElementById("leadDetailsMeta");
  if (metaPre) {
    metaPre.textContent = lead.meta
      ? JSON.stringify(lead.meta, null, 2)
      : "—";
  }

  // Przycisk "oznacz jako przetworzony"
  if (leadMarkProcessedBtn) {
    if (status === "processed") {
      leadMarkProcessedBtn.style.display = "none";
      leadMarkProcessedBtn.onclick = null;
    } else {
      leadMarkProcessedBtn.style.display = "inline-block";
      leadMarkProcessedBtn.onclick = async () => {
        await markLeadProcessed(lead.id);
      };
    }
  }

  leadModal.style.display = "flex";
}

async function markLeadProcessed(id) {
  try {
    const res = await fetch(`/api/admin/leads/${id}/status`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "processed" }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("PATCH /api/admin/leads/:id/status error:", data);
      alert("Nie udało się zaktualizować statusu leada.");
      return;
    }

    // Update w cache
    const idx = leadsCache.findIndex((l) => l.id === id);
    if (idx !== -1) {
      leadsCache[idx].status = "processed";
    }

    closeLeadDetailsModal();
    loadLeads(); // odśwież tabelę i badge
  } catch (err) {
    console.error("markLeadProcessed error:", err);
    alert("Błąd połączenia przy aktualizacji leada.");
  }
}

function closeLeadDetailsModal() {
  if (leadModal) {
    leadModal.style.display = "none";
  }
}

if (leadModalClose) {
  leadModalClose.addEventListener("click", () => {
    closeLeadDetailsModal();
  });
}

// Zamknięcie modala po kliknięciu w tło
if (leadModal) {
  leadModal.addEventListener("click", (e) => {
    if (e.target === leadModal) {
      closeLeadDetailsModal();
    }
  });
}
function renderAdminStatsAgents(agents) {
  const box = document.getElementById("adminStatsAgents");
  if (!box) return;

  if (!agents.length) {
    box.innerHTML = '<div class="stats-list-row">Brak danych</div>';
    return;
  }

  box.innerHTML = "";
  agents.forEach((a) => {
    const row = document.createElement("div");
    row.className = "stats-list-row";
    const label = a.email
      ? `${a.name || "Agent"} (${a.email})`
      : a.name || "Agent";
    row.innerHTML = `
      <span>${label}</span>
      <span>${a.count}</span>
    `;
    box.appendChild(row);
  });
}

function renderAdminStatsLast7(items) {
  const box = document.getElementById("adminStatsLast7");
  if (!box) return;

  if (!items.length) {
    box.innerHTML = '<div class="stats-list-row">Brak spraw w ostatnich 7 dniach</div>';
    return;
  }

  const max = items.reduce(
    (m, x) => (x.count > m ? x.count : m),
    0
  ) || 1;

  box.innerHTML = "";
  items.forEach((d) => {
    const row = document.createElement("div");
    row.className = "stats-bar-row";

    const label = document.createElement("div");
    label.className = "stats-bar-label";
    label.textContent = d.date;

    const track = document.createElement("div");
    track.className = "stats-bar-track";

    const fill = document.createElement("div");
    fill.className = "stats-bar-fill";
    fill.style.width = `${(d.count / max) * 100}%`;

    track.appendChild(fill);
    row.appendChild(label);
    row.appendChild(track);

    const count = document.createElement("div");
    count.textContent = d.count;
    row.appendChild(count);

    box.appendChild(row);
  });
}


async function loadLeads() {
  try {
    const res = await fetch("/api/admin/leads", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    const data = await res.json();

    if (res.status === 403) {
      alert("Brak uprawnień do podglądu leadów.");
      window.location.href = "/dashboard.html";
      return;
    }

    if (!res.ok) {
      console.error("Błąd /api/admin/leads:", data);
      alert("Błąd ładowania leadów");
      return;
    }

    // backend może zwrócić np. { ok: true, leads: [...] } albo { ok:true, rows:[...] }
    const rows = data.leads || data.rows || [];
    renderLeads(rows);
  } catch (err) {
    console.error("loadLeads error:", err);
    alert("Błąd połączenia przy ładowaniu leadów");
  }
}
// === AUTO-START ===
document.addEventListener("DOMContentLoaded", () => {
  console.log("Admin panel loaded");

  loadUsers();
  loadAdminCases();
  loadAdminStats();

  const searchInput = document.getElementById("casesSearchInput");
  const statusSelect = document.getElementById("casesStatusFilter");
  const ownerSelect = document.getElementById("casesOwnerFilter");

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      adminCasesPage = 1;
      applyCasesFiltersAndRender();
    });
  }

  if (statusSelect) {
    statusSelect.addEventListener("change", () => {
      adminCasesPage = 1;
      applyCasesFiltersAndRender();
    });
  }

  if (ownerSelect) {
    ownerSelect.addEventListener("change", () => {
      adminCasesPage = 1;
      applyCasesFiltersAndRender();
    });
  }
});