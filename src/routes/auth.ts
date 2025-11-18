// src/routes/auth.ts
import { Express, Request, Response } from "express";
import pool from "../db";
import bcrypt from "bcryptjs";

export default function authRoutes(app: Express) {
  console.log("➡️ routes: auth loaded");

  // POST /api/login
  app.post("/api/login", async (req: Request, res: Response) => {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email i hasło są wymagane" });
    }

    try {
      const q = await pool.query(
        `
        SELECT id, email, name, role, password_hash, is_active
        FROM users
        WHERE email = $1
        `,
        [email]
      );

      if (q.rowCount === 0) {
        return res.status(401).json({ error: "Nieprawidłowe dane logowania" });
      }

      const user = q.rows[0];

      if (user.is_active === false) {
        return res.status(403).json({ error: "Konto jest zablokowane" });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ error: "Nieprawidłowe dane logowania" });
      }

      // ✅ zapis do sesji
      (req.session as any).userId = user.id;
      (req.session as any).userRole = user.role;
      (req.session as any).userName = user.name;

      // ✅ aktualizacja last_login
      await pool.query(
        "UPDATE users SET last_login = NOW() WHERE id = $1",
        [user.id]
      );

      return res.json({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      console.error("POST /api/login error:", err);
      return res.status(500).json({ error: "Błąd serwera przy logowaniu" });
    }
  });


  // POST /api/logout
  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("logout destroy error:", err);
        return res.status(500).json({ error: "Błąd przy wylogowaniu" });
      }
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  });

  // GET /api/me – info o aktualnym userze
  app.get("/api/me", async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) {
      return res.status(401).json({ error: "Nie zalogowano" });
    }

    try {
      const q = await pool.query(
        `
        SELECT id, email, name, role, created_at, last_login
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      if (q.rowCount === 0) {
        return res.status(404).json({ error: "Użytkownik nie istnieje" });
      }

      const user = q.rows[0];
      return res.json({ ok: true, user });
    } catch (err) {
      console.error("GET /api/me error:", err);
      return res.status(500).json({ error: "Błąd serwera" });
    }
  });
}