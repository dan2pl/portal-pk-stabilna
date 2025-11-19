// src/routes/auth.ts
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Express, Request, Response } from "express";
import pool from "../db";

// ...

export default function authRoutes(app: Express) {
  console.log("➡️ routes: auth loaded");

  // === LOGIN ===
  app.post("/api/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: "Podaj email i hasło" });
      }

      // szukamy usera w bazie
      const q = await pool.query(
        `
        SELECT id, email, name, role, password_hash
        FROM users
        WHERE email = $1
        `,
        [email]
      );

      if (q.rowCount === 0) {
        return res.status(401).json({ error: "Nieprawidłowe dane logowania" });
      }

      const user = q.rows[0];

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json({ error: "Nieprawidłowe dane logowania" });
      }

      // 🔐 tworzymy JWT z id/email/name/role
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        process.env.JWT_SECRET || "sekret",
        {
          expiresIn: "7d",
        }
      );

      // 🔐 ustawiamy httpOnly cookie z tokenem
      res.cookie("auth_token", token, {
        httpOnly: true,
        secure: false, // przy HTTPS zmienisz na true
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dni
      });

      // aktualizacja last_login (opcjonalnie)
      await pool.query(
        "UPDATE users SET last_login = NOW() WHERE id = $1",
        [user.id]
      );

      // odsyłamy dane usera (bez hasła)
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

  // === AKTUALNY UŻYTKOWNIK (profil) – na bazie JWT z cookie ===
app.get("/api/me", async (req, res) => {
  try {
    const anyReq = req as any;
    const cookies = anyReq.cookies || {};
    const token = cookies.auth_token;

    if (!token) {
      return res.status(401).json({ error: "Nie zalogowano" });
    }

    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || "sekret");
    } catch (e) {
      console.error("GET /api/me → nieprawidłowy token:", e);
      return res.status(401).json({ error: "Nieprawidłowy token" });
    }

    const user = payload || {};

    return res.json({
      ok: true,
      user: {
        id: user.id ?? null,
        email: user.email ?? null,
        name: user.name ?? null,
        role: user.role ?? null,
      },
    });
  } catch (err) {
    console.error("GET /api/me error:", err);
    return res.status(500).json({ error: "Błąd serwera" });
  }
});
}