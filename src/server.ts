import casesRouter from "./routes/cases";
import authRouter from "./routes/auth";
import path from "path";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import kpiRouter from './routes/kpi';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
console.log("Static dir:", require("path").join(__dirname, "..", "public"));

app.use("/api/auth", authRouter);
app.use("/api/cases", casesRouter);
app.use('/api', kpiRouter);

const PORT = process.env.PORT || 4000;

app.get("/api/health", (_req, res) => {
    res.json({ ok: true, message: "Server running on port " + PORT });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
const PUBLIC_DIR = path.resolve(process.cwd(), "public");
console.log("PUBLIC_DIR =", PUBLIC_DIR);

app.get("/login.html", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "login.html"))
);
app.get("/dashboard.html", (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, "dashboard.html"))
);
