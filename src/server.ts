import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
const PgSession = require("connect-pg-simple")(session);

import adminRoutes from "./routes/admin";
import pool from "./db";
import authRoutes from "./routes/auth";
import casesRoutes from "./routes/cases";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// --- MIDDLEWARES ---
app.use(
  cors({
    origin: "http://localhost:4000",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// statyczne pliki
app.use(express.static(path.join(__dirname, "..", "public")));

// --- ROUTES ---
authRoutes(app);
casesRoutes(app);
adminRoutes(app);

app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});