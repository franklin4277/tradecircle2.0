const jwt = require("jsonwebtoken");
const User = require("../models/user");

const ACCESS_TOKEN_SECRET = process.env.JWT_SECRET;

function ensureAccessSecret() {
    if (!ACCESS_TOKEN_SECRET) {
        throw new Error("JWT_SECRET environment variable is required.");
    }
}

function generateAccessToken(user, expiresIn = "15m") {
    ensureAccessSecret();
    return jwt.sign({ id: String(user._id) }, ACCESS_TOKEN_SECRET, { expiresIn });
}

function parseCookies(req) {
    if (req && req.cookies && typeof req.cookies === "object") {
        return req.cookies;
    }

    const header = String((req && req.headers && req.headers.cookie) || "").trim();
    if (!header) {
        return {};
    }

    return header.split(";").reduce((acc, part) => {
        const [rawKey, ...rawValue] = part.split("=");
        const key = String(rawKey || "").trim();
        if (!key) {
            return acc;
        }
        acc[key] = decodeURIComponent(rawValue.join("=").trim());
        return acc;
    }, {});
}

function getAccessTokenFromRequest(req) {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7).trim();
    }

    const cookies = parseCookies(req);
    return String(cookies.tc_access || "").trim();
}

async function auth(req, res, next) {
    try {
        const token = getAccessTokenFromRequest(req);

        if (!token) {
            return res.status(401).json({ message: "Authorization token missing." });
        }

        ensureAccessSecret();
        const payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
        const user = await User.findById(payload.id).select(
            "name email role reputationScore phoneNumber city verifiedSeller communityVerified walletBalance walletHeldBalance"
        );

        if (!user) {
            return res.status(401).json({ message: "Invalid token user." });
        }

        req.user = {
            id: String(user._id),
            name: user.name,
            email: user.email,
            role: user.role,
            reputationScore: user.reputationScore,
            phoneNumber: user.phoneNumber || "",
            city: user.city || "",
            communityVerified: !!user.communityVerified,
            verifiedSeller: !!user.verifiedSeller,
            walletBalance: Number(user.walletBalance || 0),
            walletHeldBalance: Number(user.walletHeldBalance || 0)
        };

        return next();
    } catch (error) {
        return res.status(401).json({ message: "Invalid or expired token." });
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: "You do not have permission for this action." });
        }

        return next();
    };
}

function requireCommunityVerified(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ message: "Authentication required." });
    }

    if (["admin", "moderator"].includes(req.user.role)) {
        return next();
    }

    if (!req.user.communityVerified) {
        return res.status(403).json({
            message:
                "Your account is pending community verification. An admin/moderator must verify you first."
        });
    }

    return next();
}

module.exports = {
    auth,
    requireRole,
    requireCommunityVerified,
    generateToken: generateAccessToken,
    generateAccessToken,
    parseCookies,
    getAccessTokenFromRequest
};
