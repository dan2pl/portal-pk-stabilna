// src/middleware/requireAuth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db";

type AnyReq = Request & {
  cookies?: Record<string, string>;
  user?: any;
};

// Trzymamy sekret w zmiennej – spójnie z auth.ts
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Middleware: wymagane zalogowanie (dowolna rola)
 * - czyta auth_token z cookies
 * - weryfikuje JWT
 * - wkłada bezpieczny payload do req.user
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const anyReq = req as AnyReq;
  const cookies = anyReq.cookies || {};

  // W DEV można zostawić log ścieżki
  if (process.env.NODE_ENV !== "production") {
    console.log("🔐 requireAuth → path:", req.path);
  }

  const token = cookies.auth_token;

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("🔐 requireAuth → brak auth_token w cookies");
    }
    return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
  }

  if (!JWT_SECRET) {
    console.error("🚨 JWT_SECRET nie jest ustawione w .env (requireAuth)");
    return res
      .status(500)
      .json({ error: "Błąd konfiguracji serwera (JWT_SECRET)" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;

    // Hardening: wyciągamy tylko pola, które nas interesują
    anyReq.user = {
      id: payload.id ?? null,
      email: payload.email ?? null,
      name: payload.name ?? null,
      role: payload.role ?? null,
    };

    if (process.env.NODE_ENV !== "production") {
      console.log("🔐 requireAuth → user:", {
        id: anyReq.user.id,
        email: anyReq.user.email,
        role: anyReq.user.role,
      });
    }

    return next();
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.error("🔐 requireAuth → nieprawidłowy token:", e);
    }
    return res.status(401).json({ error: "Nieprawidłowy token" });
  }
}

/**
 * Middleware: tylko dla administratorów
 * - najpierw odpala requireAuth (musi być zalogowany)
 * - potem sprawdza role === 'admin'
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const anyReq = req as AnyReq;

  // Najpierw weryfikujemy JWT
  requireAuth(req, res, () => {
    const user = anyReq.user;

    if (!user) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("🔐 requireAdmin → brak usera po requireAuth");
      }
      return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
    }

    if (user.role !== "admin") {
      if (process.env.NODE_ENV !== "production") {
        console.warn("🔐 requireAdmin → próba wejścia bez roli admin:", {
          id: user.id,
          email: user.email,
          role: user.role,
        });
      }
      return res
        .status(403)
        .json({ error: "Brak uprawnień administratora" });
    }

    if (process.env.NODE_ENV !== "production") {
      console.log("🔐 requireAdmin → OK, user:", {
        id: user.id,
        email: user.email,
        role: user.role,
      });
    }

    return next();
  });
}
export function requireOwnerOrAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = (req as any).user;
      const caseId = Number(req.params.id);

      if (!user) {
        return res.status(401).json({ error: "Brak dostępu" });
      }

      if (user.role === "admin") {
        return next(); // admin może wszystko
      }

      if (!Number.isFinite(caseId)) {
        return res.status(400).json({ error: "Nieprawidłowe ID sprawy" });
      }

      const q = await pool.query(
        "SELECT owner_id FROM cases WHERE id = $1",
        [caseId]
      );

      if (q.rowCount === 0) {
        return res.status(404).json({ error: "Sprawa nie istnieje" });
      }

      const ownerId = q.rows[0].owner_id;
      if (ownerId !== user.id) {
        return res.status(403).json({ error: "Brak dostępu do tej sprawy" });
      }

      return next();
    } catch (err) {
      console.error("Auth error:", err);
      return res.status(500).json({ error: "Błąd autoryzacji" });
    }
  };
}