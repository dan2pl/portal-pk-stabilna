import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

router.post("/login", (req, res) => {
    const email = String(req.body?.email || "");
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "bad_request" });

    const user = { id: "1", email, role: "admin" };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, user });
});

export default router;
