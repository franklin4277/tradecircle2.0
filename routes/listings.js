const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Report = require("../models/report");
const { auth } = require("../middleware/auth");
const { adjustReputation } = require("../utils/reputation");

const router = express.Router();

const uploadsDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (_, __, cb) => cb(null, uploadsDir),
    filename: (_, file, cb) => {
        const extension = path.extname(file.originalname || "").toLowerCase();
        const cleanExt = extension || ".jpg";
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${cleanExt}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_, file, cb) => {
        if (!file.mimetype || !file.mimetype.startsWith("image/")) {
            return cb(new Error("Only image files are allowed."));
        }

        return cb(null, true);
    }
});

const VALID_REPORT_REASONS = ["Scam", "Fake Product", "Abusive Content", "Spam", "Other"];
const REPORT_THRESHOLD = Number(process.env.REPORT_THRESHOLD || 3);
const REPORT_PENALTY = Number(process.env.REPORT_PENALTY || 10);

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", async (req, res, next) => {
    try {
        const search = String(req.query.search || "").trim();
        const location = String(req.query.location || "").trim();

        const query = { status: "approved" };

        if (search) {
            query.title = { $regex: escapeRegex(search), $options: "i" };
        }

        if (location) {
            query.location = { $regex: `^${escapeRegex(location)}$`, $options: "i" };
        }

        const listings = await Listing.find(query)
            .populate("seller", "name reputationScore")
            .sort({ createdAt: -1 });

        return res.json({ listings });
    } catch (error) {
        return next(error);
    }
});

router.get("/locations", async (req, res, next) => {
    try {
        const locations = await Listing.distinct("location", { status: "approved" });
        return res.json({ locations: locations.filter(Boolean).sort() });
    } catch (error) {
        return next(error);
    }
});

router.get("/mine", auth, async (req, res, next) => {
    try {
        const listings = await Listing.find({ seller: req.user.id }).sort({ createdAt: -1 });
        return res.json({ listings });
    } catch (error) {
        return next(error);
    }
});

router.post("/", auth, upload.single("image"), async (req, res, next) => {
    try {
        const title = String(req.body.title || "").trim();
        const description = String(req.body.description || "").trim();
        const location = String(req.body.location || "").trim();
        const price = Number(req.body.price);

        if (!title || !description || !location || Number.isNaN(price)) {
            return res.status(400).json({ message: "Title, description, price, and location are required." });
        }

        if (title.length < 3 || title.length > 120) {
            return res.status(400).json({ message: "Title must be between 3 and 120 characters." });
        }

        if (description.length < 10 || description.length > 2500) {
            return res.status(400).json({ message: "Description must be between 10 and 2500 characters." });
        }

        if (price < 0) {
            return res.status(400).json({ message: "Price must be a positive amount." });
        }

        const listing = await Listing.create({
            seller: req.user.id,
            title,
            description,
            price,
            location,
            image: req.file ? `/uploads/${req.file.filename}` : "",
            status: "pending"
        });

        return res.status(201).json({
            message: "Listing submitted for moderation.",
            listing
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/report", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const reason = String(req.body.reason || "").trim();
        const notes = String(req.body.notes || "").trim();

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        if (!VALID_REPORT_REASONS.includes(reason)) {
            return res.status(400).json({ message: "Invalid report reason." });
        }

        const listing = await Listing.findById(listingId).select("seller reportsCount penalizedForReports status");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (String(listing.seller) === req.user.id) {
            return res.status(400).json({ message: "You cannot report your own listing." });
        }

        if (listing.status !== "approved") {
            return res.status(400).json({ message: "Only approved listings can be reported." });
        }

        try {
            await Report.create({
                listing: listing._id,
                reporter: req.user.id,
                seller: listing.seller,
                reason,
                notes
            });
        } catch (error) {
            if (error && error.code === 11000) {
                return res.status(409).json({ message: "You already reported this listing." });
            }
            throw error;
        }

        const updatedListing = await Listing.findByIdAndUpdate(
            listing._id,
            { $inc: { reportsCount: 1 } },
            { new: true }
        );

        let sellerPenalized = false;
        if (
            updatedListing &&
            updatedListing.reportsCount >= REPORT_THRESHOLD &&
            !updatedListing.penalizedForReports
        ) {
            updatedListing.penalizedForReports = true;
            await updatedListing.save();
            await adjustReputation(updatedListing.seller, -REPORT_PENALTY);
            sellerPenalized = true;
        }

        return res.status(201).json({
            message: "Report submitted successfully.",
            reportsCount: updatedListing ? updatedListing.reportsCount : listing.reportsCount + 1,
            sellerPenalized
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/messages", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const messageBody = String(req.body.message || "").trim();

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        if (messageBody.length < 2 || messageBody.length > 500) {
            return res.status(400).json({ message: "Message must be between 2 and 500 characters." });
        }

        const listing = await Listing.findById(listingId).select("seller status messages");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (listing.status !== "approved" && String(listing.seller) !== req.user.id) {
            return res.status(400).json({ message: "This listing is not open for messaging." });
        }

        listing.messages.push({ sender: req.user.id, body: messageBody });
        await listing.save();

        return res.status(201).json({ message: "Message sent." });
    } catch (error) {
        return next(error);
    }
});

router.get("/:id/messages", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const listing = await Listing.findById(listingId)
            .select("seller messages")
            .populate("messages.sender", "name email");

        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        const isSeller = String(listing.seller) === req.user.id;
        const hasConversation = listing.messages.some(
            (msg) => msg.sender && String(msg.sender._id || msg.sender) === req.user.id
        );

        if (!isSeller && !hasConversation) {
            return res.status(403).json({ message: "You are not allowed to view these messages." });
        }

        const messages = isSeller
            ? listing.messages
            : listing.messages.filter(
                  (msg) => msg.sender && String(msg.sender._id || msg.sender) === req.user.id
              );

        return res.json({ messages });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/pay", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const listing = await Listing.findById(listingId).select("seller price status title");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (listing.status !== "approved") {
            return res.status(400).json({ message: "Only approved listings can be paid for." });
        }

        if (String(listing.seller) === req.user.id) {
            return res.status(400).json({ message: "You cannot pay for your own listing." });
        }

        const transactionId = `MPESA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        await Promise.all([
            adjustReputation(req.user.id, 1),
            adjustReputation(listing.seller, 2)
        ]);

        return res.json({
            message: "Payment simulated successfully.",
            payment: {
                transactionId,
                amount: listing.price,
                method: "M-Pesa (Simulated)",
                listingTitle: listing.title,
                status: "success"
            }
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
