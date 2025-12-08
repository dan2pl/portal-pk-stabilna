// src/routes/admin.ts
import { Express, Request, Response } from "express";
import pool from "../db";
import bcrypt from "bcryptjs";
import { requireAdmin } from "../middleware/requireAuth";

// korzystamy z tych samych limiterów co w cases.ts
import { softApiLimit, mediumApiLimit } from "./cases";
import { denyUnknownFields } from "./denyUnknownFields";

export default function adminRoutes(app: Express) {
  console.log("➡️ routes: admin loaded");

  // LISTA UŻYTKOWNIKÓW (tylko admin)
  app.get(
    "/api/admin/users",
    softApiLimit,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const q = await pool.query(
          `
          SELECT
            id,
            email,
            name,
            role,
            is_active,
            created_at,
            last_login
          FROM users
          ORDER BY id ASC
          `
        );

        return res.json({ users: q.rows });
      } catch (err) {
        console.error("GET /api/admin/users error:", err);
        return res
          .status(500)
          .json({ error: "Błąd serwera przy pobieraniu użytkowników" });
      }
    }
  );

  // DODAWANIE UŻYTKOWNIKA (admin tworzy agenta / admina)
  app.post(
    "/api/admin/users",
    mediumApiLimit,
    requireAdmin,
    denyUnknownFields(["email", "name", "role", "password"]),
    async (req: Request, res: Response) => {
      try {
        const raw = req.body || {};
        let { email, name, role, password } = raw;

        // helper do czyszczenia stringów
        const cleanStr = (v: any, max = 120) => {
          if (typeof v !== "string") return "";
          let s = v.trim();
          s = s.replace(/[<>]/g, ""); // wycinamy potencjalny HTML
          s = s.replace(/[\u0000-\u001F]/g, ""); // kontrolne znaki
          return s.slice(0, max);
        };

        email = cleanStr(email, 150);
        name = cleanStr(name, 120);
        role = cleanStr(role, 20);

        if (!email || !name || !role || !password) {
          return res.status(400).json({
            error: "email, name, role i password są wymagane",
          });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: "Nieprawidłowy adres e-mail" });
        }

        if (!["admin", "agent"].includes(role)) {
          return res.status(400).json({ error: "Nieprawidłowa rola" });
        }

        if (typeof password !== "string" || password.length < 10) {
          return res.status(400).json({
            error: "Hasło musi mieć co najmniej 10 znaków",
          });
        }

        // czy email już istnieje?
        const exists = await pool.query(
          "SELECT id FROM users WHERE email = $1",
          [email]
        );
        if (exists.rowCount > 0) {
          return res
            .status(409)
            .json({ error: "Użytkownik z takim email już istnieje" });
        }

        const hash = await bcrypt.hash(password, 12); // lekko podkręcamy koszt

        const q = await pool.query(
          `
          INSERT INTO users (email, name, role, password_hash, is_active)
          VALUES ($1, $2, $3, $4, true)
          RETURNING id, email, name, role, is_active, created_at
          `,
          [email, name, role, hash]
        );

        const user = q.rows[0];

        console.log(
          `[ADMIN][CREATE_USER] id=${user.id} email=${user.email} role=${user.role}`
        );

        return res.status(201).json({ user });
      } catch (err) {
        console.error("POST /api/admin/users error:", err);
        return res
          .status(500)
          .json({ error: "Błąd serwera przy tworzeniu użytkownika" });
      }
    }
  );

  // === ADMIN: LISTA LEADÓW ===
  app.get("/api/admin/leads", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          type,
          source,
          full_name,
          email,
          phone,
          meta,
          status,
          created_at
        FROM leads
        ORDER BY created_at DESC
        LIMIT 500
        `
      );

      return res.json({
        ok: true,
        leads: result.rows,
      });
    } catch (err) {
      console.error("GET /api/admin/leads ERROR:", err);
      return res.status(500).json({
        error: "Błąd serwera przy pobieraniu leadów",
      });
    }
  });
  // Zmiana statusu leada
  app.get("/admin/leads/:id/status", requireAdmin, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const { status } = req.body as { status?: string };

      if (!leadId || !status) {
        return res.status(400).json({ error: "Brak ID lub statusu" });
      }

      const result = await pool.query(
        `UPDATE leads
       SET status = $1
       WHERE id = $2
       RETURNING id, status`,
        [status, leadId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Lead nie znaleziony" });
      }

      res.json({ ok: true, lead: result.rows[0] });
    } catch (err) {
      console.error("PATCH /api/admin/leads/:id/status error:", err);
      res.status(500).json({ error: "Błąd serwera przy zmianie statusu leada" });
    }
  });
  // ==========================================
  //   LEADY – lista, szczegóły, zmiana statusu
  // ==========================================

  // GET /api/admin/leads – lista leadów
  app.get("/api/admin/leads", requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, type, source, full_name, email, phone, meta, created_at, status
       FROM leads
       ORDER BY created_at DESC`
      );

      res.json({ ok: true, leads: result.rows });
    } catch (err) {
      console.error("GET /api/admin/leads error:", err);
      res
        .status(500)
        .json({ error: "Błąd serwera przy pobieraniu leadów" });
    }
  });

  // GET /api/admin/leads/:id – pojedynczy lead
  app.get("/api/admin/leads/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);

    try {
      const result = await pool.query(
        `SELECT id, type, source, full_name, email, phone, meta, created_at, status
       FROM leads
       WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Lead nie znaleziony" });
      }

      res.json({ ok: true, lead: result.rows[0] });
    } catch (err) {
      console.error("GET /api/admin/leads/:id error:", err);
      res.status(500).json({ error: "Błąd serwera przy pobieraniu leada" });
    }
  });

  // ================================================
  //   PATCH /api/admin/leads/:id/status
  // ================================================
  app.patch("/api/admin/leads/:id/status", requireAdmin, async (req, res) => {
    try {
      const leadId = Number(req.params.id);
      const { status } = req.body as { status?: string };

      console.log("PATCH /api/admin/leads/:id/status (ADMIN) body =", req.body);

      if (!leadId || !status) {
        return res.status(400).json({ error: "Brak ID lub statusu" });
      }

      // 🔐 DOZWOLONE STATUSY — muszą być identyczne jak w admin.html
      const ALLOWED = [
        "new",
        "in_progress",
        "qualified",
        "rejected",
        "processed"
      ];

      if (!ALLOWED.includes(status)) {
        console.warn("❌ Nieprawidłowy status leada:", status);
        return res.status(400).json({ error: "Nieprawidłowy status leada" });
      }

      // 🔄 Aktualizacja statusu w bazie
      const result = await pool.query(
        `
        UPDATE leads
        SET status = $1
        WHERE id = $2
        RETURNING id, status
      `,
        [status, leadId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Lead nie znaleziony" });
      }

      res.json({ ok: true, lead: result.rows[0] });
    } catch (err) {
      console.error("❌ PATCH /api/admin/leads/:id/status error:", err);
      res.status(500).json({ error: "Błąd serwera" });
    }
  });
  // ================================================
  //   POST /api/admin/leads/:id/convert-to-case
  //   Tworzy sprawę na podstawie leada
  // ================================================
  app.post(
    "/api/admin/leads/:id/convert-to-case",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const leadId = Number(req.params.id);
        if (!leadId) {
          return res.status(400).json({ error: "Brak ID leada" });
        }

        // 1. Pobierz leada
        const leadResult = await pool.query(
          `SELECT id, full_name, email, phone, type, source, status, meta
         FROM leads
         WHERE id = $1`,
          [leadId]
        );

        if (leadResult.rows.length === 0) {
          return res.status(404).json({ error: "Lead nie znaleziony" });
        }

        const lead = leadResult.rows[0];

        // 2. Utwórz sprawę na podstawie leada
        // Na razie minimalnie: client + status = 'nowa'
        // (kolumen 'client' na pewno mamy, bo dashboard.js go używa)
        const clientName: string = lead.full_name || "Klient z leada";

        const caseResult = await pool.query(
          `
          INSERT INTO cases (client, status)
          VALUES ($1, $2)
          RETURNING id
        `,
          [clientName, "nowa"]
        );

        const newCaseId = caseResult.rows[0].id;

        // 3. Oznacz leada jako "processed"
        await pool.query(
          `
          UPDATE leads
          SET status = 'processed'
          WHERE id = $1
        `,
          [leadId]
        );

        return res.json({
          ok: true,
          case_id: newCaseId,
          lead_id: leadId,
        });
      } catch (err) {
        console.error("POST /api/admin/leads/:id/convert-to-case ERROR:", err);
        return res
          .status(500)
          .json({ error: "Błąd serwera przy konwersji leada na sprawę" });
      }
    }
  );
  // 🔥 LISTA WSZYSTKICH SPRAW (panel admina)
  app.get(
    "/api/admin/cases",
    softApiLimit,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const q = await pool.query(
          `
          SELECT
            c.id,
            c.client,
            c.bank,
            c.loan_amount,
            c.status,
            c.created_at,
            c.updated_at,
            c.owner_id,
            u.name  AS owner_name,
            u.email AS owner_email
          FROM cases c
          LEFT JOIN users u ON u.id = c.owner_id
          ORDER BY c.id DESC
          `
        );

        return res.json({ cases: q.rows });
      } catch (err) {
        console.error("GET /api/admin/cases error:", err);
        return res
          .status(500)
          .json({ error: "Błąd serwera przy pobieraniu spraw" });
      }
    }
  );

  // === STATYSTYKI ADMINA ===
  app.get(
    "/api/admin/stats",
    softApiLimit,
    requireAdmin,
    async (_req, res) => {
      try {
        const q1 = await pool.query(`
          SELECT
            COUNT(*)::int AS total_cases,
            COUNT(*) FILTER (WHERE status IN ('nowa'))::int AS new_cases,
            COUNT(*) FILTER (WHERE status NOT IN ('zamknieta','zamknięta','archiwum'))::int AS open_cases,
            COALESCE(SUM(loan_amount), 0)::numeric AS total_loan_amount,
            COALESCE(SUM(wps), 0)::numeric AS total_wps,
            COALESCE(AVG(loan_amount), 0)::numeric AS avg_loan_amount
          FROM cases
        `);

        const stats = q1.rows[0];

        // TOP 3 banki
        const qBanks = await pool.query(`
          SELECT bank, COUNT(*)::int AS count
          FROM cases
          WHERE bank IS NOT NULL AND bank <> ''
          GROUP BY bank
          ORDER BY count DESC
          LIMIT 3
        `);

        // TOP 3 agenci
        const qAgents = await pool.query(`
          SELECT
            u.id,
            u.name,
            u.email,
            COUNT(c.*)::int AS count
          FROM users u
          LEFT JOIN cases c ON c.owner_id = u.id
          WHERE u.role = 'agent'
          GROUP BY u.id
          ORDER BY count DESC
          LIMIT 3
        `);

        // Sprawy z ostatnich 7 dni (do wykresu)
        const qLast7 = await pool.query(`
          SELECT
            to_char(created_at, 'YYYY-MM-DD') AS date,
            COUNT(*)::int AS count
          FROM cases
          WHERE created_at >= NOW() - INTERVAL '7 days'
          GROUP BY date
          ORDER BY date ASC
        `);

        return res.json({
          stats,
          topBanks: qBanks.rows,
          topAgents: qAgents.rows,
          last7: qLast7.rows,
        });
      } catch (err) {
        console.error("GET /api/admin/stats error:", err);
        return res.status(500).json({ error: "Błąd serwera statystyk admina" });
      }
    }
  );
}