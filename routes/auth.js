const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/user");
const { auth, generateToken } = require("../middleware/auth");

const router = express.Router();

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phoneNumber) {
    return /^[+]?[0-9][0-9\s-]{7,22}$/.test(phoneNumber);
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

        if (password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters long." });
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

        const shouldCreateAdmin =
            process.env.ADMIN_REGISTER_SECRET && adminSecret === process.env.ADMIN_REGISTER_SECRET;

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            phoneNumber,
            city,
            role: shouldCreateAdmin ? "admin" : "user"
        });

        const token = generateToken(user);

        return res.status(201).json({
            message: "Registration successful.",
            token,
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

        const token = generateToken(user);

        return res.json({
            message: "Login successful.",
            token,
            user
        });
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
