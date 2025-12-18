// === KONFIG ===
const API_BASE = "/api";

// === GLOBALNE ETYKIETY STATUSÓW (jedyna prawda) ===
const CASE_STATUS_LABELS = {
  NEW: "Nowa",
  ANALYSIS: "W analizie",
  ANALYSIS_DOCS_NEEDED: "Braki dokumentów do analizy",
  ANALYSIS_POSITIVE: "Analiza pozytywna",
  ANALYSIS_NEGATIVE: "Analiza negatywna",
  CONTRACT_PREP: "Przygotowanie umowy",
  CONTRACT_DOCS_NEEDED: "Oczekiwanie na dokumenty",
  CONTRACT_AT_AGENT: "Umowa u agenta",
  CONTRACT_SIGNED: "Umowa zawarta",
  IN_PROGRESS: "W toku",
  CLOSED_SUCCESS: "Zakończona – Sukces",
  CLOSED_FAIL: "Zakończona – Przegrana",
  CLIENT_RESIGNED: "Rezygnacja klienta",
};

// === POMOCNICZE ===
function $(id) {
  return document.getElementById(id);
}

function getCaseIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function normalizeDateToInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatCurrency(value) {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return (
    num.toLocaleString("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + " zł"
  );
}

function splitAddress(address) {
  if (!address) {
    return { street: "", city: "", postcode: "" };
  }

  const [left, right] = address.split(",").map((s) => s.trim());

  let street = right || "";
  let city = "";
  let postcode = "";

  if (left) {
    const parts = left.split(/\s+/);
    if (parts.length > 1 && /^\d{2}-\d{3}$/.test(parts[0])) {
      postcode = parts[0];
      city = parts.slice(1).join(" ");
    } else {
      city = left;
    }
  }

  if (!right && !street) {
    street = address;
  }

  return { street, city, postcode };
}

// === IBAN – formatowanie i walidacja ===
function attachIbanFormatter() {
  const input = $("contractIban");
  if (!input) return;

  function formatValue() {
    const raw = input.value || "";
    const clean = raw.replace(/\s+/g, "").toUpperCase();

    if (clean.length <= 2) {
      input.value = clean;
      return;
    }

    const first2 = clean.slice(0, 2);
    const rest = clean.slice(2);
    const restGrouped = rest.replace(/(.{4})/g, "$1 ").trim();

    input.value = restGrouped ? `${first2} ${restGrouped}` : first2;
  }

  input.addEventListener("input", formatValue);
  input.addEventListener("blur", formatValue);
}

function attachIbanValidator() {
  const input = $("contractIban");
  if (!input) return;

  const errorBox = document.createElement("div");
  errorBox.style.color = "#d9534f";
  errorBox.style.fontSize = "12px";
  errorBox.style.marginTop = "4px";
  errorBox.style.display = "none";
  errorBox.textContent = "Niepoprawny numer IBAN";
  input.insertAdjacentElement("afterend", errorBox);

  input.addEventListener("input", () => {
    const raw = input.value.replace(/\s+/g, "");
    let isValid = true;

    if (!/^\d{0,26}$/.test(raw.replace(/[A-Z]/gi, ""))) {
      isValid = false;
    }

    if (raw.length > 0 && raw.length < 26) {
      isValid = true;
      errorBox.style.display = "none";
      input.style.borderColor = "";
      return;
    }

    if (raw.startsWith("PL") && raw.length !== 28) {
      isValid = false;
    }

    if (!isValid) {
      input.style.borderColor = "#d9534f";
      errorBox.style.display = "block";
    } else {
      input.style.borderColor = "";
      errorBox.style.display = "none";
    }
  });
}

// === PROGRES ETAPU SPRAWY ===
function stageToProgress(statusCode) {
  switch (statusCode) {
    case "NEW":
      return 5;
    case "ANALYSIS":
      return 20;
    case "ANALYSIS_DOCS_NEEDED":
      return 25;
    case "ANALYSIS_POSITIVE":
      return 35;
    case "ANALYSIS_NEGATIVE":
      return 0;
    case "CONTRACT_PREP":
      return 50;
    case "CONTRACT_DOCS_NEEDED":
      return 55;
    case "CONTRACT_AT_AGENT":
      return 65;
    case "CONTRACT_SIGNED":
      return 75;
    case "IN_PROGRESS":
      return 85;
    case "CLOSED_SUCCESS":
      return 100;
    case "CLOSED_FAIL":
    case "CLIENT_RESIGNED":
      return 0;
    default:
      return 0;
  }
}

function updateCaseProgress(statusCode) {
  const fill = document.getElementById("caseProgressFill");
  if (!fill) return;
  const percent = stageToProgress(statusCode);
  fill.style.width = percent + "%";
}

function showSaveToast(message) {
  const existing = document.querySelector(".case-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "case-toast";
  toast.textContent = message || "Zapisano ✅";

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("case-toast--visible");
  });

  setTimeout(() => {
    toast.classList.remove("case-toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

function handleSectionSaved(_btn, message) {
  showSaveToast(message || "Zapisano zmiany ✅");
}

function attachFieldChangeMicroFX() {
  const inputs = document.querySelectorAll(
    "#panelClient input, #panelClient select, #panelClient textarea," +
    " #panelCredit input, #panelCredit select, #panelCredit textarea," +
    " #panelSkd input, #panelSkd select, #panelSkd textarea," +
    " #panelNotes textarea"
  );

  inputs.forEach((el) => {
    let lastValue = el.value;
    el.addEventListener("change", () => {
      if (el.value === lastValue) return;
      lastValue = el.value;

      el.classList.remove("case-input-changed");
      void el.offsetWidth;
      el.classList.add("case-input-changed");

      setTimeout(() => {
        el.classList.remove("case-input-changed");
      }, 500);
    });
  });
}

// === TABS ===
const tabButtons = document.querySelectorAll(".case-tab");
const tabPanels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;

    tabButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    tabPanels.forEach((panel) => {
      const panelTab = panel.dataset.tabPanel;
      panel.classList.toggle("active", panelTab === tab);
    });
  });
});

// === ACCORDION ===
document.querySelectorAll(".accordion-header").forEach((header) => {
  header.addEventListener("click", () => {
    const item = header.closest(".accordion-item");
    const isOpen = item.classList.contains("open");
    item.classList.toggle("open", !isOpen);
  });
});

// === ETAP SPRAWY – zapis tylko przez /cases/update-status ===
const caseStageSelect = $("caseStage");
const caseIdInput = $("caseIdValue");

async function saveCaseStatus() {
  if (!caseStageSelect) return;

  const caseId =
    Number(caseIdInput?.value) ||
    Number(new URLSearchParams(window.location.search).get("id"));

  const status = caseStageSelect.value;

  if (!caseId || !status) {
    console.warn("Brak caseId lub statusu przy zapisie etapu", {
      caseId,
      status,
    });
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/cases/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, status }),
    });

    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      console.error("Błąd przy zmianie statusu", data);
      alert("Nie udało się zapisać etapu sprawy.");
      return;
    }

    console.log("✅ Status sprawy zapisany:", data.case);
    updateCaseProgress(status);
    showSaveToast("Etap sprawy zapisany ✅");
  } catch (err) {
    console.error("Błąd requestu przy zmianie statusu:", err);
    alert("Wystąpił błąd przy zapisie etapu sprawy.");
  }
}

if (caseStageSelect) {
  caseStageSelect.addEventListener("change", saveCaseStatus);
}

// === WYPEŁNIANIE DANYCH Z API ===

function fillCaseHeader(data) {
  const caseIdHidden = $("caseIdValue");
  const caseId = data.id ?? data.caseId ?? "";

  if (caseIdHidden) {
    caseIdHidden.value = caseId || "";
  }

  const clientName =
    data.client ??
    data.clientName ??
    data.client_name ??
    data.client_full_name ??
    "—";

  const createdAt =
    data.contract_date ?? data.createdAt ?? data.created_at ?? null;

  const owner =
    data.ownerName ?? data.owner_name ?? data.caseOwner ?? "—";

  const status = data.status ?? data.caseStatus ?? data.case_status ?? "—";

  const bank =
    data.bank ??
    data.bankName ??
    data.bank_name ??
    data.creditBank ??
    "—";

  const product =
    data.productType ?? data.product_type ?? "Kredyt gotówkowy";

  const skdActive =
    data.skdActive ?? data.skd_active ?? data.hasSkd ?? false;

  const caseIdSpan = $("caseId");
  if (caseIdSpan) {
    caseIdSpan.textContent = caseId ? `#${caseId}` : "—";
  }

  $("caseClientName").textContent = clientName;
  $("caseCreatedAt").textContent = createdAt
    ? new Date(createdAt).toLocaleDateString("pl-PL")
    : "—";
  $("caseOwner").textContent = owner;

  const statusEl = $("caseStatus");
  if (statusEl) {
    statusEl.textContent =
      CASE_STATUS_LABELS[String(status)] || status || "—";
  }

  $("caseBank").textContent = bank;
  $("caseProductType").textContent = product;

  const skdTag = $("caseSkdTag");
  if (skdTag) {
    if (skdActive) {
      skdTag.textContent = "SKD aktywna";
      skdTag.classList.add("tag-success");
    } else {
      skdTag.textContent = "SKD brak";
      skdTag.classList.remove("tag-success");
    }
  }
}

function fillSidebar(data) {
  const creditAmount =
    data.loan_amount ??
    data.creditAmount ??
    data.credit_amount ??
    data.loanAmount;

  const totalCost =
    data.total_cost ??
    data.creditTotalCost ??
    data.credit_total_cost ??
    null;

  const skdPotential = data.skd_potential ?? data.skdPotential ?? null;

  const wps = data.wps_forecast ?? data.wps_final ?? data.wps ?? null;

  const stageCode =
    data.status_code ??
    data.stage ??
    data.caseStage ??
    data.status_stage ??
    data.status ??
    "NEW";

  const skdStatus = data.skd_status ?? data.skdStatus ?? "—";

  const lastUpdate = data.updated_at ?? data.updatedAt ?? null;

  $("summaryAmount").textContent = formatCurrency(creditAmount);
  $("summaryTotalCost").textContent = formatCurrency(totalCost);
  $("summarySkdPotential").textContent = formatCurrency(skdPotential);
  $("summaryWps").textContent = formatCurrency(wps);

  $("summaryStage").textContent =
    CASE_STATUS_LABELS[String(stageCode)] || stageCode || "—";
  $("summarySkdStatus").textContent = skdStatus;
  $("summaryLastUpdate").textContent = lastUpdate
    ? new Date(lastUpdate).toLocaleDateString("pl-PL")
    : "—";

  updateCaseProgress(stageCode);
}

function fillClientSection(data) {
  $("clientName").value =
    data.client ??
    data.clientName ??
    data.client_name ??
    data.client_full_name ??
    "";

  $("clientPesel").value =
    data.pesel ?? data.clientPesel ?? data.client_pesel ?? "";

  $("clientPhone").value =
    data.phone ?? data.clientPhone ?? data.client_phone ?? "";

  $("clientEmail").value =
    data.email ?? data.clientEmail ?? data.client_email ?? "";

  const addr = data.address ?? "";
  const { street, city, postcode } = splitAddress(addr);

  $("clientStreet").value = street;
  $("clientCity").value = city;
  $("clientPostcode").value = postcode;

  $("clientNotes").value = data.clientNotes ?? data.client_notes ?? "";

  const ibanInput = $("contractIban");
  if (ibanInput) {
    const ibanFromData =
      data.iban ?? data.contractIban ?? data.clientIban ?? "";
    ibanInput.value = ibanFromData || "";
  }

  let statusCode = data.status_code;

  if (!statusCode) {
    const raw = data.status;

    if (raw) {
      const upper = String(raw).toUpperCase();
      const known = [
        "NEW",
        "ANALYSIS",
        "ANALYSIS_DOCS_NEEDED",
        "ANALYSIS_POSITIVE",
        "ANALYSIS_NEGATIVE",
        "CONTRACT_PREP",
        "CONTRACT_DOCS_NEEDED",
        "CONTRACT_AT_AGENT",
        "CONTRACT_SIGNED",
        "IN_PROGRESS",
        "CLOSED_SUCCESS",
        "CLOSED_FAIL",
        "CLIENT_RESIGNED",
      ];

      if (known.includes(upper)) {
        statusCode = upper;
      } else {
        const legacy = String(raw).toLowerCase();
        switch (legacy) {
          case "nowa":
            statusCode = "NEW";
            break;
          case "analiza":
            statusCode = "ANALYSIS";
            break;
          case "przygotowanie":
            statusCode = "CONTRACT_PREP";
            break;
          case "wyslane":
            statusCode = "IN_PROGRESS";
            break;
          case "uznane":
            statusCode = "CLOSED_SUCCESS";
            break;
          case "odrzucone":
            statusCode = "CLOSED_FAIL";
            break;
          default:
            statusCode = "NEW";
        }
      }
    } else {
      statusCode = "NEW";
    }
  }

  if (caseStageSelect && statusCode) {
    caseStageSelect.value = statusCode;
    updateCaseProgress(statusCode);
  }
}

function fillCreditSection(data) {
  $("creditBank").value =
    data.bank ?? data.creditBank ?? data.bankName ?? data.bank_name ?? "";

  $("creditProduct").value = data.productType ?? data.product_type ?? "";

  $("creditAmount").value =
    data.loan_amount ?? data.creditAmount ?? data.credit_amount ?? "";

  $("creditTotalCost").value =
    data.total_cost ??
    data.creditTotalCost ??
    data.credit_total_cost ??
    "";

  $("creditStartDate").value = normalizeDateToInput(
    data.contract_date ?? data.creditStartDate ?? data.credit_start_date
  );

  $("creditEndDate").value = normalizeDateToInput(
    data.creditEndDate ?? data.credit_end_date
  );

  $("creditInstallment").value =
    data.creditInstallment ?? data.credit_installment ?? "";

  $("creditNotes").value = data.creditNotes ?? data.credit_notes ?? "";
}

function fillSkdSection(data) {
  console.log("[fillSkdSection] data =", data);

  const skdDate = data.skdDate ?? data.skd_date ?? data.skdSentDate;
  const skdPotential = data.skdPotential ?? data.skd_potential ?? "";
  const wps =
    data.skdWpsForecast ??
    data.skd_wps_forecast ??
    data.wpsForecast ??
    data.wps_forecast ??
    "";
  const variant =
    data.skdOfferVariant ?? data.skd_offer_variant ?? "prosty";
  const offerText = data.skdOfferText ?? data.skd_offer_text ?? "";

  const skdDateInput = $("skdDate");
  if (skdDateInput) {
    skdDateInput.value = normalizeDateToInput(skdDate);
  }

  const skdPotentialInput = $("skdPotential");
  if (skdPotentialInput) {
    skdPotentialInput.value = skdPotential;
  }

  const wpsInput = $("skdWpsForecast");
  if (wpsInput) {
    wpsInput.value = wps;
  }

  const variantSelect = $("skdOfferVariant");
  if (variantSelect) {
    variantSelect.value = variant;
  }

  const offerTextArea = $("skdOfferText");
  if (offerTextArea) {
    offerTextArea.value = offerText;
  }
}

function fillNotesSection(data) {
  $("caseNotes").value =
    data.notes ?? data.caseNotes ?? data.case_notes ?? "";
}
// === HISTORIA ZMIAN – RENDEROWANIE ===
function renderCaseHistory(logs) {
  const list = document.getElementById("caseHistoryList");
  if (!list) {
    console.warn("⚠️ Brak #caseHistoryList w DOM");
    return;
  }

  console.log("[renderCaseHistory] logs =", logs);

  list.innerHTML = "";

  if (!logs || !logs.length) {
    list.innerHTML =
      '<div class="case-history-empty">Brak zarejestrowanych zdarzeń dla tej sprawy.</div>';
    return;
  }

  logs.forEach((log, index) => {
    const item = document.createElement("div");
    item.className = "case-history-item case-anim";

    const createdAt = log.created_at
      ? new Date(log.created_at).toLocaleString("pl-PL")
      : "—";

    const userLabel = log.user_name
      ? `${log.user_name} (${log.user_email || "—"})`
      : "system";

    const title =
      log.message ||
      ({
        CASE_CREATED: "Sprawa utworzona",
        CASE_STATUS_CHANGED: "Zmiana statusu sprawy",
        LEAD_CONVERTED: "Sprawa utworzona z leada",
      }[log.action_type] || log.action_type || "Zdarzenie");

    item.innerHTML = `
      <div class="case-history-dot"></div>
      <div class="case-history-content">
        <div class="case-history-title">${title}</div>
        <div class="case-history-meta">
          ${createdAt} · ${userLabel}
        </div>
      </div>
    `;

    // 🔥 kluczowa linijka – od razu pokazujemy element
    item.classList.add("in-view");

    list.appendChild(item);
  });
}

// === HISTORIA ZMIAN – API ===
async function loadCaseHistory(caseId) {
  const list = document.getElementById("caseHistoryList");
  if (!list) return;

  try {
    const res = await fetch(
      `${API_BASE}/cases/${encodeURIComponent(caseId)}/logs`
    );

    if (!res.ok) {
      console.error("Błąd pobierania historii:", res.status);
      list.innerHTML =
        '<div class="case-history-empty">Nie udało się pobrać historii zmian.</div>';
      return;
    }

    const data = await res.json();
    console.log("[loadCaseHistory] response =", data);

    const logs = Array.isArray(data) ? data : data.logs || [];
    renderCaseHistory(logs);
  } catch (err) {
    console.error("Błąd loadCaseHistory:", err);
    list.innerHTML =
      '<div class="case-history-empty">Błąd połączenia podczas pobierania historii.</div>';
  }
}
// === FETCH DANYCH ===
async function fetchCaseDetails(caseId) {
  const res = await fetch(
    `${API_BASE}/cases/${encodeURIComponent(caseId)}`
  );
  if (res.status === 403) {
    alert("⛔ Nie masz dostępu do tej sprawy");
    window.location.href = "dashboard.html";
    return;
  }

  if (!res.ok) {
    throw new Error(`Błąd pobierania danych sprawy: ${res.status}`);
  }
  return await res.json();
}

// === ZAPISY DO BACKENDU (sekcje) ===
async function saveSection(caseId, section, payload) {
  let url = null;
  let method = "PATCH";

  switch (section) {
    case "client":
    case "credit":
    case "skd":
    case "notes":
      url = `${API_BASE}/cases/${caseId}`;
      break;
    case "skd-offer":
      url = `${API_BASE}/cases/${caseId}/skd-offer`;
      method = "PUT";
      break;
    default:
      throw new Error(`Nieznana sekcja zapisu: ${section}`);
  }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Błąd zapisu ${section}: ${res.status} ${text}`);
  }

  return res.json().catch(() => ({}));
}

// === UPLOAD PLIKÓW DOKUMENTÓW DO BACKENDU ===
async function uploadCaseFiles(caseId, files) {
  if (!files || !files.length) return;

  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));

  try {
    const res = await fetch(
      `${API_BASE}/cases/${encodeURIComponent(caseId)}/files`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Błąd uploadu plików:", res.status, text);
      alert("Nie udało się dodać plików ❌");
      return;
    }

    const data = await res.json().catch(() => ({}));
    console.log("📁 Pliki dodane do sprawy:", data);
  } catch (err) {
    console.error("Błąd uploadCaseFiles:", err);
    alert("Nie udało się dodać plików (błąd sieci) ❌");
  }
}

// === Renderowanie listy dokumentów ===
function renderCaseFiles(files) {
  const wrapper = document.getElementById("caseFileList");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  if (!files.length) {
    wrapper.innerHTML =
      '<div class="file-list-empty">Brak plików w tej sprawie</div>';
    return;
  }

  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "case-file-item case-row";

    row.innerHTML = `
      <div class="case-file-name">
        📄 ${f.original_name} (${Math.round(f.size / 1024)} KB)
      </div>
      <div class="case-file-actions">
        <div class="case-file-download" data-id="${f.id}">Pobierz</div>
        <div class="case-file-remove" data-id="${f.id}">✕</div>
      </div>
    `;

    wrapper.appendChild(row);
  });
  console.log("RENDER FILES →", files);
}

// === Pobieranie dokumentów sprawy ===
async function loadCaseFiles(caseId) {
  try {
    const res = await fetch(`/api/cases/${caseId}/files`);
    if (!res.ok) {
      console.error("Błąd pobierania dokumentów:", res.status);
      return renderCaseFiles([]);
    }

    const data = await res.json();
    console.log("LOAD_CASE_FILES RESULT =", data);

    const files = Array.isArray(data) ? data : data.files || [];
    renderCaseFiles(files);
  } catch (err) {
    console.error("Błąd loadCaseFiles:", err);
    renderCaseFiles([]);
  }

  console.log("LOAD_CASE_FILES → caseId =", caseId);
  console.log("FETCHING:", `/api/cases/${caseId}/files`);
}

// === DRAG & DROP DOKUMENTÓW (case.html) ===
function initCaseDocuments(caseId) {
  const $local = (id) => document.getElementById(id);

  const dropArea = $local("caseFileDropArea");
  const fileInput = $local("caseAddFiles");
  const fileList = $local("caseFileList");

  if (!dropArea || !fileInput) {
    console.warn("❗ Dokumenty: brak elementów dropArea/fileInput");
    return;
  }

  dropArea.addEventListener("click", (e) => {
    if (e.target.closest("a")) {
      return;
    }
    fileInput.click();
  });

  let firstInit = true;

  fileInput.addEventListener("change", async () => {
    if (firstInit) {
      firstInit = false;
      fileInput.value = "";
      return;
    }

    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

    await uploadCaseFiles(caseId, files);
    await loadCaseFiles(caseId);
    fileInput.value = "";
  });

  dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("dragover");
  });

  dropArea.addEventListener("dragleave", () => {
    dropArea.classList.remove("dragover");
  });

  dropArea.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropArea.classList.remove("dragover");

    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;

    await uploadCaseFiles(caseId, files);
    await loadCaseFiles(caseId);
  });

  if (fileList) {
    fileList.addEventListener("click", async (e) => {
      const downloadEl = e.target.closest(".case-file-download");
      const removeEl = e.target.closest(".case-file-remove");

      if (downloadEl) {
        const fileId = downloadEl.dataset.id;
        if (!fileId) return;
        window.open(`/api/files/${encodeURIComponent(fileId)}`, "_blank");
        return;
      }

      if (removeEl) {
        const fileId = removeEl.dataset.id;
        if (!fileId) return;

        const ok = confirm("Na pewno usunąć ten plik z tej sprawy?");
        if (!ok) return;

        try {
          const res = await fetch(
            `/api/files/${encodeURIComponent(fileId)}`,
            { method: "DELETE" }
          );

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            console.error("Błąd usuwania pliku:", res.status, text);
            alert("Nie udało się usunąć pliku ❌");
            return;
          }

          await loadCaseFiles(caseId);
        } catch (err) {
          console.error("Błąd przy DELETE pliku:", err);
          alert("Błąd sieci przy usuwaniu pliku ❌");
        }
      }
    });
  }
}

function initCaseFilesUpload(caseId) {
  const input = document.getElementById("caseFilesInput");
  const btn = document.getElementById("caseFilesUploadBtn");
  const empty = document.getElementById("caseFilesEmpty");

  if (!input || !btn) {
    console.warn("[FILES] Brak #caseFilesInput lub #caseFilesUploadBtn – pomijam init uploadu");
    return;
  }

  btn.addEventListener("click", async (e) => {
    e.preventDefault();

    const files = Array.from(input.files || []);
    if (!files.length) {
      alert("Wybierz przynajmniej jeden plik.");
      return;
    }

    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));

    try {
      console.log("[FILES] Upload plików dla sprawy", caseId, files);

      await apiFetch(`/api/cases/${encodeURIComponent(caseId)}/files`, {
        method: "POST",
        body: formData,
      });

      input.value = "";
      if (empty) empty.style.display = "none";

      // PRZEŁADOWANIE LISTY W ZAKŁADCE DOKUMENTY
      if (typeof loadCaseFiles === "function") {
        await loadCaseFiles(caseId);
      }

      alert("Pliki zostały zapisane do sprawy.");
    } catch (err) {
      console.error("[FILES] Błąd uploadu:", err);
      alert("Nie udało się zapisać plików. Sprawdź konsolę.");
    }
  });
}
function attachSaveHandlers(caseId) {
  // === KLIENT – dane podstawowe ===
  const btnClient = $("btnClientSave");
  btnClient?.addEventListener("click", async () => {
    const ibanRaw = $("contractIban").value.trim();
    const payload = {
      client: $("clientName").value.trim(),
      pesel: $("clientPesel").value.trim(),
      phone: $("clientPhone").value.trim(),
      email: $("clientEmail").value.trim(),
      address: `${$("clientPostcode").value.trim()} ${$(
        "clientCity"
      ).value.trim()}, ${$("clientStreet").value.trim()}`,
      iban: ibanRaw.replace(/\s+/g, "") || null,
    };

    try {
      await saveSection(caseId, "client", payload);
      handleSectionSaved(btnClient, "Dane klienta zapisane");
    } catch (e) {
      console.error(e);
      showSaveToast("Błąd zapisu danych klienta ❌");
    }
  });

  // === KLIENT – notatki: na razie MOCK (bez backendu) ===
  $("btnClientNotesSave")?.addEventListener("click", () => {
    showSaveToast("Uwagi o kliencie zapisane (lokalnie) ✅");
  });

  // === KREDYT ===
  const btnCredit = $("btnCreditSave");
  btnCredit?.addEventListener("click", async () => {
    const payload = {
      loan_amount: $("creditAmount").value
        ? Number($("creditAmount").value)
        : undefined,
      contract_date: $("creditStartDate").value || undefined,
      bank: $("creditBank").value.trim() || undefined,
    };

    try {
      await saveSection(caseId, "credit", payload);
      handleSectionSaved(btnCredit, "Dane kredytu zapisane");
    } catch (e) {
      console.error(e);
      showSaveToast("Błąd zapisu danych kredytu ❌");
    }
  });

  // === SKD – dane podstawowe (na razie front-only) ===
  $("btnSkdSave")?.addEventListener("click", () => {
    showSaveToast("Dane SKD zapisane (lokalnie) ✅");
  });

  // === SKD – oferta ===
  $("btnSkdOfferSave")?.addEventListener("click", async () => {
    const payload = {
      skdOfferText: $("skdOfferText").value.trim(),
    };
    try {
      await saveSection(caseId, "skd-offer", payload);
      showSaveToast("Oferta SKD zapisana ✅");
    } catch (e) {
      console.error(e);
      showSaveToast("Błąd zapisu oferty SKD ❌");
    }
  });

  // === NOTATKI SPRAWY ===
  const btnCaseNotes = $("btnCaseNotesSave");
  btnCaseNotes?.addEventListener("click", async () => {
    const payload = {
      notes: $("caseNotes").value.trim() || null,
    };

    try {
      await saveSection(caseId, "notes", payload);
      handleSectionSaved(btnCaseNotes, "Notatki zapisane");
    } catch (e) {
      console.error(e);
      showSaveToast("Błąd zapisu notatek ❌");
    }
  });

  // === GLOBALNY "ZAPISZ ZMIANY" ===
  $("btnSaveAll")?.addEventListener("click", () => {
    alert(
      "Docelowo tu zrobimy zbiorczy zapis wszystkich sekcji. Na razie używaj przycisków w sekcjach. 🙂"
    );
  });

  // === POWRÓT ===
  $("btnBack")?.addEventListener("click", () => {
    window.history.back();
  });

  // === USUŃ SPRAWĘ ===
  $("deleteCaseBtn")?.addEventListener("click", async () => {
    console.log("[case] delete clicked, caseId =", caseId);

    const numericId = Number(caseId);
    if (!numericId) {
      alert("Brak ID sprawy – nie mogę usunąć.");
      return;
    }

    if (!confirm("Czy na pewno chcesz usunąć tę sprawę?")) return;
    if (!confirm("Ta operacja jest nieodwracalna. Usunąć?")) return;

    const phrase = prompt("Aby potwierdzić, wpisz słowo: USUŃ");
    if (!phrase || phrase.trim().toUpperCase() !== "USUŃ") {
      alert("Nie potwierdziłeś usunięcia.");
      return;
    }

    try {
      const res = await fetch(`/api/cases/${numericId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        console.error("Błąd DELETE:", res.status);
        alert("Błąd podczas usuwania sprawy.");
        return;
      }

      alert("Sprawa została trwale usunięta.");
      window.location.href = "/dashboard.html";
    } catch (err) {
      console.error("Błąd DELETE:", err);
      alert("Nie udało się usunąć sprawy.");
    }
  });
}

// === GŁÓWNE ŁADOWANIE SPRAWY ===
async function loadCaseDetails() {
  const caseId = getCaseIdFromUrl();

  if (!caseId) {
    console.error("Brak parametru id w URL (case.html?id=...)");
    alert("Brak ID sprawy w adresie URL");
    return;
  }

  try {
    console.log("Pobieram dane sprawy", caseId);
    const data = await fetchCaseDetails(caseId);
    console.log("Dane sprawy z API:", data);

    fillCaseHeader(data);
    fillSidebar(data);
    fillClientSection(data);
    fillCreditSection(data);
    fillSkdSection(data);
    fillNotesSection(data);

    // 🔹 dokumenty z API → lista
    await loadCaseFiles(caseId);

    // 🔹 upload plików dla tej sprawy
    initCaseFilesUpload(caseId);   // 👈 DODAJ TĘ LINIJKĘ

    // jeśli initCaseDocuments robi inne rzeczy UI (np. podglądy / zakładki) – zostaw:
    initCaseDocuments(caseId);
    initCaseEmails(caseId);
    attachSaveHandlers(caseId);
    attachFieldChangeMicroFX();
    attachIbanFormatter();
    attachIbanValidator();
    await loadCaseHistory(caseId);
  } catch (e) {
    console.error("Błąd ładowania szczegółów sprawy:", e);
  }
}

// START
loadCaseDetails();

function getEmailsListEl() {
  return (
    document.getElementById("caseEmailList") ||
    document.getElementById("caseEmailsList")
  );
}
// =====================================================
//  E-MAILE (MVP): lista + wysyłka dla sprawy
//  Wymaga w case.html elementów:
//  #caseEmailTo, #caseEmailBody, #caseEmailSendBtn,
//  #caseEmailSendStatus, #caseEmailList
// =====================================================

async function loadCaseEmails(caseId) {
  const listEl = getEmailsListEl();
  if (!listEl) {
    console.warn("[emails] brak #caseEmailList/#caseEmailsList");
    return;
  }

  listEl.textContent = "Ładowanie…";

  try {
    const res = await fetch(`/api/cases/${caseId}/emails`, {
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) {
      listEl.textContent = "Nie udało się pobrać e-maili.";
      console.error("[emails] GET failed:", res.status, data);
      return;
    }

    const emails = Array.isArray(data.emails) ? data.emails : [];

    if (!emails.length) {
      listEl.textContent = "Brak e-maili w tej sprawie.";
      return;
    }

    const esc = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    listEl.innerHTML = emails
      .map((e) => {
        const to = Array.isArray(e.to_address)
          ? e.to_address.join(", ")
          : (e.to_address || "");

        const from = e.from_address || "";
        const whenRaw = e.sent_at || e.created_at || "";
        const when = whenRaw ? new Date(whenRaw).toLocaleString("pl-PL") : "—";
        const subj = e.subject || "(bez tematu)";
        const status = (e.status || "").toLowerCase();

        const body =
          e.body_text ||
          (e.body_html ? "[HTML]" : "");

        return `
          <div class="case-email-item" style="padding:12px 0;border-bottom:1px solid #eee;">
            <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;">
              <div style="font-weight:700;">${esc(subj)}</div>
              <div style="font-size:12px;opacity:.7;">${esc(status)} · ${esc(when)}</div>
            </div>
            <div style="font-size:12px;opacity:.85;margin-top:4px;">
              <div><strong>Od:</strong> ${esc(from)}</div>
              <div><strong>Do:</strong> ${esc(to)}</div>
            </div>
            <div style="margin-top:8px;white-space:pre-wrap;">${esc(body)}</div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    console.error("[emails] loadCaseEmails error:", err);
    listEl.textContent = "Błąd ładowania e-maili (sprawdź konsolę).";
  }
}

function initCaseEmails(caseId) {
  console.log("🔥 initCaseEmails()", caseId);

  const toInput = document.getElementById("caseEmailTo");
  const bodyInput = document.getElementById("caseEmailBody");
  const btn = document.getElementById("caseEmailSendBtn");
  const statusEl = document.getElementById("caseEmailSendStatus");

  if (!btn || !toInput || !bodyInput) {
    console.warn("❌ Brakuje elementów UI maili", { btn, toInput, bodyInput });
    return;
  }

  // nie podpinaj kilka razy
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", async () => {
    const to = (toInput.value || "").trim();
    const text = (bodyInput.value || "").trim();

    if (!to) return alert("Podaj adres e-mail odbiorcy.");
    if (!text) return alert("Wpisz treść wiadomości.");

    btn.disabled = true;
    if (statusEl) statusEl.textContent = "Wysyłanie...";

    try {
      const res = await fetch(`/api/cases/${caseId}/emails`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: "Informacja ze sprawy Portal PK",
          text,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (statusEl) statusEl.textContent = "Błąd: " + (data.error || res.status);
        return;
      }

      if (statusEl) statusEl.textContent = "✅ Wysłano";
      bodyInput.value = "";
      await loadCaseEmails(caseId);
    } catch (err) {
      console.error("send email error:", err);
      if (statusEl) statusEl.textContent = "Błąd wysyłania (konsola)";
    } finally {
      btn.disabled = false;
    }
  });

  loadCaseEmails(caseId);
}

// debug do konsoli
window.initCaseEmails = initCaseEmails;
window.loadCaseEmails = loadCaseEmails;
// === ANIMACJE / case-anim ===
(function () {
  var mq =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq && mq.matches) {
    document.querySelectorAll(".case-anim").forEach(function (el) {
      el.classList.add("in-view");
    });
    return;
  }

  var observed = document.querySelectorAll(".case-anim");
  if (!("IntersectionObserver" in window)) {
    observed.forEach(function (el) {
      el.classList.add("in-view");
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          obs.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.15,
    }
  );

  observed.forEach(function (el) {
    observer.observe(el);
  });

  document.querySelectorAll("a[href^='#case-']").forEach(function (link) {
    link.addEventListener("click", function (e) {
      var targetId = this.getAttribute("href").slice(1);
      var target = document.getElementById(targetId);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
})();
