require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const User = require("./models/user");
const Listing = require("./models/listing");

const app = express();
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin } : {}));
app.use(express.json());

app.use(express.static("public"));
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

const cloudinaryConfig = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || ""
};
const useCloudinary = !!(
    cloudinaryConfig.cloudName &&
    cloudinaryConfig.apiKey &&
    cloudinaryConfig.apiSecret
);

async function uploadToCloudinary(file) {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = process.env.CLOUDINARY_FOLDER || "tradecircle";
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}${cloudinaryConfig.apiSecret}`;
    const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");
    const form = new FormData();
    const originalName = path.basename(file.originalname || "upload.jpg");
    const blob = new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" });
    form.append("file", blob, originalName);
    form.append("api_key", cloudinaryConfig.apiKey);
    form.append("timestamp", String(timestamp));
    form.append("folder", folder);
    form.append("signature", signature);

    const endpoint = `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/image/upload`;
    const response = await fetch(endpoint, {
        method: "POST",
        body: form
    });
    const data = await response.json();
    if (!response.ok || !data.secure_url) {
        const msg = data && data.error && data.error.message
            ? data.error.message
            : "Cloudinary upload failed";
        throw new Error(msg);
    }
    return data.secure_url;
}

// Multer setup for image uploads
const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + ext);
    }
});
const upload = multer({
    storage: useCloudinary ? multer.memoryStorage() : diskStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image uploads are allowed"));
        }
        cb(null, true);
    }
});

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
    console.error("Missing MongoDB connection string in MONGO_URI or MONGODB_URI. Set it in .env or the environment.");
    process.exit(1);
}

mongoose.connect(mongoUri)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => {
        console.error("MongoDB connection error:", err);
        process.exit(1);
    });

const JWT_SECRET = process.env.JWT_SECRET || "changeme";
if (JWT_SECRET === "changeme") {
    console.warn("Warning: JWT_SECRET is using the default value. Set JWT_SECRET in your environment.");
}

// Authentication middleware
const auth = (req, res, next) => {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token) return res.status(401).json({ msg: "No token" });

    try {
        const verified = jwt.verify(token, JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ msg: "Invalid token" });
    }
};

// Admin check middleware
const requireAdmin = (req, res, next) => {
    if (req.user && req.user.role === "admin") return next();
    return res.status(403).json({ msg: "Admin required" });
};

/* ---------------- Registration ---------------- */
app.post("/api/register", async (req, res) => {
    try {
        const { name, email, password, contact, bio, location } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ msg: "Name, email, and password are required" });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ msg: "Invalid email format" });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ msg: "Password must be at least 6 characters" });
        }

        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ msg: "Email already exists" });

        const hashed = await bcrypt.hash(password, 10);
        const user = await User.create({
            name: String(name).trim(),
            email: String(email).trim().toLowerCase(),
            password: hashed,
            contact: contact ? String(contact).trim() : "",
            profile: {
                bio: bio ? String(bio).trim() : "",
                location: location ? String(location).trim() : ""
            }
        });
        res.json({
            msg: "Registered successfully",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                contact: user.contact,
                profile: user.profile,
                role: user.role
            }
        });
    } catch (err) {
        res.status(400).json({ msg: err.message || "Registration failed" });
    }
});

/* ---------------- Login ---------------- */
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ msg: "Email and password are required" });
        }

        const user = await User.findOne({ email: String(email).trim().toLowerCase() });
        if (!user) return res.status(400).json({ msg: "Invalid email" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ msg: "Wrong password" });

        const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET);
        res.json({
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                contact: user.contact,
                profile: user.profile || {},
                role: user.role
            }
        });
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/* ---------------- User Profile ---------------- */
app.get("/api/profile", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("name email contact profile role");
        if (!user) return res.status(404).json({ msg: "User not found" });
        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            contact: user.contact || "",
            profile: user.profile || {},
            role: user.role
        });
    } catch (err) {
        res.status(500).json({ msg: err.message || "Failed to load profile" });
    }
});

app.put("/api/profile", auth, async (req, res) => {
    try {
        const { name, contact, bio, location } = req.body;
        const update = {};
        if (typeof name === "string") update.name = name.trim();
        if (typeof contact === "string") update.contact = contact.trim();
        if (typeof bio === "string") update["profile.bio"] = bio.trim();
        if (typeof location === "string") update["profile.location"] = location.trim();

        if (Object.keys(update).length === 0) {
            return res.status(400).json({ msg: "No profile fields provided" });
        }

        const user = await User.findByIdAndUpdate(
            req.user.id,
            { $set: update },
            { new: true, runValidators: true, fields: "name email contact profile role" }
        );
        if (!user) return res.status(404).json({ msg: "User not found" });

        res.json({
            msg: "Profile updated",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                contact: user.contact || "",
                profile: user.profile || {},
                role: user.role
            }
        });
    } catch (err) {
        res.status(400).json({ msg: err.message || "Failed to update profile" });
    }
});

/* ---------------- Add Listing ---------------- */
app.post("/api/listing", auth, upload.single("picture"), async (req, res) => {
    try {
        const { title, price, description, category, location, contactPlatform, contactLink } = req.body;
        if (!title || !price || !description) {
            return res.status(400).json({ msg: "Title, price, and description are required" });
        }
        let picture;
        if (req.file) {
            picture = useCloudinary
                ? await uploadToCloudinary(req.file)
                : `/uploads/${req.file.filename}`;
        }
        const listingData = {
            title: String(title).trim(),
            price: String(price).trim(),
            description: String(description).trim(),
            category: category ? String(category).trim() : "Other",
            location: location ? String(location).trim() : "All Kenya",
            contactPlatform: contactPlatform ? String(contactPlatform).trim() : "Phone",
            contactLink: contactLink ? String(contactLink).trim() : "",
            picture,
            status: "pending",
            owner: req.user && req.user.id ? req.user.id : undefined
        };
        const listing = await Listing.create(listingData);
        res.json({ msg: "Listing submitted for approval", listing });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});

/* ---------------- Get All Approved Listings ---------------- */
app.get("/api/listings", async (req, res) => {
    try {
        const listings = await Listing.find({ status: "approved" }).populate({
            path: "owner",
            select: "name email contact profile"
        });
        res.json(listings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ---------------- Health ---------------- */
app.get("/health", (req, res) => {
    res.json({ ok: true });
});

/* ---------------- Admin Pending Listings ---------------- */
app.get("/api/admin/pending", auth, requireAdmin, async (req, res) => {
    try {
        const listings = await Listing.find({ status: "pending" }).populate({
            path: "owner",
            select: "name email contact profile"
        });
        res.json(listings);
    } catch (err) {
        res.status(500).json({ msg: err.message });
    }
});

/* ---------------- Admin Approve ---------------- */
app.post("/api/admin/approve", auth, requireAdmin, async (req, res) => {
    try {
        if (!req.body.id) return res.status(400).json({ msg: "Listing id is required" });
        await Listing.findByIdAndUpdate(req.body.id, { status: "approved" });
        res.json({ msg: "Listing approved" });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});

/* ---------------- Admin Reject ---------------- */
app.post("/api/admin/reject", auth, requireAdmin, async (req, res) => {
    try {
        if (!req.body.id) return res.status(400).json({ msg: "Listing id is required" });
        await Listing.findByIdAndUpdate(req.body.id, { status: "rejected" });
        res.json({ msg: "Listing rejected" });
    } catch (err) {
        res.status(400).json({ msg: err.message });
    }
});

/* ---------------- Root ---------------- */
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------------- Upload Errors ---------------- */
app.use((err, req, res, next) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ msg: "Image too large. Max file size is 5MB." });
    }
    if (err && err.message === "Only image uploads are allowed") {
        return res.status(400).json({ msg: err.message });
    }
    return next(err);
});

/* ---------------- Start Server ---------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
