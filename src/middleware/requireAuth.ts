// src/middleware/requireAuth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

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