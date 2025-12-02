// src/routes/notifications.ts
import type { Express, Request, Response } from "express";
import pool from "../db";
import { requireAuth } from "../middleware/requireAuth";

export default function notificationsRoutes(app: Express) {
  console.log("➡️ routes: notifications loaded");

  // Pobieranie powiadomień użytkownika
  app.get("/api/notifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;

      const onlyUnread = req.query.onlyUnread === "1";

      const result = await pool.query(
        `
        SELECT id, case_id, type, title, body, meta, is_read, created_at, read_at
        FROM notifications
        WHERE user_id = $1
          ${onlyUnread ? "AND is_read = false" : ""}
        ORDER BY created_at DESC
        LIMIT 50
        `,
        [userId]
      );

      res.json({ ok: true, items: result.rows });
    } catch (err) {
      console.error("[notifications] GET error", err);
      res.status(500).json({ ok: false, error: "Błąd pobierania powiadomień" });
    }
  });

  // Oznaczanie jako przeczytane
  app.post("/api/notifications/read", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user.id;
      const { ids } = req.body;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ ok: false, error: "Brak ID powiadomień" });
      }

      await pool.query(
        `
        UPDATE notifications
        SET is_read = true,
            read_at = NOW()
        WHERE user_id = $1
          AND id = ANY($2::int[])
        `,
        [userId, ids]
      );

      res.json({ ok: true });
    } catch (err) {
      console.error("[notifications] READ error", err);
      res.status(500).json({ ok: false, error: "Błąd oznaczania jako przeczytane" });
    }
  });
}