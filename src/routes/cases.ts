// src/routes/cases.ts
import { Express } from "express";
import pool from "../db";
import multer from "multer";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { requireAuth } from "../middleware/requireAuth";
import { denyUnknownFields } from "./denyUnknownFields";

function sanitizeBody(req, res, next) {
  try {
    if (req.body && typeof req.body === "object") {
      for (const key of Object.keys(req.body)) {
        let val = req.body[key];

        // usuwamy BOM, null byte, whitespace dziwne Unicode
        if (typeof val === "string") {
          val = val
            .replace(/\uFEFF/g, "") // BOM
            .replace(/\0/g, "")     // null byte
            .trim();
        }

        req.body[key] = val;
      }
    }
  } catch (e) {
    console.warn("sanitizeBody error:", e);
  }

  next();
}
// === ŚCIEŻKI UPLOADÓW ===
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const CASES_UPLOAD_ROOT = path.join(UPLOAD_ROOT, "cases");

// upewniamy się, że katalogi istnieją
if (!fs.existsSync(CASES_UPLOAD_ROOT)) {
  fs.mkdirSync(CASES_UPLOAD_ROOT, { recursive: true });
}

// === KONFIGURACJA MULTERA – zapis do uploads/cases/<caseId>/ ===
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const caseId = req.params.id || req.body.caseId;
    const dir = path.join(CASES_UPLOAD_ROOT, String(caseId ?? "unknown"));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || "");
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage });

// === HELPERY DO NORMALIZACJI ===
const toNum = (v: any): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

const toStr = (v: any): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
};

const toISODate = (v: any): string | undefined => {
  const s = toStr(v);
  if (s === undefined) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
};

// ===== SIMPLE RATE LIMIT (in-memory) =====
type RateLimiterOpts = {
  windowMs: number;              // jak długo trwa okno (ms)
  max: number;                   // ile requestów w oknie
  key?: (req: any) => string;    // jak liczymy „kto” (domyślnie IP)
};

function createRateLimiter(opts: RateLimiterOpts) {
  const hits = new Map<string, number[]>();

  return (req: any, res: any, next: any) => {
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const key =
      (opts.key && opts.key(req)) ||
      (req.ip || req.connection?.remoteAddress || "unknown");

    const prev = hits.get(key) || [];
    const recent = prev.filter((ts) => ts > windowStart);
    recent.push(now);
    hits.set(key, recent);

    if (recent.length > opts.max) {
      return res.status(429).json({
        error: "Za dużo żądań z tego adresu/IP. Spróbuj ponownie za chwilę.",
      });
    }

    next();
  };
}

// 🔹 poziom 1: GET-y (lista, podgląd) – dość luźny
export const softApiLimit = createRateLimiter({
  windowMs: 5 * 60 * 1000,   // 5 minut
  max: 300,                  // 300 żądań / 5 min / IP
});

// 🔸 poziom 2: zmiany danych (POST/PUT/PATCH)
export const mediumApiLimit = createRateLimiter({
  windowMs: 5 * 60 * 1000,   // 5 minut
  max: 100,                  // 100 żądań / 5 min / IP
});

// 🔴 poziom 3: operacje wrażliwe (DELETE, login)
export const hardApiLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minut
  max: 20,                   // 20 żądań / 15 min / IP
});

// login – możesz użyć hardApiLimit, ale daję osobny limiter (jeszcze ciaśniejszy)
export const loginRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,  // 15 minut
  max: 10,                   // 10 prób logowania / 15 min / IP
});
// === WSPÓLNA CZĘŚCIOWA AKTUALIZACJA SPRAWY ===
async function updateCasePartial(id: number, payload: any) {
  let {
    wps,
    status,
    loan_amount,
    contract_date,
    bank,
    client,
    phone,
    email,
    address,
    pesel,
    notes,
  } = payload || {};

  const updates: string[] = [];
  const values: any[] = [];
  let i = 1;

  const wpsVal = toNum(wps);
  if (wpsVal !== undefined) {
    updates.push(`wps = $${i++}`);
    values.push(wpsVal);
  }

  const statusVal = toStr(status);
  if (statusVal !== undefined) {
    updates.push(`status = $${i++}`);
    values.push(statusVal);
  }

  const amountVal = toNum(loan_amount);
  if (amountVal !== undefined) {
    updates.push(`loan_amount = $${i++}`);
    values.push(amountVal);
  }

  const dateVal = toISODate(contract_date);
  if (dateVal !== undefined) {
    updates.push(`contract_date = $${i++}`);
    values.push(dateVal);
  }

  const bankVal = toStr(bank);
  if (bankVal !== undefined) {
    updates.push(`bank = $${i++}`);
    values.push(bankVal);
  }

  const clientVal = toStr(client);
  if (clientVal !== undefined) {
    updates.push(`client = $${i++}`);
    values.push(clientVal);
  }

  const phoneVal = toStr(phone);
  if (phoneVal !== undefined) {
    updates.push(`phone = $${i++}`);
    values.push(phoneVal);
  }

  const emailVal = toStr(email);
  if (emailVal !== undefined) {
    updates.push(`email = $${i++}`);
    values.push(emailVal);
  }

  const addressVal = toStr(address);
  if (addressVal !== undefined) {
    updates.push(`address = $${i++}`);
    values.push(addressVal);
  }

  const peselVal = toStr(pesel);
  if (peselVal !== undefined) {
    updates.push(`pesel = $${i++}`);
    values.push(peselVal);
  }

  const notesVal = toStr(notes);
  if (notesVal !== undefined) {
    updates.push(`notes = $${i++}`);
    values.push(notesVal);
  }

  if (updates.length === 0) {
    return { ok: true, note: "no fields to update" };
  }

  // zawsze odświeżamy znacznik czasu
  updates.push(`updated_at = NOW()`);

  const sql = `UPDATE cases SET ${updates.join(", ")} WHERE id = $${i}`;
  values.push(id);

  await pool.query(sql, values);
  return { ok: true };
}

// === WERYFIKACJA WŁAŚCICIELA SPRAWY ===
async function verifyCaseOwnership(caseId: number, user: any) {
  const q = await pool.query(
    "SELECT owner_id FROM cases WHERE id = $1",
    [caseId]
  );

  if (q.rowCount === 0) return null;

  const owner_id = q.rows[0].owner_id;

  if (user.role === "admin") return true;

  return owner_id === user.id;
}

export default function casesRoutes(app: Express) {
  console.log("➡️ routes: cases + KPI loaded");

  // === Helper: pobierz sprawę z kontrolią uprawnień ===
async function loadCaseForUser(caseId: number, user: any) {
  if (!Number.isFinite(caseId)) {
    throw Object.assign(new Error("invalid-id"), { status: 400 });
  }

  // Admin widzi wszystko
  if (user.role === "admin") {
    const q = await pool.query(
      `SELECT * FROM cases WHERE id = $1`,
      [caseId]
    );
    if (!q.rowCount) {
      throw Object.assign(new Error("case-not-found"), { status: 404 });
    }
    return q.rows[0];
  }

  // Agent – tylko swoje sprawy
  const q = await pool.query(
    `SELECT * FROM cases WHERE id = $1 AND owner_id = $2`,
    [caseId, user.id]
  );
  if (!q.rowCount) {
    // celowo ten sam komunikat – żeby nie zdradzać,
    // czy sprawa istnieje ale należy do kogoś innego
    throw Object.assign(new Error("case-not-found"), { status: 404 });
  }
  return q.rows[0];
}
function sendCaseError(res: any, err: any) {
  const status = (err && (err.status as number)) || 500;
  if (status === 404) {
    return res.status(404).json({ error: "Sprawa nie istnieje lub brak dostępu" });
  }
  if (status === 400) {
    return res.status(400).json({ error: "Nieprawidłowy identyfikator sprawy" });
  }
  console.error("CASE API ERROR:", err);
  return res.status(500).json({ error: "Błąd serwera (CASE)" });
}

// === ULTRA-SAFE LISTA SPRAW (GET /api/cases) ===
app.get("/api/cases",
  softApiLimit,       // lekkie ograniczenie dla list
  requireAuth,        // musi być zalogowany
  async (req, res) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
      }

      // 🔐 Log audytowy
      console.log(`[CASES] user=${user.id}, role=${user.role}, ip=${req.ip}`);

      // -------------------------
      // 1) PAGE / LIMIT (zabezpieczone)
      // -------------------------
      const pageRaw  = parseInt(String(req.query.page  ?? "1"), 10);
      const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);

      const page  = Number.isFinite(pageRaw)  && pageRaw  > 0 ? pageRaw  : 1;
      const limitU = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;

      // 🔒 limit twardo ograniczony do 200
      const limit = Math.min(limitU, 200);
      const offset = (page - 1) * limit;

      // -------------------------
      // 2) FILTR DOSTĘPU (admin vs agent)
      // -------------------------
      let whereSql = "";
      const params: any[] = [];

      if (user.role === "admin") {
        whereSql = "";     // admin widzi wszystko
      } else {
        whereSql = "WHERE owner_id = $1";
        params.push(user.id);
      }

      // -------------------------
      // 3) POLICZ ILE SPRAW
      // -------------------------
      const countSql = `
        SELECT COUNT(*)::int AS count
        FROM cases
        ${whereSql}
      `;
      const countRes = await pool.query(countSql, params);
      const totalCount = countRes.rows[0]?.count ?? 0;
      const totalPages =
        totalCount === 0 ? 1 : Math.max(Math.ceil(totalCount / limit), 1);

      // -------------------------
      // 4) POBIERZ STRONĘ
      // -------------------------
      const rowsSql = `
        SELECT
          id,
          client,
          bank,
          loan_amount,
          COALESCE(wps_forecast, wps) AS wps,
          status,
          contract_date,
          owner_id,
          phone,
          email,
          address
        FROM cases
        ${whereSql}
        ORDER BY id DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `;

      const rows = await pool.query(rowsSql, [...params, limit, offset]);

      // -------------------------
      // 5) ODP.
      // -------------------------
      return res.json({
        items: rows.rows || [],
        page,
        limit,
        totalCount,
        totalPages,
      });

    } catch (err) {
      console.error("❌ GET /api/cases ERROR:", err);
      return res.status(500).json({ error: "Błąd serwera przy pobieraniu spraw" });
    }
  }
);

  // === KPI (per user / admin) ===
app.get(
  "/api/kpi",
  softApiLimit,       
  requireAuth,       
  async (req, res) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
      }

      let q;

      if (user.role === "admin") {
        // ADMIN → KPI z wszystkich spraw
        q = await pool.query(`
          SELECT
            COUNT(*)::int AS total_cases,
            COUNT(*) FILTER (WHERE status NOT IN ('zamknieta','zamknięta','archiwum'))::int AS open_cases,
            COUNT(*) FILTER (WHERE status IN ('nowa','analiza','w toku'))::int              AS new_cases,
            COALESCE(SUM(wps), 0)::numeric AS wps_total
          FROM cases
        `);
      } else {
        // AGENT → KPI tylko z jego spraw
        q = await pool.query(
          `
          SELECT
            COUNT(*)::int AS total_cases,
            COUNT(*) FILTER (WHERE status NOT IN ('zamknieta','zamknięta','archiwum'))::int AS open_cases,
            COUNT(*) FILTER (WHERE status IN ('nowa','analiza','w toku'))::int              AS new_cases,
            COALESCE(SUM(wps), 0)::numeric AS wps_total
          FROM cases
          WHERE owner_id = $1
          `,
          [user.id]
        );
      }

      const r = q.rows[0] || {
        total_cases: 0,
        open_cases: 0,
        new_cases: 0,
        wps_total: 0,
      };

      return res.json({
        totalCases: r.total_cases,
        openCases: r.open_cases,
        newCases: r.new_cases,
        wpsTotal: Number(r.wps_total) || 0,
      });

    } catch (err) {
      console.error("GET /api/kpi error", err);
      return res.status(500).json({ error: "Server error" });
    }
  }
);
  // === DODAWANIE NOWEJ SPRAWY ===
  app.post(
  "/api/cases",
  mediumApiLimit,
  requireAuth,
  denyUnknownFields(["client", "loan_amount", "bank"]),   
  async (req, res) => {

    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
    }

    // ================================
    // 1) SANITY + WALIDACJA WEJŚCIA
    // ================================
    const raw = req.body || {};
    let { client, loan_amount, bank } = raw;

    // --- NORMALIZACJA STRINGÓW ---
    const cleanStr = (v: any, max = 120) => {
      if (typeof v !== "string") return null;
      let s = v.trim();

      // usuń znaki mogące rodzić XSS / dziwne injection
      s = s.replace(/[<>]/g, "");       // blokada HTML injection
      s = s.replace(/[\u0000-\u001F]/g, ""); // control chars
      s = s.substring(0, max);          // twardy limit długości

      return s || null;
    };

    client = cleanStr(client, 120);
    bank   = cleanStr(bank, 80);

    if (!client) {
      return res.status(400).json({ error: "Pole 'client' jest wymagane." });
    }

    // --- KWOTA ---
    const toNumber = (v: any) => {
      if (v == null) return null;
      const n = Number(
        String(v).replace(/\s+/g, "").replace(",", ".")
      );
      return Number.isFinite(n) ? n : null;
    };

    const amountVal = toNumber(loan_amount);

    if (amountVal === null || amountVal <= 0 || amountVal > 10_000_000) {
      return res.status(400).json({ error: "Nieprawidłowa kwota kredytu." });
    }

    // ================================
    // 2) LOG ZDARZENIA BEZPIECZEŃSTWA
    // ================================
    console.log(
      `[AUDIT][CREATE_CASE] user=${user.id}, role=${user.role}, client="${client}", amount=${amountVal}, bank="${bank}"`
    );

    // ================================
    // 3) ZAPIS DO BAZY
    // ================================
    try {
      const sql = `
        INSERT INTO cases (client, loan_amount, status, bank, owner_id)
        VALUES ($1, $2, 'nowa', $3, $4)
        RETURNING id, client, loan_amount, wps, status, contract_date, bank, owner_id
      `;
      const params = [client, amountVal, bank ?? null, user.id];

      const result = await pool.query(sql, params);

      return res.json(result.rows[0]);
    } catch (e: any) {
      console.error("Błąd przy POST /api/cases:", e);
      return res.status(500).json({
        error: "Błąd serwera podczas tworzenia sprawy.",
      });
    }
  }
);

  // === SZCZEGÓŁY JEDNEJ SPRAWY (dla case.html) ===
  app.get("/api/cases/:id", softApiLimit, requireAuth, async (req, res) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);

    const row = await loadCaseForUser(id, user);

    // selekcja tylko potrzebnych pól do frontu (bez wrażliwych)
    const safe = {
      id: row.id,
      client: row.client,
      bank: row.bank,
      loan_amount: row.loan_amount,
      status: row.status,
      contract_date: row.contract_date,
      phone: row.phone,
      email: row.email,
      address: row.address,
      pesel: row.pesel,           // jak chcesz – można też wypiąć z API
      wps_forecast: row.wps_forecast,
      wps_final: row.wps_final,
      client_benefit: row.client_benefit,
      notes: row.notes,
      owner_id: row.owner_id,
      updated_at: row.updated_at,
      offer_skd: row.offer_skd,  // jeśli trzymasz JSON z ofertą
    };

    res.json(safe);
  } catch (err) {
    sendCaseError(res, err);
  }
});

  // === OGÓLNA CZĘŚCIOWA AKTUALIZACJA SPRAWY ===
  app.patch(
  "/api/cases/:id",
  mediumApiLimit,
  requireAuth,
  denyUnknownFields([
    "client",
    "bank",
    "loan_amount",
    "status",
    "contract_date",
    "phone",
    "email",
    "address",
    "pesel",
    "notes"
  ]),
  async (req, res) => {
    
    try {
      const user = (req as any).user;
      const id = Number(req.params.id);

      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
      }

      // 🔐 Sprawdzenie uprawnień
      await loadCaseForUser(id, user);

      // ==============================
      // 1) WHITELISTA — tylko te pola mogą wejść
      // ==============================
      const allowedFields = {
        client: "string",
        bank: "string",
        loan_amount: "number",
        status: "string",
        contract_date: "string|null",
        phone: "string",
        email: "string",
        address: "string",
        pesel: "string",
        notes: "string",
      };

      // ==============================
      // 2) Pobranie pól
      // ==============================
      const body = req.body || {};
      const update: any = {};

      for (const key of Object.keys(allowedFields)) {
        if (body[key] !== undefined) {
          update[key] = body[key];
        }
      }

      if (Object.keys(update).length === 0) {
        return res.status(400).json({ error: "Brak pól do aktualizacji" });
      }

      // ==============================
      // 3) Walidacje — twarde zabezpieczenia
      // ==============================

      // XSS-cleaner
      const clean = (v: any) =>
        typeof v === "string"
          ? v.replace(/[<>]/g, "").trim()
          : v;

      // EMAIL
      if (update.email !== undefined) {
        const e = clean(update.email);
        if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
          return res.status(400).json({ error: "Nieprawidłowy adres e-mail" });
        }
        update.email = e || null;
      }

      // TELEFON (opcjonalny)
      if (update.phone !== undefined) {
        const p = clean(update.phone);
        if (p && !/^[0-9+\-\s]{5,20}$/.test(p)) {
          return res.status(400).json({ error: "Nieprawidłowy numer telefonu" });
        }
        update.phone = p || null;
      }

      // PESEL
      if (update.pesel !== undefined) {
        const p = clean(update.pesel);
        if (p && !/^[0-9]{11}$/.test(p)) {
          return res.status(400).json({ error: "Nieprawidłowy PESEL" });
        }
        update.pesel = p || null;
      }

      // KWOTA
      if (update.loan_amount !== undefined) {
        const amount = Number(update.loan_amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > 5_000_000) {
          return res.status(400).json({ error: "Nieprawidłowa kwota kredytu" });
        }
        update.loan_amount = amount;
      }

      // DATA
      if (update.contract_date !== undefined) {
        const d = update.contract_date;
        if (d && isNaN(Date.parse(d))) {
          return res.status(400).json({ error: "Nieprawidłowa data umowy" });
        }
        update.contract_date = d || null;
      }

      // TEKSTY — soft XSS-clean + długości
      const safeText = (t: any, max: number) =>
        t ? clean(String(t).slice(0, max)) : null;

      if (update.client) update.client = safeText(update.client, 200);
      if (update.bank) update.bank = safeText(update.bank, 200);
      if (update.address) update.address = safeText(update.address, 400);
      if (update.notes) update.notes = safeText(update.notes, 2000);
      if (update.status) update.status = safeText(update.status, 100);

      // ==============================
      // 4) Budowa zapytania SQL (bezpieczna)
      // ==============================
      const sqlFields: string[] = [];
      const values: any[] = [];
      let i = 1;

      for (const [k, v] of Object.entries(update)) {
        sqlFields.push(`${k} = $${i}`);
        values.push(v);
        i++;
      }

      // zawsze aktualizuj updated_at
      sqlFields.push(`updated_at = NOW()`);

      values.push(id);

      // ==============================
      // 5) Wykonanie UPDATE
      // ==============================
      const result = await pool.query(
        `UPDATE cases
         SET ${sqlFields.join(", ")}
         WHERE id = $${i}
         RETURNING *`,
        values
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Sprawa nie istnieje" });
      }

      // AUDYT
      console.log(
        `[PATCH CASE] user=${user.id}, role=${user.role}, case=${id}, updated=${Object.keys(update).join(", ")}`
      );

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("PATCH /api/cases/:id ERROR:", err);
      return res.status(500).json({ error: "Błąd serwera" });
    }
  }
);

  // === DANE KLIENTA ===
  app.put("/api/cases/:id/client", requireAuth, async (req, res) => {
    const user = (req as any).user;
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    const allowed = await verifyCaseOwnership(id, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Sprawa nie istnieje" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    const { client, phone, email, address, pesel } = req.body || {};

    try {
      const result = await updateCasePartial(id, {
        client,
        phone,
        email,
        address,
        pesel,
      });
      return res.json(result);
    } catch (err) {
      console.error("PUT /api/cases/:id/client error", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // === DANE KREDYTU ===
  app.put("/api/cases/:id/credit", requireAuth, async (req, res) => {
    const user = (req as any).user;
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    const allowed = await verifyCaseOwnership(id, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Sprawa nie istnieje" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    const { loan_amount, contract_date, bank, status } = req.body || {};

    try {
      const result = await updateCasePartial(id, {
        loan_amount,
        contract_date,
        bank,
        status,
      });
      return res.json(result);
    } catch (err) {
      console.error("PUT /api/cases/:id/credit error", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // === ODCZYT OFERTY SKD ===
  app.get(
  "/api/cases/:id/skd-offer",
  softApiLimit,
  requireAuth,
  async (req, res) => {

    const user = (req as any).user;
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    const allowed = await verifyCaseOwnership(id, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Case not found" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    try {
      const result = await pool.query(
        "SELECT wps_forecast, offer_skd FROM cases WHERE id = $1",
        [id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: "Case not found" });
      }

      const row = result.rows[0];

      let rawOffer: any = row.offer_skd || {};
      if (typeof rawOffer === "string") {
        try {
          rawOffer = JSON.parse(rawOffer);
        } catch {
          rawOffer = {};
        }
      }

      const rawElig = (rawOffer && rawOffer.eligibility) || {};

      const eligibility = {
        sf50: rawElig.sf50 ?? true,
        sf49: rawElig.sf49 ?? true,
        sell: rawElig.sell ?? true,
      };

      return res.json({
        wps_forecast: row.wps_forecast ?? null,
        offer_skd: {
          ...rawOffer,
          eligibility,
        },
      });
    } catch (err) {
      console.error("GET /api/cases/:id/skd-offer error", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // === ZAPIS WPS BASIC ===
  app.patch(
  "/api/cases/:id/wps-basic",
  mediumApiLimit,
  requireAuth,
  async (req, res) => {

    const user = (req as any).user;
    const idRaw = req.params.id;
    const caseId = Number(idRaw);

    if (!Number.isFinite(caseId)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy." });
    }

    const allowed = await verifyCaseOwnership(caseId, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Nie znaleziono sprawy." });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    try {
      const { wps_basic } = req.body || {};

      const wpsNumber = Number(wps_basic);
      if (!Number.isFinite(wpsNumber)) {
        return res.status(400).json({ error: "Nieprawidłowa wartość WPS." });
      }
console.log(`[WPS-BASIC] user=${user.id}, role=${user.role}, case=${caseId}, value=${wpsNumber}`);

      const result = await pool.query(
        `
        UPDATE cases
        SET wps_basic = $1
        WHERE id = $2
        RETURNING id, wps_basic
        `,
        [wpsNumber, caseId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Nie znaleziono sprawy." });
      }

      return res.json({
        ok: true,
        case: result.rows[0],
      });
    } catch (err) {
      console.error("Błąd PATCH /api/cases/:id/wps-basic:", err);
      return res
        .status(500)
        .json({ error: "Błąd serwera przy zapisie WPS." });
    }
  });

  // === AKTUALIZACJA OFERTY SKD ===
  app.put(
  "/api/cases/:id/skd-offer",
  mediumApiLimit,
  requireAuth,
  async (req, res) => {

    const user = (req as any).user;
    const idRaw = req.params.id;
    const caseId = Number(idRaw);

    if (!Number.isFinite(caseId)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy." });
    }

    const allowed = await verifyCaseOwnership(caseId, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Nie znaleziono sprawy." });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    try {
      const { wps_forecast, offer_skd } = req.body || {};

      console.log("SKD PUT body:", { caseId, wps_forecast, offer_skd });

      const result = await pool.query(
        `
        UPDATE cases
        SET
          wps_forecast = $1,
          offer_skd    = $2
        WHERE id = $3
        RETURNING id, wps_forecast, offer_skd
        `,
        [wps_forecast, offer_skd, caseId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Nie znaleziono sprawy." });
      }

      console.log("SKD PUT result:", result.rows[0]);

      return res.json({
        ok: true,
        case: result.rows[0],
      });
    } catch (err) {
      console.error("Błąd PUT /api/cases/:id/skd-offer:", err);
      return res
        .status(500)
        .json({ error: "Błąd serwera przy zapisie oferty SKD." });
    }
  });

  // === DOKUMENTY SPRAWY: POBRANIE PLIKU (z kontrolą właściciela) ===
app.get("/api/files/:fileId", softApiLimit, requireAuth, async (req, res) => {
  const user = (req as any).user;
  const rawId = req.params.fileId;
  const fileId = Number(rawId);

  if (!Number.isFinite(fileId)) {
    return res.status(400).json({ error: "Nieprawidłowe ID pliku" });
  }

  try {
    const q = await pool.query(
      `
      SELECT
        cf.case_id,
        cf.original_name,
        cf.stored_name,
        cf.mime_type,
        c.owner_id
      FROM case_files cf
      JOIN cases c ON c.id = cf.case_id
      WHERE cf.id = $1
      `,
      [fileId]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Plik nie istnieje" });
    }

    const row = q.rows[0];

    // 🔒 sprawdzamy uprawnienia
    if (user.role !== "admin" && row.owner_id !== user.id) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    // 📂 dopasowane do struktury: uploads/cases/<case_id>/<stored_name>
    const filePath = path.join(
      process.cwd(),
      "uploads",
      "cases",
      String(row.case_id),
      row.stored_name
    );

    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(row.original_name)}"`
    );

    return res.sendFile(filePath);
  } catch (err) {
    console.error("GET /api/files/:fileId error:", err);
    return res
      .status(500)
      .json({ error: "Błąd serwera przy pobieraniu pliku" });
  }
});

  // === DOKUMENTY SPRAWY: LISTA PLIKÓW ===
  app.get(
  "/api/cases/:id/files",
  softApiLimit,
  requireAuth,
  async (req, res) => {

    const user = (req as any).user;
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    const allowed = await verifyCaseOwnership(id, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Sprawa nie istnieje" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    try {
      const result = await pool.query(
        `
        SELECT
          id,
          case_id,
          original_name,
          stored_name,
          mime_type,
          size,
          uploaded_at
        FROM case_files
        WHERE case_id = $1
        ORDER BY uploaded_at DESC
        `,
        [id]
      );

      return res.json({ files: result.rows });
    } catch (err) {
      console.error("GET /api/cases/:id/files error", err);
      return res.status(500).json({ error: "Błąd serwera przy pobieraniu plików" });
    }
  });

  // === USUWANIE PLIKU PO ID (z kontrolą właściciela) ===
app.delete("/api/files/:fileId", hardApiLimit, requireAuth, async (req, res) => {
  const user = (req as any).user;
  const rawId = req.params.fileId;
  const fileId = Number(rawId);

  if (!Number.isFinite(fileId)) {
    return res.status(400).json({ error: "Nieprawidłowe ID pliku" });
  }

  try {
    // 1) Pobieramy info o pliku + właściciela sprawy
    const q = await pool.query(
      `
      SELECT
        cf.case_id,
        cf.stored_name,
        c.owner_id
      FROM case_files cf
      JOIN cases c ON c.id = cf.case_id
      WHERE cf.id = $1
      `,
      [fileId]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Plik nie istnieje" });
    }

    const row = q.rows[0];

    // 2) Sprawdzamy uprawnienia
    if (user.role !== "admin" && row.owner_id !== user.id) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    // 3) Usuwamy fizyczny plik z dysku
    const filePath = path.join(
      process.cwd(),
      "uploads",
      "cases",
      String(row.case_id),
      row.stored_name
    );

    try {
      await fsPromises.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error("Błąd usuwania pliku z dysku:", err);
      }
      // jeśli pliku fizycznie nie ma (ENOENT) – i tak usuwamy rekord z DB
    }

    // 4) Usuwamy rekord z bazy
    await pool.query("DELETE FROM case_files WHERE id = $1", [fileId]);

    console.log("🗑️ Usunięto plik id =", fileId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/files/:fileId error:", err);
    return res
      .status(500)
      .json({ error: "Błąd serwera przy usuwaniu pliku" });
  }
});

  // === UPLOAD PLIKÓW DO SPRAWY ===
  app.post(
  "/api/cases/:id/files",
  hardApiLimit,       // ⬅️ upload = ryzyko → twardy limiter
  requireAuth,
  upload.array("files", 10),   // ⬅️ max 10 plików jednorazowo
  async (req, res) => {
    const user = (req as any).user;
    const idRaw = req.params.id;
    const caseId = Number(idRaw);

    if (!Number.isFinite(caseId)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    // 1️⃣ uprawnienia
    const allowed = await verifyCaseOwnership(caseId, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Sprawa nie istnieje" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    // 2️⃣ pliki
    const files = (req.files as Express.Multer.File[]) || [];

    if (!files.length) {
      return res.status(400).json({ error: "Brak plików do dodania" });
    }

    // 3️⃣ walidacja MIME + rozszerzeń + rozmiaru
    const allowedMime = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    const maxSize = 20 * 1024 * 1024; // 20 MB

    for (const f of files) {
      if (!allowedMime.includes(f.mimetype)) {
        return res.status(400).json({
          error: `Niedozwolony typ pliku: ${f.originalname}`
        });
      }

      if (f.size > maxSize) {
        return res.status(400).json({
          error: `Plik jest zbyt duży (max 20 MB): ${f.originalname}`
        });
      }

      // lekkie sprawdzenie rozszerzenia
      const ext = f.originalname.toLowerCase();
      if (!ext.match(/\.(pdf|jpg|jpeg|png|webp)$/)) {
        return res.status(400).json({
          error: `Niedozwolone rozszerzenie: ${f.originalname}`
        });
      }
    }

    try {
      const values: any[] = [];
      const placeholders: string[] = [];

      files.forEach((f, index) => {
        const baseIndex = index * 5;
        placeholders.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5})`
        );
        values.push(
          caseId,
          f.originalname,
          f.filename,
          f.mimetype,
          f.size
        );
      });

      const sql = `
        INSERT INTO case_files (case_id, original_name, stored_name, mime_type, size)
        VALUES ${placeholders.join(", ")}
        RETURNING id, case_id, original_name, stored_name, mime_type, size, uploaded_at
      `;

      const result = await pool.query(sql, values);

      console.log(
        `📎 [UPLOAD] user=${user.id}, case=${caseId}, count=${result.rowCount}`
      );

      return res.json({
        ok: true,
        files: result.rows,
      });
    } catch (err) {
      console.error("❌ Błąd przy POST /api/cases/:id/files:", err);
      return res.status(500).json({ error: "Błąd serwera przy zapisie plików" });
    }
  }
);

  // === USUWANIE SPRAWY (DELETE) ===
  app.delete(
  "/api/cases/:id",
  hardApiLimit,
  requireAuth,
  async (req, res) => {

    const user = (req as any).user;
    const idRaw = req.params.id;
    const id = Number(idRaw);

    console.log(`[DELETE /api/cases/${id}] by user=${user.id}, role=${user.role}`);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    const allowed = await verifyCaseOwnership(id, user);
    if (allowed === null) {
      return res.status(404).json({ error: "Sprawa nie istnieje" });
    }
    if (!allowed) {
      return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
    }

    try {
      const result = await pool.query(
        "DELETE FROM cases WHERE id = $1 RETURNING id",
        [id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Sprawa nie istnieje" });
      }

      console.log("🗑️ Usunięto sprawę id =", id);
      return res.json({ success: true });
    } catch (err) {
      console.error("Błąd przy DELETE /api/cases/:id:", err);
      return res
        .status(500)
        .json({ error: "Błąd serwera przy usuwaniu sprawy" });
    }
  });

  console.log("➡️ routes: GET/POST/PATCH/PUT/DELETE /api/cases registered");
}