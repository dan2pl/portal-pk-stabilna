// src/routes/cases.ts
import { Express } from 'express';
import pool from '../db'; // dopasuj, jeśli masz /db/db

export default function casesRoutes(app: Express) {
    console.log('➡️ routes: cases + KPI loaded');

    // === Lista spraw ===
    app.get('/api/cases', async (_req, res) => {
        try {
            const q = await pool.query(`
        SELECT id, client, loan_amount, wps, status, contract_date
        FROM cases
        ORDER BY id DESC
      `);
            res.json({ items: q.rows });
        } catch (err) {
            console.error('GET /api/cases error', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // === KPI dla dashboardu ===
    app.get('/api/kpi', async (_req, res) => {
        try {
            const q = await pool.query(`
        SELECT
          COUNT(*)::int AS total_cases,
          COUNT(*) FILTER (WHERE status NOT IN ('zamknieta','zamknięta','archiwum'))::int AS open_cases,
          COUNT(*) FILTER (WHERE status IN ('nowa','analiza','w toku'))::int AS new_cases,
          COALESCE(SUM(wps), 0)::numeric AS wps_total
        FROM cases
      `);

            const r = q.rows[0] || { total_cases: 0, open_cases: 0, new_cases: 0, wps_total: 0 };
            res.json({
                totalCases: r.total_cases,
                openCases: r.open_cases,
                newCases: r.new_cases,
                wpsTotal: r.wps_total,
            });
        } catch (err) {
            console.error('GET /api/kpi error', err);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // === Szczegóły jednej sprawy ===
    app.get('/api/cases/:id', async (req, res) => {
        const { id } = req.params;
        try {
            const q = await pool.query(`
        SELECT id, client, loan_amount, wps, status, contract_date
        FROM cases
        WHERE id = $1
      `, [id]);
            if (!q.rows.length) return res.status(404).json({ error: 'Case not found' });
            res.json(q.rows[0]);
        } catch (err) {
            console.error('GET /api/cases/:id error', err);
            res.status(500).json({ error: 'Server error' });
        }
    });
    console.log('➡️ routes: PATCH /api/cases/:id registered');

    // === Aktualizacja sprawy (WPS / status / kwota / data) — bez updated_at ===
    app.patch('/api/cases/:id', async (req, res) => {
        const { id } = req.params;
        let { wps, status, loan_amount, contract_date } = req.body || {};

        const toNum = (v: any) => {
            if (v === undefined || v === null) return undefined;
            const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
            if (s === '') return undefined;
            const n = Number(s);
            return Number.isFinite(n) ? n : undefined;
        };
        const toStr = (v: any) => {
            if (v === undefined || v === null) return undefined;
            const s = String(v).trim();
            return s === '' ? undefined : s;
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

        if (updates.length === 0) return res.json({ ok: true, note: 'no fields to update' });

        const sql = `UPDATE cases SET ${updates.join(', ')} WHERE id = $${i}`;
        values.push(id);

        try {
            await pool.query(sql, values);
            res.json({ ok: true });
        } catch (err) {
            console.error('PATCH /api/cases/:id error', err);
            res.status(500).json({ error: 'Server error' });
        }
    });


    // (opcjonalnie) PATCH /api/cases/:id do zapisu zmian
}
