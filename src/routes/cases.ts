// src/routes/cases.ts
// Zewnętrzne biblioteki
import { Express } from "express";
import multer from "multer";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

// Wewnętrzne – core i middleware
import pool from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { denyUnknownFields } from "./denyUnknownFields";
import { createNotification } from "../utils/createNotification";
// Logika biznesowa (statusy)
import { updateCaseStatus } from "../services/caseStatus";
import { isValidCaseStatus } from "../domain/caseStatus";
import { addCaseLog, fetchCaseLogs } from "../utils/caseLogs";
import { sendEmail, buildPortalEmailHtml } from "../utils/email";
import { computeSkdV2 } from "../skd/skdEngineV2";

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
// 🔢 limit: 20 MB na JEDEN plik
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ✅ MIME typy, które dopuszczamy
const ALLOWED_MIME_TYPES = [
  "application/pdf",

  "image/jpeg",
  "image/png",

  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx

  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx

  "text/plain",
];

// 🚫 Rozszerzenia, których absolutnie NIE przyjmujemy
const BLOCKED_EXTENSIONS = [
  ".exe",
  ".js",
  ".mjs",
  ".cjs",
  ".php",
  ".phtml",
  ".phar",
  ".sh",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".msi",
  ".dll",
  ".so",
  ".dylib",
  ".html",
  ".htm",
  ".svg",
  ".xml",
];

// 📂 storage: zapisujemy pliki do uploads/cases/<caseId>/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const rawId = (req.params && req.params.id) || "unknown";

      // ✅ Dodatkowy bezpiecznik: caseId musi być złożone z cyfr
      if (!/^\d+$/.test(String(rawId))) {
        securityLog("Nieprawidłowe caseId w uploadzie", {
          rawId,
          file: file.originalname,
        });
        return cb(
          new Error("Nieprawidłowe ID sprawy dla uploadu."),
          path.join(process.cwd(), "uploads", "cases")
        );
      }

      const caseId = String(rawId); // teraz mamy pewność że to tylko cyfry

      const baseDir = path.join(process.cwd(), "uploads", "cases", caseId);

      // upewniamy się, że katalog istnieje
      fs.mkdirSync(baseDir, { recursive: true });

      cb(null, baseDir);
    } catch (err) {
      console.error("Błąd przy tworzeniu katalogu uploadu:", err);
      cb(err as any, path.join(process.cwd(), "uploads", "cases"));
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeBaseName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const finalName = safeBaseName + ext;
    cb(null, finalName);
  },
});
function securityLog(msg: string, extra: any = {}) {
  const stamp = new Date().toISOString();
  console.log(`🔒 [SECURITY ${stamp}] ${msg}`, extra);
}

// 🛡️ Główny filtr bezpieczeństwa uploadu
function fileFilter(
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) {
  const mime = (file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();

  // 1) blokujemy oczywiste syfy po rozszerzeniu
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    console.warn("❌ Odrzucono plik po rozszerzeniu:", file.originalname);
    return cb(
      new Error(
        "Ten typ pliku jest niedozwolony do uploadu (rozszerzenie zablokowane)."
      )
    );
  }

  // 2) sprawdzamy MIME type (pdf/jpg/png/doc/xls/txt)
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    console.warn("❌ Odrzucono plik po MIME:", file.originalname, mime);
    return cb(
      new Error(
        "Ten typ pliku nie jest obsługiwany. Dozwolone: PDF, JPG, PNG, DOC, XLS, TXT."
      )
    );
  }

  // 3) dodatkowy „smell test” na HTML/JS w środku (opcjonalnie – tu tylko po nazwie)
  if (mime === "text/html" || mime === "application/javascript") {
    return cb(
      new Error("Nie można wgrywać plików HTML/JS ze względów bezpieczeństwa.")
    );
  }

  cb(null, true);
}

// 🎯 Główny obiekt upload – z limitami i filtrem
export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE, // max 20 MB na plik
    files: 10,               // max 10 plików na raz
  },
  fileFilter,
});

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
  // ————————————————————————————
  // Helper: twarda sanityzacja liczb finansowych
  // ————————————————————————————
  function sanitizeNumberLike(raw: any): number | null {
    if (raw === null || raw === undefined) return null;

    let s = String(raw)
      .replace(/\s+/g, "")   // usuń spacje
      .replace(",", ".")     // zamień przecinek na kropkę
      .replace(/[^\d.-]/g, ""); // wyrzuć wszystko poza cyframi, - i .

    // Usuń przypadki "--12", "12-", ".", "-", "--", itp:
    if (s === "" || s === "." || s === "-" || s === "-.") return null;

    const num = Number(s);
    return Number.isFinite(num) ? num : null;
  }

  //  ZMIANA STATUSU SPRAWY
  app.post("/api/cases/update-status", requireAuth, async (req, res) => {
    try {
      const { caseId, status } = req.body;

      // Walidacja caseId
      const idNum = Number(caseId);
      if (!idNum || Number.isNaN(idNum)) {
        return res.status(400).json({ error: "Invalid caseId" });
      }

      // Walidacja statusu względem CaseStatus
      if (!isValidCaseStatus(status)) {
        return res.status(400).json({ error: "Invalid case status" });
      }

      // użytkownik (agent / admin)
      const userId = (req as any).user?.id ?? null;

      // aktualizacja sprawy
      const updated = await updateCaseStatus(idNum, status);

      // ===============================================
      // 3.5 LOG — CASE_STATUS_CHANGED
      // ===============================================
      try {
        await addCaseLog({
          caseId: idNum,
          userId,
          action: "CASE_STATUS_CHANGED",
          message: `Status zmieniony na '${status}'`,
          meta: {
            newStatus: status,
            changedBy: userId,
          },
        });
      } catch (err) {
        console.warn("⚠️ addCaseLog CASE_STATUS_CHANGED error:", err);
      }

      return res.json({
        ok: true,
        case: updated,
      });
    } catch (err) {
      console.error("❌ /api/cases/update-status error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // GET /api/cases/:id/emails
  app.get("/api/cases/:id/emails", requireAuth, async (req, res) => {
    try {
      const caseId = Number(req.params.id);
      if (!Number.isFinite(caseId)) {
        return res.status(400).json({ ok: false, error: "Invalid case id" });
      }

      const r = await pool.query(
        `SELECT
         e.id,
         e.case_id,
         e.direction,
         e.from_address,
         e.to_address,
         e.cc_address,
         e.bcc_address,
         e.subject,
         e.body_text,
         e.body_html,
         e.status,
         e.error_message,
         e.sent_at,
         e.created_at,
         e.sent_by,
         u.name  AS sent_by_name,
         u.email AS sent_by_email
       FROM case_emails e
       LEFT JOIN users u ON u.id = e.sent_by
       WHERE e.case_id = $1
       ORDER BY COALESCE(e.sent_at, e.created_at) DESC`,
        [caseId]
      );

      return res.json({ ok: true, emails: r.rows });
    } catch (err) {
      console.error("❌ GET /api/cases/:id/emails error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });

  // ============================================
  // SEND EMAIL IN CASE
  // POST /api/cases/:id/emails
  // ============================================
  app.post("/api/cases/:id/emails", requireAuth, async (req, res) => {
    try {
      const user: any = (req as any).user;
      const caseId = Number(req.params.id);

      if (!Number.isFinite(caseId)) {
        return res.status(400).json({ ok: false, error: "Invalid case id" });
      }

      const { to, cc, bcc, subject, text, html } = req.body || {};

      if (!to || !subject || (!text && !html)) {
        return res.status(400).json({
          ok: false,
          error: "Brak danych maila (to / subject / text lub html)",
        });
      }

      // przygotuj HTML raz (jeśli ktoś podał html z frontu – użyj go, jeśli nie – zbuduj z text)
      const htmlToSendAndStore =
        html ??
        buildPortalEmailHtml(
          subject || "Informacja ze sprawy Portal PK",
          text || ""
        );

      const result = await sendEmail({
        to,
        cc: cc ?? null,
        bcc: bcc ?? null,
        subject,
        text: text ?? null,
        html: htmlToSendAndStore, // <-- to jest klucz
        caseId,
        actorId: user?.id ?? null,
        tag: "CASE_EMAIL",
      });

      if (!result.ok) {
        return res
          .status(500)
          .json({ ok: false, error: result.error || "Send failed" });
      }

      // ZAPIS DO DB (case_emails)
      const fromAddress =
        process.env.MAIL_FROM || "Portal PK <portal@mail.pokonajkredyt.pl>";

      // normalizacja do tablic text[]
      const normalizeEmails = (v: any): string[] => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map((s) => String(s || "").trim()).filter(Boolean);
        return String(v || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      };

      const toArr = normalizeEmails(to);
      if (!toArr.length) {
        return res.status(400).json({ ok: false, error: "Brak adresu odbiorcy" });
      }
      const ccArr = normalizeEmails(cc);
      const bccArr = normalizeEmails(bcc);

      if (!toArr.length) {
        return res.status(400).json({ ok: false, error: "Brak adresu odbiorcy" });
      }

      const ins = await pool.query(
        `INSERT INTO case_emails
   (case_id, direction, from_address, to_address, cc_address, bcc_address,
    subject, body_text, body_html, status, error_message, sent_by, sent_at)
   VALUES
   ($1, 'sent', $2, $3, $4, $5,
    $6, $7, $8, 'sent', NULL, $9, NOW())
   RETURNING id, created_at`,
        [
          caseId,
          fromAddress,
          toArr,
          ccArr.length ? ccArr : null,
          bccArr.length ? bccArr : null,
          subject,
          text ?? null,
          htmlToSendAndStore,
          user?.id ?? null,
        ]
      );

      console.log("✅ case_emails INSERT ok:", ins.rows[0]);
      return res.json({ ok: true, messageId: result.messageId || null, row: ins.rows[0] });

      return res.json({ ok: true, messageId: result.messageId || null });
    } catch (err: any) {
      console.error("❌ POST /api/cases/:id/emails error:", err);
      return res.status(500).json({ ok: false, error: "Server error" });
    }
  });
  // ============================================
  //  GET /api/cases/:id/logs – historia sprawy
  // ============================================
  app.get("/api/cases/:id/logs", requireAuth, async (req, res) => {
    try {
      const caseId = Number(req.params.id);
      if (!caseId || Number.isNaN(caseId)) {
        return res.status(400).json({ error: "Invalid case id" });
      }

      const logs = await fetchCaseLogs(caseId);

      return res.json({
        ok: true,
        logs,
      });
    } catch (err) {
      console.error("❌ GET /api/cases/:id/logs error:", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/cases", softApiLimit, requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Brak dostępu – zaloguj się" });

      const pageRaw = parseInt(String(req.query.page ?? "1"), 10);
      const limitRaw = parseInt(String(req.query.limit ?? "100"), 10);

      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const limitU = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;

      const limit = Math.min(limitU, 200);
      const offset = (page - 1) * limit;

      let whereSql = "";
      const params: any[] = [];

      if (user.role !== "admin") {
        whereSql = "WHERE owner_id = $1";
        params.push(user.id);
      }

      const countSql = `
      SELECT COUNT(*)::int AS count
      FROM cases
      ${whereSql}
    `;
      const countRes = await pool.query(countSql, params);
      const totalCount = countRes.rows[0]?.count ?? 0;
      const totalPages = totalCount === 0 ? 1 : Math.max(Math.ceil(totalCount / limit), 1);

      const rowsSql = `
  SELECT
    id,
    client,
    bank,
    loan_amount,

    -- ✅ WPS do dashboardu: FINAL > FORECAST > legacy wps
    COALESCE(wps_final, wps_forecast, wps) AS wps,
    wps_forecast,
    wps_final,

    status,
    status_code,
    contract_date,
    owner_id,
    phone,
    email,
    address,
    created_at,
    updated_at,

    -- ✅ blokada wyboru wariantu
    variant_picked,
    variant_picked_at,

    -- ✅ JSON (może być text lub json/jsonb – my i tak czytamy bezpiecznie)
    offer_skd,

    -- ✅ wariant wyciągnięty z JSON-a (działa nawet gdy offer_skd jest TEXT)
    (NULLIF(offer_skd::text, '')::jsonb ->> 'variant') AS variant

  FROM cases
  ${whereSql}
  ORDER BY id DESC
  LIMIT $${params.length + 1}
  OFFSET $${params.length + 2}
`;

      const rows = await pool.query(rowsSql, [...params, limit, offset]);

      return res.json({
        items: rows.rows || [],
        page,
        limit,
        totalCount,
        totalPages,
      });
    } catch (err) {
      console.error("❌ GET /api/cases ERROR:", err);
      console.error("❌ GET /api/cases ERROR:", (err as any)?.message || err);
      return res.status(500).json({ error: "Błąd serwera przy pobieraniu spraw" });
    }
  });

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

    -- SPRAWY OTWARTE: wszystko oprócz zamkniętych / archiwalnych
    COUNT(*) FILTER (
      WHERE status_code NOT IN ('CLOSED_SUCCESS','CLOSED_FAIL','CLIENT_RESIGNED')
    )::int AS open_cases,

    -- "NOWE": w naszym nowym pipeline: nowe + w analizie
    COUNT(*) FILTER (
      WHERE status_code IN ('NEW','ANALYSIS')
    )::int AS new_cases,

    COALESCE(SUM(wps), 0)::numeric AS wps_total
  FROM cases
`);
        } else {
          // AGENT → KPI tylko z jego spraw
          q = await pool.query(
            `
  SELECT
    COUNT(*)::int AS total_cases,

    COUNT(*) FILTER (
      WHERE status_code NOT IN ('CLOSED_SUCCESS','CLOSED_FAIL','CLIENT_RESIGNED')
    )::int AS open_cases,

    COUNT(*) FILTER (
      WHERE status_code IN ('NEW','ANALYSIS')
    )::int AS new_cases,

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
        s = s.replace(/[<>]/g, "");             // blokada HTML injection
        s = s.replace(/[\u0000-\u001F]/g, "");  // control chars
        s = s.substring(0, max);                // twardy limit długości

        return s || null;
      };

      client = cleanStr(client, 120);
      bank = cleanStr(bank, 80);

      if (!client) {
        return res.status(400).json({ error: "Pole 'client' jest wymagane." });
      }

      // --- KWOTA ---
      const toNumber = (v: any) => {
        if (v == null) return null;
        const n = Number(String(v).replace(/\s+/g, "").replace(",", "."));
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
        const createdCase = result.rows[0];

        // ================================
        // 3.5) LOG ZDARZENIA – CASE_CREATED
        // ================================
        try {
          const anyReq = req as any;
          const userFromReq = anyReq.user || anyReq.currentUser || null;
          const userId = userFromReq?.id ?? null;

          await addCaseLog({
            caseId: createdCase.id,
            userId,
            action: "CASE_CREATED",
            message: "Sprawa utworzona ręcznie z dashboardu",
            meta: {
              source: "manual_dashboard",
            },
          });
        } catch (e) {
          console.warn("addCaseLog CASE_CREATED error:", e);
        }
        // ================================
        // 4) POWIADOMIENIE DLA WŁAŚCICIELA
        // ================================
        try {
          const amountStr = Number(createdCase.loan_amount ?? 0).toLocaleString("pl-PL", {
            style: "currency",
            currency: "PLN",
            maximumFractionDigits: 0,
          });

          await createNotification({
            userId: user.id,                // na razie powiadamiamy właściciela (też admina)
            caseId: createdCase.id,
            type: "case_created",
            title: "Nowa sprawa została utworzona",
            body: `Klient: ${createdCase.client}, kwota: ${amountStr}.`,
            meta: {
              caseId: createdCase.id,
              ownerId: createdCase.owner_id,
              createdBy: user.id,
              role: user.role,
            },
          });

          console.log(
            `[NOTIF] case_created → user=${user.id}, case=${createdCase.id}`
          );
        } catch (notifErr) {
          console.error("[NOTIF] createNotification error:", notifErr);
          // nie blokujemy odpowiedzi do frontu
        }

        return res.json(createdCase);
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

      // 🔹 NOWE: wyliczamy status_code (z bazy albo ze starego statusu)
      let statusCode: string | null = row.status_code ?? null;

      if (!statusCode) {
        const legacy = (row.status || "").toLowerCase();
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

      // selekcja tylko potrzebnych pól do frontu (bez wrażliwych)
      const safe = {
        id: row.id,
        client: row.client,
        bank: row.bank,
        loan_amount: row.loan_amount,
        status: row.status,          // legacy – jak coś jeszcze z tego korzysta
        status_code: statusCode,     // ⬅⬅⬅ KLUCZOWE DLA NOWEGO SYSTEMU
        contract_date: row.contract_date,
        phone: row.phone,
        email: row.email,
        address: row.address,
        pesel: row.pesel,            // jak chcesz – można też wypiąć z API
        wps_forecast: row.wps_forecast,
        wps_final: row.wps_final,
        client_benefit: row.client_benefit,
        notes: row.notes,
        owner_id: row.owner_id,
        updated_at: row.updated_at,
        offer_skd: row.offer_skd,    // jeśli trzymasz JSON z ofertą
        iban: row.iban ?? null,

        // ✅ NOWE: twarde kolumny do blokady UI po zatwierdzeniu
        variant: row.variant ?? null,
        variant_picked: !!row.variant_picked,
        variant_picked_at: row.variant_picked_at ?? null,
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
      "notes",
      "iban",
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
        // 1) WHITELISTA DOZWOLONYCH PÓL
        // ==============================
        const allowedFields = {
          client: true,
          bank: true,
          loan_amount: true,
          status: true,
          contract_date: true,
          phone: true,
          email: true,
          address: true,
          pesel: true,
          notes: true,
          iban: true,
        };

        // ==============================
        // 2) Pobranie i wybór pól
        // ==============================
        const body = req.body || {};
        const update: any = {};

        for (const key of Object.keys(body)) {
          if (allowedFields[key]) {
            update[key] = body[key];
          }
        }

        if (Object.keys(update).length === 0) {
          return res.status(400).json({ error: "Brak pól do aktualizacji" });
        }

        // 🔧 pomocniczy cleaner tekstu
        const clean = (v: any) =>
          typeof v === "string" ? v.replace(/[<>]/g, "").trim() : v;

        // 🔧 sanitizator liczb
        const sanitizeNumberLike = (raw: any): number | null => {
          if (raw === null || raw === undefined) return null;

          let s = String(raw)
            .replace(/\s+/g, "")
            .replace(",", ".")
            .replace(/[^\d.-]/g, "");

          if (s === "" || s === "." || s === "-" || s === "-.") return null;

          const num = Number(s);
          return Number.isFinite(num) ? num : null;
        };

        // ==============================
        // 3) WALIDACJE – bezpieczne i twarde
        // ==============================

        // EMAIL
        if (update.email !== undefined) {
          const e = clean(update.email);
          if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
            return res.status(400).json({ error: "Nieprawidłowy adres e-mail" });
          }
          update.email = e || null;
        }

        // TELEFON
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

        // KWOTA KREDYTU — ✨ NOWA MOCNA WALIDACJA ✨
        if (update.loan_amount !== undefined) {
          const amount = sanitizeNumberLike(update.loan_amount);

          if (amount === null || amount < 0 || amount > 5_000_000) {
            return res.status(400).json({ error: "Nieprawidłowa kwota kredytu" });
          }

          update.loan_amount = amount;
        }

        // DATA
        if (update.contract_date !== undefined) {
          const d = clean(update.contract_date);
          if (d && isNaN(Date.parse(d))) {
            return res.status(400).json({ error: "Nieprawidłowa data umowy" });
          }
          update.contract_date = d || null;
        }
        // IBAN – oczyszczenie z odstępów i dziwnych znaków
        if (update.iban !== undefined) {
          let iban = clean(update.iban);

          if (iban) {
            // usuwamy spacje, zamieniamy na wielkie litery
            iban = iban.replace(/\s+/g, "").toUpperCase();

            // zostawiamy tylko A–Z i cyfry
            iban = iban.replace(/[^A-Z0-9]/g, "");

            // twardy limit długości IBAN (teoretycznie max 34 znaki)
            if (iban.length > 34) {
              iban = iban.slice(0, 34);
            }
          }

          update.iban = iban || null;
        }
        // TEKSTY
        const safeText = (t: any, max: number) =>
          t ? clean(String(t).slice(0, max)) : null;

        if (update.client) update.client = safeText(update.client, 200);
        if (update.bank) update.bank = safeText(update.bank, 200);
        if (update.address) update.address = safeText(update.address, 400);
        if (update.notes) update.notes = safeText(update.notes, 2000);
        if (update.status) update.status = safeText(update.status, 100);

        // ==============================
        // 4) BUDOWANIE UPDATE SQL
        // ==============================
        const sqlFields = [];
        const values = [];
        let i = 1;

        for (const [k, v] of Object.entries(update)) {
          sqlFields.push(`${k} = $${i}`);
          values.push(v);
          i++;
        }

        sqlFields.push(`updated_at = NOW()`);
        values.push(id);

        const result = await pool.query(
          `UPDATE cases SET ${sqlFields.join(", ")} WHERE id = $${i} RETURNING *`,
          values
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ error: "Sprawa nie istnieje" });
        }

        // AUDYT
        console.log(
          `[PATCH CASE] user=${user.id}, case=${id}, updated=${Object.keys(update).join(", ")}`
        );

        return res.json(result.rows[0]);
      } catch (err) {
        console.error("PATCH /api/cases/:id ERROR:", err);
        return res.status(500).json({ error: "Błąd serwera" });
      }
    }
  );

  // === DANE KLIENTA ===
  app.put(
    "/api/cases/:id/client",
    mediumApiLimit,
    requireAuth,
    denyUnknownFields(["client", "phone", "email", "address", "pesel"]),
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
    }
  );

  // === DANE KREDYTU ===
  app.put(
    "/api/cases/:id/credit",
    mediumApiLimit,
    requireAuth,
    denyUnknownFields(["loan_amount", "contract_date", "bank", "status"]),
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
    }
  );

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

  // === ZAPIS WPS BASIC → WPS (prognoza) + powiadomienie ===
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
        // 0) UZUPEŁNIJ DANE KREDYTU Z BODY (jeśli przyszły z frontu)
        await pool.query(
          `
    UPDATE cases
    SET
      contract_date           = COALESCE($1::date, contract_date),
      loan_term_months        = COALESCE($2::int, loan_term_months),
      interest_rate_annual    = COALESCE($3::numeric, interest_rate_annual),
      loan_amount_total       = COALESCE($4::numeric, loan_amount_total),
      loan_amount_net         = COALESCE($5::numeric, loan_amount_net),
      installment_amount_real = COALESCE($6::numeric, installment_amount_real)
    WHERE id = $7
    `,
          [
            req.body?.contract_date ?? null,
            req.body?.loan_term_months ?? null,
            req.body?.interest_rate_annual ?? null,
            req.body?.loan_amount_total ?? null,
            req.body?.loan_amount_net ?? null,
            req.body?.installment_amount_real ?? null,
            caseId,
          ]
        );

        const c = await loadCaseForUser(caseId, user);

        if (
          c.contract_date == null ||
          c.loan_term_months == null ||
          c.interest_rate_annual == null ||
          c.loan_amount_total == null ||
          c.loan_amount_net == null
        ) {
          return res.status(400).json({ error: "Brak kompletu danych kredytu do wyliczenia WPS v2." });
        }

// ✅ override: przedterminowa spłata / licz do wskazanej daty
const paidToDateRaw = req.body?.paid_to_date ?? req.body?.paidToDate ?? null;
const monthsPaidRaw = req.body?.months_paid ?? req.body?.monthsPaid ?? null;

// asOfDate — data, "na kiedy liczymy"
const asOfDate =
  paidToDateRaw != null && String(paidToDateRaw).trim() !== ""
    ? new Date(String(paidToDateRaw))
    : undefined;

if (asOfDate && Number.isNaN(asOfDate.getTime())) {
  return res.status(400).json({ error: "Nieprawidłowa paid_to_date." });
}

// monthsPaid — jeśli przyszło, to override
const monthsPaid =
  monthsPaidRaw != null && String(monthsPaidRaw).trim() !== ""
    ? Math.max(
        0,
        Math.min(
          Number(c.loan_term_months),
          Number(monthsPaidRaw)
        )
      )
    : null;

if (monthsPaid != null && !Number.isFinite(monthsPaid)) {
  return res.status(400).json({ error: "Nieprawidłowa months_paid." });
}

        // 2) LICZENIE WPS v2
        const out = computeSkdV2(
  {
    contractDate: c.contract_date,
    termMonths: Number(c.loan_term_months),
    aprStartPct: Number(c.interest_rate_annual),
    loanGross: Number(c.loan_amount_total),
    loanNet: Number(c.loan_amount_net),
    installment:
      c.installment_amount_real != null
        ? Number(c.installment_amount_real)
        : null,
    wiborType: "3M",

    // ✅ override
    monthsPaid: monthsPaid,
    paidToDate: paidToDateRaw ?? null,
  },
  {
    asOfDate: asOfDate ?? undefined,
  }
);

        const wpsNumber = Math.max(0, Math.round(Number(out.wpsToday)));

        // 3) ZAPIS WPS
        const result = await pool.query(
          `
    UPDATE cases
    SET wps_forecast = $1
    WHERE id = $2
    RETURNING id, client, loan_amount, bank, wps_forecast
    `,
          [wpsNumber, caseId]
        );

        try {
          await pool.query(
            `
    INSERT INTO cases_wps_history (case_id, user_id, wps_forecast, wps_input, note)
    VALUES ($1, $2, $3, $4, $5)
    `,
            [
              caseId,
              user.id,
              wpsNumber,
              {
                contract_date: c.contract_date,
                loan_term_months: c.loan_term_months,
                interest_rate_annual: c.interest_rate_annual,
                loan_amount_total: c.loan_amount_total,
                loan_amount_net: c.loan_amount_net,
                installment_amount_real: c.installment_amount_real ?? null,
                // ✅ NOWE — kluczowe dla audytu
                paid_to_date: paidToDateRaw ?? null,
                months_paid: monthsPaid ?? null,
              },
              null,
            ]
          );
        } catch (e) {
          console.warn("[WPS-HISTORY] insert error:", e);
        }

        const row = result.rows[0];

        await createNotification({
          userId: user.id,
          caseId,
          type: "wps_forecast_saved",
          title: `Zapisano WPS (prognoza) dla sprawy #${row.id}`,
          body:
            `Nowa prognoza WPS: ${wpsNumber.toLocaleString("pl-PL")} PLN` +
            (row.client ? ` (klient: ${row.client})` : ""),
          meta: {
            wps_forecast: wpsNumber,
            loan_amount: row.loan_amount,
            bank: row.bank,
          },
        });

        return res.json({
          ok: true,
          case: row,
          skd_v2: {
            monthsPaid: out.monthsPaid,
            marginStartPct: out.marginStartPct,
            wiborStartPct: out.wiborStartPct,
          },
        });
      } catch (err) {
        console.error("Błąd PATCH /api/cases/:id/wps-basic:", err);
        return res
          .status(500)
          .json({ error: "Błąd serwera przy zapisie WPS (prognoza)." });
      }

    }
  );
  // PREVIEW — liczy WPS v2 na backendzie (bez zapisu)
  app.post(
    "/api/cases/:id/wps-basic/preview",
    softApiLimit,
    requireAuth,
    async (req, res) => {
      const user = (req as any).user;
      const caseId = Number(req.params.id);

      if (!Number.isFinite(caseId)) {
        return res.status(400).json({ ok: false, error: "Nieprawidłowe ID sprawy." });
      }

      const allowed = await verifyCaseOwnership(caseId, user);
      if (allowed === null) return res.status(404).json({ ok: false, error: "Nie znaleziono sprawy." });
      if (!allowed) return res.status(403).json({ ok: false, error: "Brak dostępu do tej sprawy" });

      try {
        const body: any = req.body || {};
console.log("[WPS PREVIEW HIT]", caseId, body);

// --- normalizacja wejścia ---
const termMonths = Number(body.termMonths);
const contractDate = body.contractDate || null;

// ✅ paidToDate -> asOfDate (jeśli brak: dziś)
const paidToDate = body.paidToDate ? String(body.paidToDate) : null;
const asOfDate = paidToDate ? new Date(paidToDate) : new Date();
asOfDate.setHours(0, 0, 0, 0);

// ✅ monthsPaid: jeśli przyszło z frontu, traktujemy jako źródło prawdy
let monthsPaid: number | null =
  Number.isFinite(Number(body.monthsPaid)) ? Number(body.monthsPaid) : null;

// clamp monthsPaid do [0..termMonths]
if (monthsPaid != null && Number.isFinite(termMonths) && termMonths > 0) {
  monthsPaid = Math.max(0, Math.min(termMonths, monthsPaid));
}

console.log("[WPS PREVIEW PARSED]", {
  contractDate,
  termMonths,
  paidToDate,
  asOfDate: asOfDate.toISOString().slice(0, 10),
  monthsPaid,
});

const out = computeSkdV2({
  contractDate,
  termMonths: Number.isFinite(termMonths) ? termMonths : 0,
  aprStartPct: Number(body.aprStartPct),
  loanGross: Number(body.loanGross),
  loanNet: Number(body.loanNet),
  installment: body.installment != null ? Number(body.installment) : null,
  wiborType: "3M",

  // ✅ PRZEKAZUJ OVERRIDE Z FRONTU:
    monthsPaid: body.monthsPaid != null ? Number(body.monthsPaid) : null,
    paidToDate: body.paidToDate ?? null,
  } as any,
  {
    // ✅ asOfDate ma być datą spłaty (jeśli jest) – inaczej silnik weźmie dziś
    asOfDate: body.paidToDate ? new Date(body.paidToDate) : undefined,
  }
);

return res.json({ ok: true, result: out });
      } catch (e: any) {
        return res.status(400).json({ ok: false, error: e?.message || "SKD v2 error" });
      }
    }
  );

  // === ZAPIS OFERTY SKD (PUT — twarda walidacja) ===
  app.put(
    "/api/cases/:id/skd-offer",
    mediumApiLimit,
    requireAuth,
    denyUnknownFields([
      "wps_forecast",
      "offer_skd",
      "contract_date",
      "loan_term_months",
      "interest_rate_annual",
      "loan_amount_total",
      "loan_amount_net",
      "installment_amount_real",
    ]),

    async (req, res) => {
      try {
        const user = (req as any).user;
        const caseId = Number(req.params.id);

        if (!Number.isFinite(caseId)) {
          return res.status(400).json({ error: "Nieprawidłowe ID sprawy." });
        }

        // 🔐 Sprawdzenie własności sprawy
        const allowed = await verifyCaseOwnership(caseId, user);
        if (allowed === null) return res.status(404).json({ error: "Nie znaleziono sprawy." });
        if (!allowed) return res.status(403).json({ error: "Brak dostępu do tej sprawy" });

        // ============================
        // 1) Pobranie surowych danych
        // ============================
        const body = req.body || {};
        let { wps_forecast, offer_skd } = body;

        // ============================
        // 2) WPS forecast — twarde granice
        // ============================
        const wf = Number(wps_forecast);
        if (!Number.isFinite(wf) || wf < 0 || wf > 1_000_000) {
          return res.status(400).json({ error: "Nieprawidłowa wartość WPS forecast." });
        }

        // ============================
        // 3) offer_skd — musi być obiektem
        // ============================
        if (!offer_skd || typeof offer_skd !== "object") {
          return res.status(400).json({ error: "offer_skd musi być obiektem." });
        }

        // ============================
        // 4) Variant — tylko 3 opcje
        // ============================
        const variant = offer_skd.variant;
        const allowedVariants = ["sf50", "sf49", "sell"];
        if (!allowedVariants.includes(variant)) {
          return res.status(400).json({ error: "Nieprawidłowy wariant oferty SKD." });
        }

        // ============================
        // 5) buyout_pct — tylko jeśli SELL
        // --- BUYOUT (10–15% w UI; 0.10–0.15 w bazie) ---
        let buyout_pct: number | null = null;

        if (variant === "sell") {
          let raw = sanitizeNumberLike(offer_skd.buyout_pct);

          if (raw === null) {
            const prev = await pool.query(
              `SELECT offer_skd FROM cases WHERE id = $1`,
              [caseId]
            );

            const prevOffer = prev.rows?.[0]?.offer_skd || {};
            const prevBuyout = sanitizeNumberLike(prevOffer.buyout_pct);

            if (prevBuyout === null) {
              return res.status(400).json({
                error: "buyout_pct musi być liczbą w zakresie 10–15%."
              });
            }

            raw = prevBuyout;
          }

          let normalized = raw > 1 ? raw / 100 : raw;

          if (normalized < 0.10 || normalized > 0.15) {
            return res.status(400).json({
              error: "buyout_pct musi zawierać się między 10 a 15 procent."
            });
          }

          buyout_pct = normalized;
        } else {
          buyout_pct = null;
        }


        // ============================
        // 6) future_interest — opcjonalne, czyszczone
        // ============================
        let future_interest = sanitizeNumberLike(offer_skd.future_interest) ?? 0;
        if (future_interest < 0) future_interest = 0;

        // ============================
        // 7) eligibility — twardy boolean-cast
        // ============================
        const elig = offer_skd.eligibility || {};
        const eligibility = {
          sf50: elig.sf50 === false ? false : true,
          sf49: elig.sf49 === false ? false : true,
          sell: elig.sell === false ? false : true,
        };

        // ============================
        // 8) Finalny obiekt zapisowy
        // ============================
        const finalOffer = {
          variant,
          buyout_pct,
          future_interest,
          eligibility,

          // ✅ NOWE: “zatwierdzony wybór wariantu”
          variant_picked: offer_skd?.variant_picked === true,
          variant_picked_at: offer_skd?.variant_picked_at ?? null,
        };

        // ============================
        // 9) Zapis do bazy
        // ============================
        const result = await pool.query(
          `
  UPDATE cases
SET
  contract_date            = $1,
  loan_term_months         = $2,
  interest_rate_annual     = $3,
  loan_amount_total        = $4,
  loan_amount_net          = $5,
  installment_amount_real  = $6,
  wps_forecast             = $7,
  offer_skd                = $8,

  variant_picked           = $9,
  variant_picked_at        = $10,

  updated_at               = NOW()
WHERE id = $11
RETURNING id, wps_forecast, offer_skd, variant_picked, variant_picked_at;
  `,
          [
            body.contract_date ?? null,            // $1
            body.loan_term_months ?? null,         // $2
            body.interest_rate_annual ?? null,     // $3
            body.loan_amount_total ?? null,        // $4
            body.loan_amount_net ?? null,          // $5
            body.installment_amount_real ?? null,  // $6
            wf,                                    // $7
            finalOffer,                            // $8
            finalOffer.variant_picked ?? false,    // $9
            finalOffer.variant_picked_at ?? null,  // $10
            caseId                                 // $11
          ]
        );

        if (!result.rowCount) {
          return res.status(404).json({ error: "Nie znaleziono sprawy." });
        }

        // ============================
        // 10) AUDYT
        // ============================
        console.log(
          `[SKD-PUT] user=${user.id} role=${user.role} case=${caseId} variant=${variant} buyout=${buyout_pct ?? "-"}`
        );

        // ============================
        // 11) POWIADOMIENIE
        // ============================
        try {
          const row = result.rows[0];
          const offerSkd: any = row.offer_skd || {};

          const variantLabel =
            offerSkd.variant === "sf49"
              ? "Success Fee 51% dla klienta"
              : offerSkd.variant === "sell"
                ? "Sprzedaż roszczenia"
                : "Success Fee 50/50";

          await createNotification({
            userId: user.id, // na razie powiadamiamy autora zmian (admina)
            caseId,
            type: "skd_offer_saved",
            title: `Oferta SKD zapisana dla sprawy #${row.id}`,
            body:
              `Wariant: ${variantLabel}` +
              (row.client ? ` (klient: ${row.client})` : "") +
              (typeof row.wps_forecast === "number"
                ? `, WPS: ${row.wps_forecast.toLocaleString("pl-PL")} PLN`
                : ""),
            meta: {
              variant: offerSkd.variant || null,
              wps_forecast: row.wps_forecast ?? null,
              bank: row.bank,
              loan_amount: row.loan_amount,
            },
          });

          console.log(
            `[NOTIF] skd_offer_saved → user=${user.id} case=${caseId}`
          );
        } catch (notifErr) {
          console.warn("[NOTIF] skd_offer_saved error:", notifErr);
        }

        // ============================
        // 12) OK
        // ============================
        return res.json({ ok: true, case: result.rows[0] });

      } catch (err) {
        console.error("Błąd PUT /api/cases/:id/skd-offer:", err);
        return res.status(500).json({ error: "Błąd serwera przy zapisie oferty SKD." });
      }
    }
  );

  // === POBIERANIE PLIKU (download) ===
  app.get(
    "/api/files/:fileId",
    softApiLimit,
    requireAuth,
    async (req, res) => {
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
          cf.id,
          cf.case_id,
          cf.original_name,
          cf.stored_name,
          cf.mime_type,
          cf.size,
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

        // 2) Sprawdzamy uprawnienia (admin albo właściciel sprawy)
        if (user.role !== "admin" && row.owner_id !== user.id) {
          return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
        }

        // 3) Budujemy bezpieczną ścieżkę do pliku
        const uploadsRoot = path.join(process.cwd(), "uploads", "cases");
        const filePath = path.join(
          uploadsRoot,
          String(row.case_id),
          row.stored_name
        );
        const resolved = path.resolve(filePath);

        // ⛔ twarda kontrola, żeby ktoś nie wyszedł poza katalog uploads/cases
        if (!resolved.startsWith(uploadsRoot)) {
          console.error("Próba wyjścia poza katalog uploads:", resolved);
          return res.status(400).json({ error: "Nieprawidłowa ścieżka pliku" });
        }

        // 4) Sprawdź czy plik fizycznie istnieje
        try {
          await fsPromises.stat(resolved);
        } catch (err: any) {
          if (err.code === "ENOENT") {
            return res.status(404).json({ error: "Plik nie istnieje na dysku" });
          }
          console.error("Błąd stat dla pliku:", err);
          return res.status(500).json({ error: "Błąd serwera przy odczycie pliku" });
        }

        // 5) Nagłówki i wysyłka pliku
        const mime = row.mime_type || "application/octet-stream";
        const orig = row.original_name || "plik";

        res.setHeader("Content-Type", mime);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(orig)}"`
        );

        return res.sendFile(resolved, (err) => {
          if (err) {
            console.error("sendFile error:", err);
            if (!res.headersSent) {
              res.status(500).json({ error: "Błąd podczas wysyłania pliku" });
            }
          }
        });
      } catch (err) {
        console.error("GET /api/files/:fileId error:", err);
        return res
          .status(500)
          .json({ error: "Błąd serwera przy pobieraniu pliku" });
      }
    }
  );

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

  // timeline sprawy
  app.get("/api/cases/:id/logs", softApiLimit, requireAuth, async (req, res) => {
    try {
      const caseId = Number(req.params.id);
      if (!caseId) {
        return res.status(400).json({ error: "Brak ID sprawy" });
      }

      // opcjonalnie: możesz tu kiedyś dorzucić sprawdzenie,
      // czy użytkownik ma dostęp do tej sprawy (admin / owner)

      const logs = await fetchCaseLogs(caseId);
      res.json({ ok: true, logs });
    } catch (err) {
      console.error("GET /api/cases/:id/logs error:", err);
      res
        .status(500)
        .json({ error: "Błąd serwera przy pobieraniu historii sprawy" });
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

      // 3️⃣ TYLKO limit rozmiaru (20 MB) – reszta jest robiona w fileFilter
      const maxSize = MAX_FILE_SIZE; // 20 MB

      for (const f of files) {
        if (f.size > maxSize) {
          return res.status(400).json({
            error: `Plik jest zbyt duży (max 20 MB): ${f.originalname}`,
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
    }
  );

  console.log("➡️ routes: GET/POST/PATCH/PUT/DELETE /api/cases registered");
}