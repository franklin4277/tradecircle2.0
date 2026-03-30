const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const RefreshToken = require("../models/refreshToken");
const { auth, generateAccessToken, parseCookies } = require("../middleware/auth");

const router = express.Router();

const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const REFRESH_TOKEN_SECRET = String(
    process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET || ""
);
const ACCESS_TOKEN_TTL = String(process.env.ACCESS_TOKEN_TTL || "15m").trim() || "15m";
const REFRESH_TOKEN_DAYS = Math.max(1, Number(process.env.REFRESH_TOKEN_DAYS || 7));
const ACCESS_COOKIE_NAME = "tc_access";
const REFRESH_COOKIE_NAME = "tc_refresh";

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phoneNumber) {
    return /^[+]?[0-9][0-9\s-]{7,22}$/.test(phoneNumber);
}

function isStrongPassword(password) {
    const value = String(password || "");
    if (value.length < 8) {
        return false;
    }
    if (!/[a-z]/i.test(value)) {
        return false;
    }
    if (!/\d/.test(value)) {
        return false;
    }
    return true;
}

function hashToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function ensureRefreshSecret() {
    if (!REFRESH_TOKEN_SECRET) {
        throw new Error("REFRESH_TOKEN_SECRET (or JWT_SECRET) environment variable is required.");
    }
}

function getCookieOptions({ maxAgeMs }) {
    return {
        httpOnly: true,
        secure: NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: maxAgeMs
    };
}

function setAuthCookies(res, { accessToken, refreshToken }) {
    res.cookie(
        ACCESS_COOKIE_NAME,
        accessToken,
        getCookieOptions({ maxAgeMs: 15 * 60 * 1000 })
    );
    res.cookie(
        REFRESH_COOKIE_NAME,
        refreshToken,
        getCookieOptions({ maxAgeMs: REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 })
    );
}

function clearAuthCookies(res) {
    const options = {
        httpOnly: true,
        secure: NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
    };
    res.clearCookie(ACCESS_COOKIE_NAME, options);
    res.clearCookie(REFRESH_COOKIE_NAME, options);
}

async function issueRefreshToken(req, userId) {
    ensureRefreshSecret();
    const tokenId = crypto.randomUUID();
    const rawToken = jwt.sign(
        { id: String(userId), tokenId, type: "refresh" },
        REFRESH_TOKEN_SECRET,
        { expiresIn: `${REFRESH_TOKEN_DAYS}d` }
    );
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await RefreshToken.create({
        user: userId,
        tokenHash: hashToken(rawToken),
        tokenId,
        expiresAt,
        userAgent: String(req.get("user-agent") || "").slice(0, 300),
        ipAddress: String(req.ip || "").slice(0, 80)
    });

    return rawToken;
}

async function createSession(req, res, user) {
    const accessToken = generateAccessToken(user, ACCESS_TOKEN_TTL);
    const refreshToken = await issueRefreshToken(req, user._id);
    setAuthCookies(res, { accessToken, refreshToken });

    return {
        accessToken,
        user
    };
}

async function revokeRefreshToken(rawToken, replacedByTokenId = "") {
    if (!rawToken) {
        return;
    }

    try {
        ensureRefreshSecret();
        const payload = jwt.verify(rawToken, REFRESH_TOKEN_SECRET);
        const tokenHash = hashToken(rawToken);
        const tokenDoc = await RefreshToken.findOne({
            user: payload.id,
            tokenId: payload.tokenId,
            tokenHash,
            revokedAt: null,
            expiresAt: { $gt: new Date() }
        });

        if (!tokenDoc) {
            return;
        }

        tokenDoc.revokedAt = new Date();
        tokenDoc.replacedByTokenId = String(replacedByTokenId || "");
        await tokenDoc.save();
    } catch {
        // Ignore invalid refresh token during cleanup/revoke.
    }
}

router.post("/register", async (req, res, next) => {
    try {
        const name = String(req.body.name || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");
        const adminSecret = String(req.body.adminSecret || "").trim();
        const phoneNumber = String(req.body.phoneNumber || "").trim();
        const city = String(req.body.city || "").trim();

        if (!name || !email || !password) {
            return res.status(400).json({ message: "Name, email, and password are required." });
        }

        if (name.length < 2 || name.length > 80) {
            return res.status(400).json({ message: "Name must be between 2 and 80 characters." });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ message: "Please provide a valid email address." });
        }

        if (!isStrongPassword(password)) {
            return res.status(400).json({
                message: "Password must be at least 8 characters and include both letters and numbers."
            });
        }

        if (phoneNumber && !isValidPhone(phoneNumber)) {
            return res.status(400).json({ message: "Phone number format is invalid." });
        }

        if (city && city.length > 80) {
            return res.status(400).json({ message: "City must be 80 characters or less." });
        }

        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(409).json({ message: "Email already exists." });
        }

        const adminRegistrationEnabled =
            String(process.env.ALLOW_ADMIN_REGISTRATION || "")
                .trim()
                .toLowerCase() === "true";
        const adminRegisterSecret = String(process.env.ADMIN_REGISTER_SECRET || "").trim();

        let role = "user";
        if (adminSecret) {
            if (!adminRegistrationEnabled || !adminRegisterSecret) {
                return res.status(403).json({
                    message: "Admin self-registration is disabled by server policy."
                });
            }
            if (adminSecret !== adminRegisterSecret) {
                return res.status(403).json({ message: "Invalid admin registration secret." });
            }
            role = "admin";
        }

        if (role === "admin" && password.length < 12) {
            return res.status(400).json({
                message: "Admin password must be at least 12 characters long."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            phoneNumber,
            city,
            role,
            communityVerified: role !== "user"
        });

        const session = await createSession(req, res, user);

        return res.status(201).json({
            message:
                role === "user"
                    ? "Registration successful. Your account is pending community verification."
                    : "Registration successful.",
            token: session.accessToken,
            user
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/login", async (req, res, next) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required." });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: "Invalid credentials." });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: "Invalid credentials." });
        }

        user.lastSeenAt = new Date();
        await user.save();

        const session = await createSession(req, res, user);

        return res.json({
            message: "Login successful.",
            token: session.accessToken,
            user
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/refresh", async (req, res, next) => {
    try {
        ensureRefreshSecret();
        const cookies = parseCookies(req);
        const rawRefreshToken = String(cookies[REFRESH_COOKIE_NAME] || "").trim();
        if (!rawRefreshToken) {
            return res.status(401).json({ message: "Refresh token is missing." });
        }

        let payload;
        try {
            payload = jwt.verify(rawRefreshToken, REFRESH_TOKEN_SECRET);
        } catch {
            clearAuthCookies(res);
            return res.status(401).json({ message: "Refresh token is invalid or expired." });
        }

        const tokenHash = hashToken(rawRefreshToken);
        const tokenDoc = await RefreshToken.findOne({
            user: payload.id,
            tokenId: payload.tokenId,
            tokenHash,
            revokedAt: null,
            expiresAt: { $gt: new Date() }
        });
        if (!tokenDoc) {
            clearAuthCookies(res);
            return res.status(401).json({ message: "Refresh token session not found." });
        }

        const user = await User.findById(payload.id);
        if (!user) {
            clearAuthCookies(res);
            return res.status(401).json({ message: "User not found for refresh token." });
        }

        const newRefreshToken = await issueRefreshToken(req, user._id);
        let newPayload = null;
        try {
            newPayload = jwt.verify(newRefreshToken, REFRESH_TOKEN_SECRET);
        } catch {
            // no-op
        }
        tokenDoc.revokedAt = new Date();
        tokenDoc.replacedByTokenId = String((newPayload && newPayload.tokenId) || "");
        await tokenDoc.save();

        const accessToken = generateAccessToken(user, ACCESS_TOKEN_TTL);
        setAuthCookies(res, { accessToken, refreshToken: newRefreshToken });

        return res.json({
            message: "Session refreshed.",
            token: accessToken,
            user
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/logout", async (req, res, next) => {
    try {
        const cookies = parseCookies(req);
        const refreshToken = String(cookies[REFRESH_COOKIE_NAME] || "").trim();
        if (refreshToken) {
            await revokeRefreshToken(refreshToken);
        }

        clearAuthCookies(res);
        return res.json({ message: "Logged out successfully." });
    } catch (error) {
        return next(error);
    }
});

router.get("/me", auth, async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        return res.json({ user });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
