// src/server.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import pool from './db';

// --- routes ---
import casesRoutes from './routes/cases';

dotenv.config();
const app = express();

// --- middlewares ---
app.use(cors({
    origin: "http://localhost:4000",
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// statyczne pliki
app.use(express.static(path.join(__dirname, '../public')));

// === AUTH MIDDLEWARE — czytamy token z cookies ===
app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next();

    const token = req.cookies.auth_token;
    if (!token) {
        return res.status(401).json({ error: "Brak tokena w cookie" });
    }

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'sekret') as any;
        (req as any).user = payload;
        next();
    } catch (e) {
        return res.status(401).json({ error: "Nieprawidłowy token" });
    }
});

// === ROUTES ===
casesRoutes(app);

// === LOGIN — ustawia cookie ===
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    // testowy login
    if (email === 'admin@pk.pl' && password === '1234') {
        const token = jwt.sign({ id: 1, email }, process.env.JWT_SECRET || 'sekret', {
            expiresIn: "7d"
        });

        // 🔥 ustawiamy COOKIE zamiast token w JSON
        res.cookie("auth_token", token, {
            httpOnly: true,
            secure: false,      // localhost → false
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dni
        });

        return res.json({ ok: true });
    } else {
        return res.status(401).json({ error: 'Błędne dane logowania' });
    }
});

// === START ===
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
});
