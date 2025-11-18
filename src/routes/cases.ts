// src/routes/cases.ts
import { Express } from "express";
import pool from "../db";
import multer from "multer";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { requireAuth } from "../middleware/requireAuth";

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

// Upewniamy się, że katalog istnieje
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Konfiguracja multer – zapis na dysk do UPLOAD_DIR
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || "");
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({ storage });

export default function casesRoutes(app: Express) {
  console.log("➡️ routes: cases + KPI loaded");
  // === UPLOAD PLIKÓW DO SPRAW (konfiguracja) ===
  const uploadRoot = path.join(process.cwd(), "uploads");

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const caseId = req.params.id || req.body.caseId;
      const dir = path.join(uploadRoot, "cases", String(caseId ?? "unknown"));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname || "");
      cb(null, unique + ext);
    },
  });

  const upload = multer({ storage });

  // === HELPERY DO NORMALIZACJI DANYCH ===

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

  /**
   * Wspólna funkcja częściowej aktualizacji pól w tabeli `cases`.
   * Przyjmuje obiekt z polami, które chcesz zaktualizować.
   */
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

  // === LISTA SPRAW (dla dashboardu) ===
  app.get("/api/cases", requireAuth, async (req, res) => {
    try {
      const q = await pool.query(
        `
                SELECT
          id,
          client,
          bank,
          loan_amount,
          COALESCE(wps_forecast, wps) AS wps,
          status,
          contract_date,
          agent_id
        FROM cases
        ORDER BY id DESC
        `
      );
      res.json(q.rows);
    } catch (err) {
      console.error("GET /api/cases error", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // === KPI (opcjonalne) ===
  app.get("/api/kpi", requireAuth, async (_req, res) => {
    try {
      const q = await pool.query(
        `
        SELECT
          COUNT(*)::int AS total_cases,
          COUNT(*) FILTER (WHERE status NOT IN ('zamknieta','zamknięta','archiwum'))::int AS open_cases,
          COUNT(*) FILTER (WHERE status IN ('nowa','analiza','w toku'))::int              AS new_cases,
          COALESCE(SUM(wps), 0)::numeric AS wps_total
        FROM cases
        `
      );

      const r =
        q.rows[0] || {
          total_cases: 0,
          open_cases: 0,
          new_cases: 0,
          wps_total: 0,
        };

      res.json({
        totalCases: r.total_cases,
        openCases: r.open_cases,
        newCases: r.new_cases,
        wpsTotal: r.wps_total,
      });
    } catch (err) {
      console.error("GET /api/kpi error", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // === DODAWANIE NOWEJ SPRAWY ===
    app.post("/api/cases", requireAuth, async (req, res) => {
    try {
      const { client, loan_amount, status, bank, agent_id } = req.body || {};

      if (!client || typeof loan_amount !== "number") {
        return res
          .status(400)
          .json({ error: "client i loan_amount są wymagane" });
      }

      const normStatus = (status || "nowa").toString();

      const sql = `
        INSERT INTO cases (client, loan_amount, status, bank, agent_id)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, client, loan_amount, wps, status, contract_date, bank, agent_id
      `;
      const params = [
        client,
        loan_amount,
        normStatus,
        bank ?? null,
        agent_id ?? null, // tymczasowo – potem nadpiszemy zalogowanym userem
      ];

      const { rows } = await pool.query(sql, params);
      return res.json(rows[0]);
    } catch (e: any) {
      console.error("POST /api/cases error:", e);
      return res.status(500).json({
        error: "DB error",
        detail: e.message || String(e),
      });
    }
  });

  // === SZCZEGÓŁY JEDNEJ SPRAWY (dla case.html) ===
  app.get("/api/cases/:id", requireAuth, async (req, res) => {
    const rawId = req.params.id;
    const id = Number(rawId);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid case id" });
    }

    try {
      const result = await pool.query(
        `
                    SELECT
        id,
        client        AS client,
        bank          AS bank,
        loan_amount   AS loan_amount,
        status        AS status,
        contract_date AS contract_date,
        phone,
        email,
        address,
        pesel,
        wps_forecast,
        wps_final,
        client_benefit,
        agent_id
      FROM cases
      WHERE id = $1

        `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Case not found" });
      }

      const row = result.rows[0];
      return res.json(row);
    } catch (err) {
      console.error("GET /api/cases/:id error", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // === OGÓLNA CZĘŚCIOWA AKTUALIZACJA SPRAWY (legacy / multi-update) ===
  app.patch("/api/cases/:id", requireAuth, async (req, res) => {
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
    }

    try {
      const result = await updateCasePartial(id, req.body || {});
      return res.json(result);
    } catch (err) {
      console.error("PATCH /api/cases/:id error", err);
      return res.status(500).json({ error: "Server error" });
    }
  });

  // === NOWE, CZYTELNE ENDPOINTY SEKCYJNE (pod caseDetails 2.0) ===

  // Dane klienta: imię, telefon, email, adres, pesel
  app.put("/api/cases/:id/client", requireAuth, async (req, res) => {
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
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

  // Dane kredytu: kwota, data uruchomienia, bank, status
  app.put("/api/cases/:id/credit", requireAuth, async (req, res) => {
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
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

  // === ODCZYT OFERTY SKD (GET /api/cases/:id/skd-offer) ===
  app.get("/api/cases/:id/skd-offer", requireAuth, async (req, res) => {
    const { id } = req.params;

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

  // === ZAPIS WPS BASIC (PATCH /api/cases/:id/wps-basic) ===
  app.patch("/api/cases/:id/wps-basic", requireAuth, async (req, res) => {
    try {
      const caseId = Number(req.params.id);
      const { wps_basic } = req.body || {};

      if (!Number.isFinite(caseId)) {
        return res.status(400).json({ error: "Nieprawidłowe ID sprawy." });
      }

      const wpsNumber = Number(wps_basic);
      if (!Number.isFinite(wpsNumber)) {
        return res.status(400).json({ error: "Nieprawidłowa wartość WPS." });
      }

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

  // === AKTUALIZACJA OFERTY SKD (PUT /api/cases/:id/skd-offer) ===
  app.put("/api/cases/:id/skd-offer", requireAuth, async (req, res) => {
    try {
      const caseId = Number(req.params.id);
      if (!Number.isFinite(caseId)) {
        return res.status(400).json({ error: "Nieprawidłowe ID sprawy." });
      }

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

  // === DOKUMENTY SPRAWY: POBRANIE PLIKU ===
app.get("/api/files/:fileId", requireAuth, async (req, res) => {
  const rawId = req.params.fileId;
  const fileId = Number(rawId);

  if (!Number.isFinite(fileId)) {
    return res.status(400).json({ error: "Nieprawidłowe ID pliku" });
  }

  try {
    const q = await pool.query(
      "SELECT case_id, original_name, stored_name, mime_type FROM case_files WHERE id = $1",
      [fileId]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Plik nie istnieje" });
    }

    const row = q.rows[0];

    // dopasowane do realnej struktury: uploads/cases/<case_id>/<stored_name>
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
  app.get("/api/cases/:id/files", requireAuth, async (req, res) => {
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
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

      return res.json(result.rows);
    } catch (err) {
      console.error("GET /api/cases/:id/files error", err);
      return res.status(500).json({ error: "Błąd serwera przy pobieraniu plików" });
    }
  });
  
// === USUWANIE PLIKU PO ID ===
app.delete("/api/files/:fileId", requireAuth, async (req, res) => {
  const rawId = req.params.fileId;
  const fileId = Number(rawId);

  if (!Number.isFinite(fileId)) {
    return res.status(400).json({ error: "Nieprawidłowe ID pliku" });
  }

  try {
    // 1) pobierz info o pliku
    const q = await pool.query(
      "SELECT stored_name FROM case_files WHERE id = $1",
      [fileId]
    );

    if (q.rowCount === 0) {
      return res.status(404).json({ error: "Plik nie istnieje" });
    }

    const storedName = q.rows[0].stored_name;
    const filePath = path.join(UPLOAD_DIR, storedName);

    // 2) usuń fizyczny plik
    try {
      await fsPromises.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error("Błąd usuwania pliku z dysku:", err);
      }
    }

    // 3) usuń rekord z bazy
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
app.post("/api/cases/:id/files", requireAuth, upload.array("files"), async (req, res) => {
  const rawId = req.params.id;
  const caseId = Number(rawId);

  if (!Number.isFinite(caseId)) {
    return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
  }

  const files = (req.files as Express.Multer.File[]) || [];

  if (!files.length) {
    return res.status(400).json({ error: "Brak plików do dodania" });
  }

  try {
    const values: any[] = [];
    const placeholders: string[] = [];

    files.forEach((f, index) => {
      // (case_id, original_name, stored_name, mime_type, size)
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
      "📎 Dodano pliki do sprawy",
      caseId,
      "->",
      result.rowCount,
      "plików"
    );

    return res.json({
      ok: true,
      files: result.rows,
    });
  } catch (err) {
    console.error("Błąd przy POST /api/cases/:id/files:", err);
    return res
      .status(500)
      .json({ error: "Błąd serwera przy zapisie plików" });
  }
});
  

  // === USUWANIE SPRAWY (DELETE) ===
  app.delete("/api/cases/:id", requireAuth, async (req, res) => {
    const idRaw = req.params.id;
    const id = Number(idRaw);

    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
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
