const path = require("path");

function resolveUploadsDir() {
    const configuredPath = String(process.env.UPLOADS_DIR || "").trim();
    if (!configuredPath) {
        return path.join(__dirname, "..", "uploads");
    }

    return path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(__dirname, "..", configuredPath);
}

module.exports = {
    resolveUploadsDir
};
