function isUnsafeKey(key) {
    const text = String(key || "");
    return text.startsWith("$") || text.includes(".");
}

function sanitizeValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeValue(entry));
    }

    if (value && typeof value === "object") {
        const clean = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (isUnsafeKey(key)) {
                continue;
            }
            clean[key] = sanitizeValue(nestedValue);
        }
        return clean;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    return value;
}

function sanitizeRequest(req, res, next) {
    req.body = sanitizeValue(req.body || {});
    req.query = sanitizeValue(req.query || {});
    req.params = sanitizeValue(req.params || {});
    next();
}

module.exports = {
    sanitizeRequest,
    sanitizeValue
};
