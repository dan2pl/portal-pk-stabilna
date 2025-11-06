// src/routes/cases.ts
import { Express } from "express";
import pool from "../db";

export default function casesRoutes(app: Express) {
    console.log("➡️ routes: cases + KPI loaded");

    // === LISTA SPRAW ===
    app.get("/api/cases", async (_req, res) => {
        try {
            const q = await pool.query(
                `SELECT id, client, loan_amount, wps, status, contract_date, bank
         FROM cases
         ORDER BY id DESC`
            );
            res.json({ items: q.rows });
        } catch (err) {
            console.error("GET /api/cases error", err);
            res.status(500).json({ error: "Server error" });
        }
    });

    // === KPI (opcjonalnie wykorzystywane przez front) ===
    app.get("/api/kpi", async (_req, res) => {
        try {
            const q = await pool.query(
                `SELECT
           COUNT(*)::int                                                   AS total_cases,
           COUNT(*) FILTER (WHERE status NOT IN ('zamknieta','zamknięta','archiwum'))::int AS open_cases,
           COUNT(*) FILTER (WHERE status IN ('nowa','analiza','w toku'))::int              AS new_cases,
           COALESCE(SUM(wps), 0)::numeric                                  AS wps_total
         FROM cases`
            );
            const r =
                q.rows[0] || { total_cases: 0, open_cases: 0, new_cases: 0, wps_total: 0 };
            res.json({
                totalCases: r.total_cases,
                openCases: r.open_cases,
                newCases: r.new_cases,
                wpsTotal: r.wps_total,
            });
        } catch (err) {
            console.error("GET /api/kpi error", err);
            res.status(500).json({ error: "Server error" });
        }
    });

    // === DODAWANIE NOWEJ SPRAWY ===
    app.post("/api/cases", async (req, res) => {
        try {
            const { client, loan_amount, status, bank } = req.body || {};

            if (!client || typeof loan_amount !== "number") {
                return res
                    .status(400)
                    .json({ error: "client i loan_amount są wymagane" });
            }

            const normStatus = (status || "nowa").toString();

            const sql = `
        INSERT INTO cases (client, loan_amount, status, bank)
        VALUES ($1, $2, $3, $4)
        RETURNING id, client, loan_amount, wps, status, contract_date, bank;
      `;
            const params = [client, loan_amount, normStatus, bank ?? null];

            const { rows } = await pool.query(sql, params);
            return res.json(rows[0]);
        } catch (e: any) {
            console.error("POST /api/cases error:", e);
            return res
                .status(500)
                .json({ error: "DB error", detail: e.message || String(e) });
        }
    });

    // === SZCZEGÓŁY JEDNEJ SPRAWY ===
    app.get("/api/cases/:id", async (req, res) => {
        const { id } = req.params;
        try {
            const q = await pool.query(
                `SELECT id, client, loan_amount, wps, status, contract_date, bank
         FROM cases
         WHERE id = $1`,
                [id]
            );
            if (!q.rows.length) return res.status(404).json({ error: "Case not found" });
            res.json(q.rows[0]);
        } catch (err) {
            console.error("GET /api/cases/:id error", err);
            res.status(500).json({ error: "Server error" });
        }
    });

    // === AKTUALIZACJA (WPS / STATUS / KWOTA / DATA / BANK) ===
    app.patch("/api/cases/:id", async (req, res) => {
        const { id } = req.params;
        let { wps, status, loan_amount, contract_date, bank } = req.body || {};

        const toNum = (v: any) => {
            if (v === undefined || v === null) return undefined;
            const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
            if (s === "") return undefined;
            const n = Number(s);
            return Number.isFinite(n) ? n : undefined;
        };
        const toStr = (v: any) => {
            if (v === undefined || v === null) return undefined;
            const s = String(v).trim();
            return s === "" ? undefined : s;
        };
        const toISODate = (v: any) => {
            const s = toStr(v);
            if (s === undefined) return undefined;
            return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
        };

        const updates: string[] = [];
        const values: any[] = [];
        let i = 1;

        const wpsVal = toNum(wps);
        if (wpsVal !== undefined) { updates.push(`wps = $${i++}`); values.push(wpsVal); }

        const statusVal = toStr(status);
        if (statusVal !== undefined) { updates.push(`status = $${i++}`); values.push(statusVal); }

        const amountVal = toNum(loan_amount);
        if (amountVal !== undefined) { updates.push(`loan_amount = $${i++}`); values.push(amountVal); }

        const dateVal = toISODate(contract_date);
        if (dateVal !== undefined) { updates.push(`contract_date = $${i++}`); values.push(dateVal); }

        const bankVal = toStr(bank);
        if (bankVal !== undefined) { updates.push(`bank = $${i++}`); values.push(bankVal); }

        if (updates.length === 0) return res.json({ ok: true, note: "no fields to update" });

        const sql = `UPDATE cases SET ${updates.join(", ")} WHERE id = $${i}`;
        values.push(id);

        try {
            await pool.query(sql, values);
            res.json({ ok: true });
        } catch (err) {
            console.error("PATCH /api/cases/:id error", err);
            res.status(500).json({ error: "Server error" });
        }
    });

    console.log("➡️ routes: GET/POST/PATCH /api/cases registered");
}
