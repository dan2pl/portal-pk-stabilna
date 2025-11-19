// src/middleware/requireAuth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import pool from "../db";

type AnyReq = Request & {
  cookies?: Record<string, string>;
  user?: any;
};

/**
 * Middleware: wymagane zalogowanie (dowolna rola)
 * - czyta auth_token z cookies
 * - weryfikuje JWT
 * - wkłada decoded payload do req.user
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const anyReq = req as AnyReq;
  const cookies = anyReq.cookies || {};

  console.log("🔐 requireAuth → path:", req.path);
  console.log("🔐 requireAuth → cookies:", cookies);

  const token = cookies.auth_token;

  if (!token) {
    console.warn("🔐 requireAuth → brak auth_token w cookies");
    return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
  }

  try {
    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET || "sekret"
    ) as any;

    anyReq.user = payload;
    console.log("🔐 requireAuth → user:", payload);
    return next();
  } catch (e) {
    console.error("🔐 requireAuth → nieprawidłowy token:", e);
    return res.status(401).json({ error: "Nieprawidłowy token" });
  }
}

/**
 * Middleware: tylko dla administratorów
 * - korzysta z requireAuth (musi być zalogowany)
 * - dodatkowo sprawdza role === 'admin'
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const anyReq = req as AnyReq;

  // Najpierw upewniamy się, że user jest ustawiony (wywołujemy requireAuth)
  requireAuth(req, res, (err?: any) => {
    if (err) {
      // jak requireAuth już odesłał odpowiedź (401), nie idziemy dalej
      return;
    }

    const user = anyReq.user;
    if (!user) {
      console.warn("🔐 requireAdmin → brak usera po requireAuth");
      return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
    }

    if (user.role !== "admin") {
      console.warn("🔐 requireAdmin → próba wejścia bez roli admin:", user);
      return res
        .status(403)
        .json({ error: "Brak uprawnień administratora" });
    }

    console.log("🔐 requireAdmin → OK, user:", {
      id: user.id,
      email: user.email,
      role: user.role,
    });

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