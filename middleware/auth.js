const jwt = require("jsonwebtoken");
const User = require("../models/user");

const JWT_SECRET = process.env.JWT_SECRET;

function ensureJwtSecret() {
    if (!JWT_SECRET) {
        throw new Error("JWT_SECRET environment variable is required.");
    }
}

function generateToken(user) {
    ensureJwtSecret();
    return jwt.sign({ id: String(user._id) }, JWT_SECRET, { expiresIn: "7d" });
}

async function auth(req, res, next) {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7).trim()
            : "";

        if (!token) {
            return res.status(401).json({ message: "Authorization token missing." });
        }

        ensureJwtSecret();
        const payload = jwt.verify(token, JWT_SECRET);
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
    generateToken
};
