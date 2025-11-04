import { Router } from "express";
import { pool } from "../db/pool";

const router = Router();

// GET /api/cases
// GET /api/cases
router.get("/", async (_req, res) => {
    try {
        const { rows } = await pool.query(
            "SELECT id, client, loan_amount, status, wps, created_at FROM cases ORDER BY id DESC"
        );

        // 🔎 DIAGNOSTYKA: pokaż w konsoli jakie kolumny naprawdę zwracamy
        if (rows.length) {
            const cols = Object.keys(rows[0]);
            console.log("GET /api/cases → columns:", cols);
            console.log("GET /api/cases → first row:", rows[0]);
        } else {
            console.log("GET /api/cases → no rows");
        }

        res.json({ items: rows });
    } catch (e: any) {
        console.error("DB error:", e.message);
        res.status(500).json({ error: "server_error", message: e.message });
    }
});


router.post("/", async (req, res) => {
    console.log("POST /api/cases", req.body);

    try {
        const client = String(req.body?.client || "").trim();
        const loan_amount = Number(req.body?.loan_amount || 0);
        const status = String(req.body?.status || "nowa");

        if (!client || isNaN(loan_amount) || loan_amount < 0) {
            return res.status(400).json({ error: "bad_request" });
        }

        const { rows } = await pool.query(
            `INSERT INTO cases (client, loan_amount, status)
       VALUES ($1, $2, $3)
       RETURNING id, client, loan_amount, status, created_at`,
            [client, loan_amount, status]
        );
        res.status(201).json(rows[0]);
    } catch (e: any) {
        console.error("CREATE CASE ERROR:", e.message);
        res.status(500).json({ error: "server_error", message: e.message });
    }
});

// PATCH /api/cases/:id — aktualizacja WPS / status
router.patch('/:id', async (req, res) => {
    const { id } = req.params;
    const { wps, status } = req.body; // oba opcjonalne

    const set: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (wps !== undefined) { set.push(`wps = $${i++}`); vals.push(wps === '' ? null : Number(wps)); }
    if (status !== undefined) { set.push(`status = $${i++}`); vals.push(String(status)); }

    if (!set.length) return res.status(400).json({ error: 'NO_FIELDS' });

    vals.push(id);
    const sql = `UPDATE cases SET ${set.join(', ')} WHERE id = $${i} RETURNING id`;
    try {
        const r = await pool.query(sql, vals);
        if (!r.rowCount) return res.status(404).json({ error: 'NOT_FOUND' });
        res.json({ ok: true, id });
    } catch (e: any) {
        console.error('PATCH /cases/:id error', e.message);
        res.status(500).json({ error: 'UPDATE_FAILED' });
    }
});

// GET /api/cases/:id — szczegóły sprawy
router.get("/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const { rows } = await pool.query(
            "SELECT id, client, loan_amount, status, wps, created_at FROM cases WHERE id = $1",
            [id]
        );
        if (!rows.length) return res.status(404).json({ error: "NOT_FOUND" });
        res.json(rows[0]);
    } catch (e: any) {
        console.error("GET /cases/:id error:", e.message);
        res.status(500).json({ error: "DETAILS_FAILED" });
    }
});

export default router;
