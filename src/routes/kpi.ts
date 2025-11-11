import { Router } from 'express';
import { pool } from '../db/pool';

const router = Router();

router.get('/kpi', async (_req, res) => {
    try {
        const client = await pool.connect();
        try {
            // Jedno zapytanie z agregatami; BEZ created_at (ustawimy 0 na start)
            const sql = `
        SELECT
          COUNT(*)::int AS all,
          COUNT(*) FILTER (
            WHERE lower(coalesce(status, '')) IN ('nowa','w toku','open','in_progress')
          )::int AS open,
          COUNT(*) FILTER (
            WHERE lower(coalesce(status, '')) IN ('sukces','success','wygrana','won')
          )::int AS success,
          COUNT(*) FILTER (
            WHERE lower(coalesce(status, '')) IN ('przegrana','lost')
          )::int AS lost
        FROM cases;
      `;
            const r = await client.query(sql);

            const row = r.rows[0] || { all: 0, open: 0, success: 0, lost: 0 };
            res.json({
                all: row.all ?? 0,
                open: row.open ?? 0,
                success: row.success ?? 0,
                lost: row.lost ?? 0,
                thisMonth: 0, // tymczasowo; dołączymy po potwierdzeniu kolumny created_at
            });
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error('KPI error:', err?.message, err?.stack);
        res.status(500).json({ error: 'KPI_FAILED', detail: String(err?.message || err) });
    }
});

export default router;
