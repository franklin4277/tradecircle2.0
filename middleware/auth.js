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
            "name email role reputationScore phoneNumber city verifiedSeller"
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
            verifiedSeller: !!user.verifiedSeller
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

module.exports = {
    auth,
    requireRole,
    generateToken
};
