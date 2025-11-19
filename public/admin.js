// public/admin.js

console.log("Admin panel loaded");

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
    const res = await fetch("/api/admin/users");
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
      alert("Błąd połączenia");
    }
  });
}

// start
loadUsers();