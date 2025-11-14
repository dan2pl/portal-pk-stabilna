import { Router } from "express";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

router.post("/login", (req, res) => {
    const email = String(req.body?.email || "");
    const password = String(req.body?.password || "");
    if (!email || !password) {
        return res.status(400).json({ error: "bad_request" });
    }

    // tu normalnie powinno być sprawdzenie hasła w bazie
    const user = { id: "1", email, role: "admin" };

    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });

    // 🔥 TU JEST CAŁA MAGIA – dodajemy ciasteczko
    res.cookie("auth_token", token, {
        httpOnly: true,
        secure: false,     // NA LOCALHOST MUSI BYĆ FALSE
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dni
    });

    return res.json({ ok: true, user });
});

export default router;
