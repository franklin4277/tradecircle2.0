require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const User = require("./models/user");
const authRoutes = require("./routes/auth");
const listingRoutes = require("./routes/listings");
const adminRoutes = require("./routes/admin");
const { createRateLimiter } = require("./middleware/rateLimit");

const app = express();

app.disable("x-powered-by");

const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const corsOrigin = process.env.CORS_ORIGIN;
const corsOptions = corsOrigin
    ? {
          origin: corsOrigin.split(",").map((origin) => origin.trim()),
          methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
      }
    : {};

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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
    max: 20,
    message: "Too many authentication requests. Please wait and try again."
});

app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);

app.use("/uploads", express.static(uploadsDir));
app.use(express.static(publicDir));

app.get("/health", (_, res) => {
    return res.json({ status: "ok", service: "TradeCircle API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/admin", adminRoutes);

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
        if (existingAdmin.role !== "admin") {
            existingAdmin.role = "admin";
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
        reputationScore: 200
    });
}

async function startServer() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
        // eslint-disable-next-line no-console
        console.error("Missing MongoDB URI. Set MONGO_URI in your environment.");
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        await ensureAdminUser();

        const port = Number(process.env.PORT || 5000);
        app.listen(port, () => {
            // eslint-disable-next-line no-console
            console.log(`TradeCircle server running at http://localhost:${port}`);
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error("Failed to start server:", error.message);
        process.exit(1);
    }
}

startServer();
