// public/admin.js

// === TABS ===
const tabs = document.querySelectorAll(".admin-tab");
const panels = document.querySelectorAll(".admin-panel");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;

    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    panels.forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === target);
    });
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
        ${
          u.role === "admin"
            ? '<span class="badge-admin">Admin</span>'
            : '<span class="badge-agent">Agent</span>'
        }
      </td>
      <td>${u.is_active ? "✔️" : "❌"}</td>
      <td>${
        u.last_login
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
    renderAdminCases(data.cases || []);
  } catch (err) {
    console.error("loadAdminCases error:", err);
  }
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
// === AUTO-START ===
document.addEventListener("DOMContentLoaded", () => {
  console.log("Admin panel loaded");

  loadUsers();        // zakładka "Użytkownicy"
  loadAdminCases();   // zakładka "Sprawy"
  loadAdminStats();   // zakładka "Statystyki"
});