// src/server.ts
import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import pool from './db';

// --- import tras ---
import casesRoutes from './routes/cases';

dotenv.config();
const app = express();

// --- middlewares ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- middleware JWT: chronimy wyłącznie /api/* poza /api/login ---
app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next(); // /api/login bez tokena

    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'Brak tokena' });

    try {
        const token = auth.split(' ')[1];
        const payload = jwt.verify(token, process.env.JWT_SECRET || 'sekret') as {
            id: number;
            email: string;
        };
        // @ts-ignore
        req.user = payload;
        next();
    } catch {
        return res.status(401).json({ error: 'Nieprawidłowy token' });
    }
});


// --- trasy główne ---
casesRoutes(app);

// --- login testowy ---
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (email === 'admin@pk.pl' && password === '1234') {
        const token = jwt.sign({ id: 1, email }, process.env.JWT_SECRET || 'sekret');
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Błędne dane logowania' });
    }
});

// --- start serwera ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
});
