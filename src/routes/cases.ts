import { Router } from "express";
import { pool } from "../db/pool";

const router = Router();

router.get("/", async (_req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT id, client, loan_amount, status, created_at
       FROM cases
       ORDER BY created_at DESC`
        );
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

export default router;
