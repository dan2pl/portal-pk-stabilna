// src/middleware/requireAuth.ts
import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sess = req.session as any;

  if (!sess?.userId) {
    return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
  }

  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const sess = req.session as any;

  if (!sess?.userId) {
    return res.status(401).json({ error: "Brak dostępu – zaloguj się" });
  }

  if (sess.userRole !== "admin") {
    return res.status(403).json({ error: "Brak uprawnień (admin only)" });
  }

  next();
}