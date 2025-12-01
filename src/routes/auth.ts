// src/routes/auth.ts
import { denyUnknownFields } from "./denyUnknownFields";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import type { Express, Request, Response } from "express";

import pool from "../db";

export default function authRoutes(app: Express) {
  console.log("➡️ routes: auth loaded");

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.warn("⚠️ JWT_SECRET nie jest ustawione w .env – logowanie może zwracać 500.");
  }

    // 🔐 Limiter prób logowania – anty-brute-force
  const loginLimiter =
    process.env.NODE_ENV === "production"
      ? rateLimit({
          windowMs: 10 * 60 * 1000, // 10 minut
          max: 5, // max 5 prób z jednego IP (PROD)
          message: {
            error: "Zbyt wiele prób logowania, spróbuj ponownie później.",
          },
          standardHeaders: true,
          legacyHeaders: false,
        })
      : (req: Request, _res: Response, next: Function) => {
          // DEV: limiter wyłączony, żeby nie wkurzał przy testach
          return next();
        };

  // 🔐 Limiter na /api/me (profil)
  const meLimiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 2 minuty
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // === LOGIN (JWT + httpOnly cookie) ===
app.post(
  "/api/login",
  loginLimiter,
  denyUnknownFields(["email", "password"]),
  async (req: Request, res: Response) => {
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

      // zawsze ten sam komunikat przy błędzie
      const invalid = { error: "Nieprawidłowe dane logowania" };

      if (q.rowCount === 0) {
        return res.status(401).json(invalid);
      }

      const user = q.rows[0];

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).json(invalid);
      }

      if (!JWT_SECRET) {
        console.error("🚨 Brak JWT_SECRET w .env przy logowaniu");
        return res.status(500).json({ error: "Błąd konfiguracji serwera" });
      }

      // 🔐 tworzymy JWT z id/email/name/role
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );

      // 🔐 ustawiamy httpOnly cookie z tokenem
      res.cookie("auth_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // w produkcji tylko po HTTPS
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dni
      });

      // aktualizacja last_login (opcjonalnie)
      await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [
        user.id,
      ]);

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

  // === LOGOUT (czyści cookie z JWT) ===
  app.post("/api/logout", (req: Request, res: Response) => {
    res.clearCookie("auth_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    return res.json({ ok: true });
  });

 // === AKTUALNY UŻYTKOWNIK (profil) – na bazie JWT z cookie ===
app.get("/api/me", meLimiter, async (req: Request, res: Response) => {
  try {
    const anyReq = req as any;
    const cookies = anyReq.cookies || {};
    const token = cookies.auth_token;

    if (!token) {
      return res.status(401).json({ error: "Nie zalogowano" });
    }

    if (!JWT_SECRET) {
      console.error("🚨 Brak JWT_SECRET w .env przy /api/me");
      return res
        .status(500)
        .json({ error: "Błąd konfiguracji serwera (JWT_SECRET)" });
    }

    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      console.error("GET /api/me → nieprawidłowy token:", e);
      return res.status(401).json({ error: "Nieprawidłowy token" });
    }

    const userId = payload?.id;
    if (!userId) {
      return res.status(401).json({ error: "Nieprawidłowy token (brak ID)" });
    }

    // 🔎 sprawdzamy, czy user dalej istnieje i bierzemy aktualne dane
    const q = await pool.query(
      `SELECT id, email, name, role FROM users WHERE id = $1`,
      [userId]
    );

    if (q.rowCount === 0) {
      // user usunięty / nieaktywny → traktujemy jak wylogowanego
      return res.status(401).json({ error: "Użytkownik nie istnieje" });
    }

    const user = q.rows[0];

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
    console.error("GET /api/me error:", err);
    return res.status(500).json({ error: "Błąd serwera" });
  }
});
}