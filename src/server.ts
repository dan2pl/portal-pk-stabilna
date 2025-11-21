import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";
import helmet from "helmet";

const PgSession = require("connect-pg-simple")(session);

import adminRoutes from "./routes/admin";
import pool from "./db";
import authRoutes from "./routes/auth";
import casesRoutes from "./routes/cases";

dotenv.config();

// ==========================================
//   GLOBAL MIDDLEWARE — sanitizeBody
// ==========================================
function sanitizeBody(req, res, next) {
  try {
    if (req.body && typeof req.body === "object") {
      for (const key of Object.keys(req.body)) {
        let val = req.body[key];

        if (typeof val === "string") {
          val = val
            .replace(/\uFEFF/g, "") // BOM
            .replace(/\0/g, "")     // null byte
            .trim();
        }

        req.body[key] = val;
      }
    }
  } catch (e) {
    console.warn("sanitizeBody error:", e);
  }

  next();
}

const app = express();
const PORT = process.env.PORT || 4000;

// ==========================================
//   BEZPIECZEŃSTWO (CSP + XSS + HEADERS)
// ==========================================

app.use(
  helmet({
    hidePoweredBy: true,
    noSniff: true,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    xssFilter: true,

    // 🔥 tymczasowo wyłączamy CSP,
    // żeby UI (zakładki, modale, accordion, inline scripts)
    // działał poprawnie
    contentSecurityPolicy: false,
  })
);
// Blokada dostępu do uploads
app.use("/uploads", (req, res) => {
  return res.status(403).json({ error: "Brak dostępu" });
});

// statyczne pliki (PRAWIDŁOWE MIEJSCE!)
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    index: false,
    etag: true,
    lastModified: true,
    immutable: false,
    cacheControl: true,
    fallthrough: true,
  })
);

// ==========================================
//   PODSTAWOWE MIDDLEWARE
// ==========================================
app.use(
  cors({
    origin: "http://localhost:4000",
    credentials: true,
  })
);

app.use(express.json());
app.use(sanitizeBody);
app.use(cookieParser());

// ==========================================
//   SESJE
// ==========================================
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
    }),

    // 🔑 tajny klucz z .env (SESSION_SECRET=...)
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",

    // 🥠 nazwa ciasteczka sesji
    name: "pk.sid",

    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,                            // JS w przeglądarce nie widzi ciasteczka
      secure: process.env.NODE_ENV === "production", // w prod tylko po HTTPS
      sameSite: "lax",                           // sensowny balans bezpieczeństwo/używalność
      maxAge: 1000 * 60 * 60 * 8,                // 8h
      path: "/",                                 // cookie ważne dla całej domeny
    },
  })
);
// === GLOBAL: blokuje nieznane pola w req.body ===
function denyUnknownFields(allowedKeys: string[]) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== "object") return next();

    const bad = Object.keys(req.body).filter(k => !allowedKeys.includes(k));

    if (bad.length > 0) {
      return res.status(400).json({
        error: "Niedozwolone pola w żądaniu",
        fields: bad
      });
    }
    next();
  };
}

// ==========================================
//   ROUTES (POPRAWNE MIEJSCE!)
// ==========================================
authRoutes(app);
casesRoutes(app);
adminRoutes(app);

// ==========================================
//   404 — musi być NA KOŃCU
// ==========================================
app.all("*", (req, res) => {
  res.status(404).json({ error: "Endpoint nie istnieje" });
});

// ==========================================
//   GLOBAL ERROR HANDLER (TEŻ NA KOŃCU)
// ==========================================
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  return res.status(500).json({
    error: "Internal server error",
    message:
      process.env.NODE_ENV === "development"
        ? String(err)
        : "Unexpected server error",
  });
});

// ==========================================
app.listen(PORT, () => {
  console.log(`✅ Server listening on http://localhost:${PORT}`);
});
