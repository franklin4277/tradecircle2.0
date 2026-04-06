require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const User = require("./models/user");
const authRoutes = require("./routes/auth");
const listingRoutes = require("./routes/listings");
const escrowRoutes = require("./routes/escrow");
const adminRoutes = require("./routes/admin");
const notificationRoutes = require("./routes/notifications");
const { createRateLimiter } = require("./middleware/rateLimit");
const { sanitizeRequest } = require("./middleware/sanitize");
const { resolveUploadsDir } = require("./config/storage");
const { startEscrowSlaWorker } = require("./services/escrowSla");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const publicDir = path.join(__dirname, "public");
const uploadsDir = resolveUploadsDir();

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const corsOrigin = process.env.CORS_ORIGIN;
const nodeEnv = String(process.env.NODE_ENV || "development").trim().toLowerCase();

function normalizeOrigin(originValue) {
    const value = String(originValue || "").trim();
    if (!value) {
        throw new Error("Origin is empty.");
    }

    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`Origin is not a valid URL: ${value}`);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`Origin must use http/https: ${value}`);
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        throw new Error(
            `Origin must not include path/query/hash: ${value}. Example: https://example.com`
        );
    }

    return parsed.origin;
}

function parseAllowedOrigins(originConfig) {
    const fallbackOrigins = ["http://localhost:5000", "http://127.0.0.1:5000"];
    if (!originConfig) {
        if (nodeEnv === "production") {
            throw new Error("CORS_ORIGIN is required in production.");
        }
        return fallbackOrigins.map((origin) => normalizeOrigin(origin));
    }

    const origins = originConfig
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (origins.length === 0) {
        throw new Error("CORS_ORIGIN is empty. Provide comma-separated allowed origins.");
    }

    const invalidOrigins = [];
    const normalizedOrigins = [];
    for (const origin of origins) {
        try {
            normalizedOrigins.push(normalizeOrigin(origin));
        } catch {
            invalidOrigins.push(origin);
        }
    }

    if (invalidOrigins.length > 0) {
        throw new Error(`Invalid CORS origin(s): ${invalidOrigins.join(", ")}`);
    }

    return Array.from(new Set(normalizedOrigins));
}

const allowedOrigins = parseAllowedOrigins(corsOrigin);
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error("CORS policy blocked this origin."));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
};

app.use(cors(corsOptions));
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" }
    })
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitizeRequest);

app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    return next();
});

const apiLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 250,
    message: "Too many requests from this IP. Please try again in a few minutes."
});

const authLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many authentication attempts. Please wait and try again.",
    keyGenerator: (req) => {
        const forwardedFor = String(req.headers["x-forwarded-for"] || "")
            .split(",")[0]
            .trim();
        const ip = forwardedFor || req.ip || "unknown";
        const email = String((req.body && req.body.email) || "")
            .trim()
            .toLowerCase();
        return email ? `${ip}:${email}` : ip;
    }
});

const refreshLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 180,
    message: "Too many session refresh requests. Please try again shortly."
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);
app.use("/api/auth/reset-password", authLimiter);
app.use("/api/auth/refresh", refreshLimiter);

app.use("/uploads", express.static(uploadsDir));
app.use(express.static(publicDir));

app.get("/health", (_, res) => {
    return res.json({
        status: "ok",
        service: "TradeCircle API",
        db: dbReady ? "connected" : "disconnected"
    });
});

app.use("/api/auth", authRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/escrow", escrowRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/", (_, res) => {
    return res.sendFile(path.join(publicDir, "index.html"));
});

app.use((req, res) => {
    if (req.path.startsWith("/api")) {
        return res.status(404).json({ message: "API route not found." });
    }

    return res.status(404).sendFile(path.join(publicDir, "index.html"));
});

app.use((error, req, res, next) => {
    if (error && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "Image too large. Maximum file size is 5MB." });
    }

    if (error && String(error.message || "").includes("Only image files are allowed")) {
        return res.status(400).json({ message: "Only image files are allowed." });
    }

    if (error && error.name === "ValidationError") {
        return res.status(400).json({ message: error.message });
    }

    // eslint-disable-next-line no-console
    console.error(error);
    return res.status(500).json({ message: "Something went wrong on the server." });
});

async function ensureAdminUser() {
    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const adminPassword = String(process.env.ADMIN_PASSWORD || "");
    const adminName = String(process.env.ADMIN_NAME || "TradeCircle Admin").trim();

    if (!adminEmail || !adminPassword) {
        return;
    }

    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
        let shouldSave = false;
        if (existingAdmin.role !== "admin") {
            existingAdmin.role = "admin";
            shouldSave = true;
        }
        if (!existingAdmin.communityVerified) {
            existingAdmin.communityVerified = true;
            shouldSave = true;
        }
        if (shouldSave) {
            await existingAdmin.save();
        }
        return;
    }

    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    await User.create({
        name: adminName,
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
        communityVerified: true,
        reputationScore: 200
    });
}

let dbReady = false;

async function connectWithRetry(mongoUri, options = {}) {
    const {
        initialDelayMs = 1000,
        maxDelayMs = 30000,
        maxAttempts = Number(process.env.MONGO_CONNECT_ATTEMPTS || 0)
    } = options;

    let attempt = 0;
    let delay = initialDelayMs;

    while (maxAttempts === 0 || attempt < maxAttempts) {
        attempt += 1;
        try {
            await mongoose.connect(mongoUri);
            dbReady = true;
            await ensureAdminUser();
            startEscrowSlaWorker();
            // eslint-disable-next-line no-console
            console.log("MongoDB connection established.");
            return;
        } catch (error) {
            dbReady = false;
            // eslint-disable-next-line no-console
            console.error(
                `MongoDB connection failed (attempt ${attempt}). Retrying in ${Math.round(
                    delay / 1000
                )}s...`,
                error && error.message ? error.message : error
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay = Math.min(maxDelayMs, Math.round(delay * 1.6));
        }
    }

    // eslint-disable-next-line no-console
    console.error("MongoDB connection failed after max attempts.");
}

async function startServer() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    const jwtSecret = String(process.env.JWT_SECRET || "");
    if (!mongoUri) {
        // eslint-disable-next-line no-console
        console.error("Missing MongoDB URI. Set MONGO_URI in your environment.");
        process.exit(1);
    }
    if (!jwtSecret) {
        // eslint-disable-next-line no-console
        console.error("Missing JWT_SECRET in environment.");
        process.exit(1);
    }
    if (jwtSecret.length < 16 && nodeEnv === "production") {
        // eslint-disable-next-line no-console
        console.error("JWT_SECRET must be at least 16 characters in production.");
        process.exit(1);
    }

    const port = Number(process.env.PORT || 5000);
    const server = app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`TradeCircle server running at http://localhost:${port}`);
    });

    connectWithRetry(mongoUri);
    return server;
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    startServer,
    ensureAdminUser
};
