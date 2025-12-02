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
import notificationsRoutes from "./routes/notifications";

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

const isProd = process.env.NODE_ENV === "production";
// Adres frontu (prod/dev) – dla CORS
const FRONTEND_URL = isProd
  ? process.env.FRONTEND_URL || "https://portal.pokonajkredyt.pl"
  : "http://localhost:4000";

app.use(
  helmet({
    hidePoweredBy: true,
    noSniff: true,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    // xssFilter w nowszych wersjach jest deprecated, ale zostawiamy dla kompatybilności
    xssFilter: true,

    // ✅ CSP: w DEV wyłączone, w PROD – włączone z rozsądnymi ustawieniami
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
  })
);
// Blokada dostępu do uploads
app.use("/uploads", (req, res) => {
  return res.status(403).json({ error: "Brak dostępu" });
});

// ==========================================
//   STATIC FILES — produkcyjnie bezpieczne
// ==========================================

const publicPath = path.join(__dirname, "..", "public");

app.use((req, res, next) => {
  // ⛔ Twardy bezpiecznik: blokuje ../ oraz próby wyjścia z katalogu public
  const resolved = path.resolve(publicPath, "." + req.path);

  if (!resolved.startsWith(publicPath)) {
    console.warn("⚠️ Blokada próby wyjścia poza public/:", req.path);
    return res.status(403).send("Forbidden");
  }
  next();
});

// Serwowanie plików statycznych
app.use(
  express.static(publicPath, {
    index: false,
    etag: true,
    lastModified: true,
    fallthrough: true,
    cacheControl: true,
    maxAge: "12h", // 🔥 CSS/JS będą cacheowane
    setHeaders: (res, filePath) => {
      // 🔐 Bezpieczne nagłówki dla statycznych plików
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

      // HTML NIE może być cacheowany (np. dashboard.html)
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// ==========================================
//   PODSTAWOWE MIDDLEWARE
// ==========================================
app.use(
  cors({
    origin(origin, callback) {
      const allowed = [
        FRONTEND_URL,
        "http://localhost:4000", // zostawiamy DEV na sztywno, żeby nie zwariować :)
      ];

      // Brak origin (np. Postman, curl) → OK
      if (!origin) return callback(null, true);

      if (allowed.includes(origin)) {
        return callback(null, true);
      }

      console.warn("🚫 CORS blocked:", origin);
      return callback(new Error("CORS blocked: " + origin), false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(sanitizeBody);
app.use(cookieParser());

if (isProd) {
  app.set("trust proxy", 1);
}
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
  httpOnly: true,
  secure: isProd,
  sameSite: "lax",
  maxAge: 1000 * 60 * 60 * 8,
  path: "/",
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
notificationsRoutes(app);
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
