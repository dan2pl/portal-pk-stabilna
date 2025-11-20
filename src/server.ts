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
    // 🔒 CSP – pozwalamy na skrypty tylko z naszej domeny + inline
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
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
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
        cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // 🔒 w produkcji tylko po HTTPS
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
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
