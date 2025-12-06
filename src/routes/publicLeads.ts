import type { Express, Request, Response } from "express";
import pool from "../db";

export default function publicLeadsRoutes(app: Express) {
    console.log("➡️ routes: publicLeads loaded");

    // Minimalistyczne zabezpieczenie API
    const API_KEY = process.env.PUBLIC_API_KEY;

    app.post("/api/public/leads", async (req: Request, res: Response) => {
        try {
            // 1. Sprawdzamy API key
            const headerKey = req.headers["x-api-key"];
            if (!headerKey || headerKey !== API_KEY) {
                return res.status(401).json({ ok: false, error: "Invalid API key" });
            }

            const { type, source, full_name, email, phone, meta } = req.body;

            // 2. Walidacja minimalnych danych
            if (!type || !source || !full_name) {
                return res.status(400).json({ ok: false, error: "Missing required fields" });
            }

            // 3. Zapis do bazy
            const result = await pool.query(
                `
        INSERT INTO leads (type, source, full_name, email, phone, meta)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        `,
                [type, source, full_name, email || null, phone || null, meta || {}]
            );

            const leadId = result.rows[0].id;

            console.log(`📥 NEW PUBLIC LEAD: #${leadId} (${type}) from ${source}`);

            return res.json({ ok: true, lead_id: leadId });
        } catch (err) {
            console.error("❌ PUBLIC LEAD ERROR:", err);
            return res.status(500).json({ ok: false, error: "Server error" });
        }
    });
}