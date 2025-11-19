// src/routes/admin.ts
import { Express, Request, Response } from "express";
import pool from "../db";
import bcrypt from "bcryptjs";
import { requireAdmin } from "../middleware/requireAuth";

export default function adminRoutes(app: Express) {
  console.log("➡️ routes: admin loaded");

  // LISTA UŻYTKOWNIKÓW (tylko admin)
  app.get("/api/admin/users", requireAdmin, async (_req: Request, res: Response) => {
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
  });

  // DODAWANIE UŻYTKOWNIKA (admin tworzy agenta / admina)
  app.post("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    const { email, name, role, password } = req.body || {};

    if (!email || !name || !role || !password) {
      return res.status(400).json({
        error: "email, name, role i password są wymagane",
      });
    }

    if (!["admin", "agent"].includes(role)) {
      return res.status(400).json({ error: "Nieprawidłowa rola" });
    }

    try {
      // czy email już istnieje?
      const exists = await pool.query(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );
      if (exists.rowCount > 0) {
        return res.status(409).json({ error: "Użytkownik z takim email już istnieje" });
      }

      const hash = await bcrypt.hash(password, 10);

      const q = await pool.query(
        `
        INSERT INTO users (email, name, role, password_hash, is_active)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id, email, name, role, is_active, created_at
        `,
        [email, name, role, hash]
      );

      const user = q.rows[0];

      return res.status(201).json({ user });
    } catch (err) {
      console.error("POST /api/admin/users error:", err);
      return res
        .status(500)
        .json({ error: "Błąd serwera przy tworzeniu użytkownika" });
    }
  });

  // 🔥 NOWE: LISTA WSZYSTKICH SPRAW (panel admina)
  app.get("/api/admin/cases", requireAdmin, async (_req: Request, res: Response) => {
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
  });

  // === STATYSTYKI ADMINA ===
app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
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
});
}