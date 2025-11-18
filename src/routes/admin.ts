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
}