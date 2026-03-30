function createRateLimiter(options = {}) {
    const windowMs = Number(options.windowMs || 15 * 60 * 1000);
    const max = Number(options.max || 100);
    const message = options.message || "Too many requests. Please try again later.";
    const defaultKeyGenerator = (req) => {
        const forwardedFor = String(req.headers["x-forwarded-for"] || "")
            .split(",")[0]
            .trim();
        return req.ip || forwardedFor || "unknown";
    };
    const keyGenerator =
        typeof options.keyGenerator === "function"
            ? options.keyGenerator
            : defaultKeyGenerator;

    const store = new Map();

    return (req, res, next) => {
        const now = Date.now();
        const key = keyGenerator(req);
        const current = store.get(key);

        if (!current || current.resetAt <= now) {
            store.set(key, { count: 1, resetAt: now + windowMs });
            res.setHeader("X-RateLimit-Limit", max);
            res.setHeader("X-RateLimit-Remaining", max - 1);
            return next();
        }

        current.count += 1;
        store.set(key, current);

        const remaining = Math.max(max - current.count, 0);
        res.setHeader("X-RateLimit-Limit", max);
        res.setHeader("X-RateLimit-Remaining", remaining);

        if (current.count > max) {
            res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
            return res.status(429).json({ message });
        }

        if (store.size > 20000) {
            // Keep in-memory store bounded for demo environments.
            for (const [entryKey, value] of store.entries()) {
                if (value.resetAt <= now) {
                    store.delete(entryKey);
                }
            }
        }

        return next();
    };
}

module.exports = {
    createRateLimiter
};
