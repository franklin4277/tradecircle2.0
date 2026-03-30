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
const VALID_CATEGORIES = [
    "Electronics",
    "Vehicles",
    "Property",
    "Home & Furniture",
    "Fashion",
    "Jobs",
    "Services",
    "Agriculture",
    "Other"
];
const VALID_CONDITIONS = ["Brand New", "Like New", "Used - Good", "Used - Fair", "Refurbished"];
const VALID_AVAILABILITY = ["available", "reserved", "sold"];
const REPORT_THRESHOLD = Number(process.env.REPORT_THRESHOLD || 3);
const REPORT_PENALTY = Number(process.env.REPORT_PENALTY || 10);

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBoolean(value, fallback = false) {
    const raw = String(value || "").trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(raw)) {
        return true;
    }
    if (["false", "0", "no", "off"].includes(raw)) {
        return false;
    }
    return fallback;
}

function parseNumberOrNull(value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
        return null;
    }
    return parsed;
}

function isValidPhone(phoneNumber) {
    return /^[+]?[0-9][0-9\s-]{7,22}$/.test(phoneNumber);
}

router.get("/meta", async (req, res, next) => {
    try {
        const listingMatch = { status: "approved", availability: { $ne: "sold" } };
        const [locations, priceStats] = await Promise.all([
            Listing.distinct("location", listingMatch),
            Listing.aggregate([
                { $match: listingMatch },
                {
                    $group: {
                        _id: null,
                        minPrice: { $min: "$price" },
                        maxPrice: { $max: "$price" }
                    }
                }
            ])
        ]);

        const stats = priceStats[0] || {};

        return res.json({
            categories: VALID_CATEGORIES,
            conditions: VALID_CONDITIONS,
            locations: locations.filter(Boolean).sort(),
            minPrice: typeof stats.minPrice === "number" ? stats.minPrice : 0,
            maxPrice: typeof stats.maxPrice === "number" ? stats.maxPrice : 0
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/", async (req, res, next) => {
    try {
        const search = String(req.query.search || "").trim();
        const location = String(req.query.location || "").trim();
        const category = String(req.query.category || "").trim();
        const itemCondition = String(req.query.condition || "").trim();
        const sort = String(req.query.sort || "newest").trim();

        const minPrice = parseNumberOrNull(req.query.minPrice);
        const maxPrice = parseNumberOrNull(req.query.maxPrice);

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(60, Math.max(1, Number(req.query.limit) || 24));
        const skip = (page - 1) * limit;

        const query = {
            status: "approved",
            availability: { $ne: "sold" }
        };

        if (search) {
            const escaped = escapeRegex(search);
            query.$or = [
                { title: { $regex: escaped, $options: "i" } },
                { description: { $regex: escaped, $options: "i" } }
            ];
        }

        if (location) {
            query.location = { $regex: `^${escapeRegex(location)}$`, $options: "i" };
        }

        if (category && VALID_CATEGORIES.includes(category)) {
            query.category = category;
        }

        if (itemCondition && VALID_CONDITIONS.includes(itemCondition)) {
            query.itemCondition = itemCondition;
        }

        if (minPrice !== null || maxPrice !== null) {
            query.price = {};
            if (minPrice !== null && minPrice >= 0) {
                query.price.$gte = minPrice;
            }
            if (maxPrice !== null && maxPrice >= 0) {
                query.price.$lte = maxPrice;
            }
        }

        const sortMap = {
            newest: { createdAt: -1 },
            oldest: { createdAt: 1 },
            price_low_high: { price: 1, createdAt: -1 },
            price_high_low: { price: -1, createdAt: -1 },
            most_viewed: { viewsCount: -1, createdAt: -1 }
        };
        const sortBy = sortMap[sort] || sortMap.newest;

        const [listings, total] = await Promise.all([
            Listing.find(query)
                .populate("seller", "name reputationScore verifiedSeller city")
                .sort(sortBy)
                .skip(skip)
                .limit(limit),
            Listing.countDocuments(query)
        ]);

        // Treat listing impressions as view events for a more realistic marketplace signal.
        if (listings.length > 0) {
            const ids = listings.map((listing) => listing._id);
            await Listing.updateMany({ _id: { $in: ids } }, { $inc: { viewsCount: 1 } });
            listings.forEach((listing) => {
                listing.viewsCount += 1;
            });
        }

        return res.json({
            listings,
            total,
            page,
            pages: Math.max(1, Math.ceil(total / limit))
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/locations", async (req, res, next) => {
    try {
        const locations = await Listing.distinct("location", {
            status: "approved",
            availability: { $ne: "sold" }
        });
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
        const category = String(req.body.category || "").trim();
        const itemCondition = String(req.body.itemCondition || "").trim();
        const contactPhone = String(req.body.contactPhone || "").trim();
        const price = Number(req.body.price);
        const negotiable = parseBoolean(req.body.negotiable, false);
        const deliveryAvailable = parseBoolean(req.body.deliveryAvailable, false);
        const meetupAvailable = parseBoolean(req.body.meetupAvailable, false);

        if (!title || !description || !location || Number.isNaN(price) || !contactPhone) {
            return res.status(400).json({
                message: "Title, description, price, location, and contact phone are required."
            });
        }

        if (!VALID_CATEGORIES.includes(category)) {
            return res.status(400).json({ message: "Invalid listing category." });
        }

        if (!VALID_CONDITIONS.includes(itemCondition)) {
            return res.status(400).json({ message: "Invalid item condition." });
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

        if (!isValidPhone(contactPhone)) {
            return res.status(400).json({ message: "Contact phone format is invalid." });
        }

        const listing = await Listing.create({
            seller: req.user.id,
            title,
            description,
            price,
            location,
            category,
            itemCondition,
            contactPhone,
            negotiable,
            deliveryAvailable,
            meetupAvailable,
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

router.get("/:id", async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const listing = await Listing.findOne({
            _id: listingId,
            status: "approved"
        }).populate("seller", "name reputationScore verifiedSeller city");

        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        listing.viewsCount += 1;
        await listing.save();

        return res.json({ listing });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/availability", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const availability = String(req.body.availability || "").trim().toLowerCase();

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        if (!VALID_AVAILABILITY.includes(availability)) {
            return res.status(400).json({ message: "Availability must be available, reserved, or sold." });
        }

        const listing = await Listing.findById(listingId).select("seller availability");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (String(listing.seller) !== req.user.id) {
            return res.status(403).json({ message: "Only the seller can update availability." });
        }

        const previousAvailability = listing.availability;
        listing.availability = availability;
        await listing.save();

        if (previousAvailability !== "sold" && availability === "sold") {
            await adjustReputation(req.user.id, 3);
        }

        return res.json({
            message: `Listing marked as ${availability}.`,
            availability
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

        const listing = await Listing.findById(listingId).select(
            "seller reportsCount penalizedForReports status availability"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (String(listing.seller) === req.user.id) {
            return res.status(400).json({ message: "You cannot report your own listing." });
        }

        if (listing.status !== "approved") {
            return res.status(400).json({ message: "Only approved listings can be reported." });
        }

        if (listing.availability === "sold") {
            return res.status(400).json({ message: "Sold listings cannot be reported." });
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
        let movedToPendingReview = false;

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

        if (
            updatedListing &&
            updatedListing.reportsCount >= REPORT_THRESHOLD + 1 &&
            updatedListing.status === "approved"
        ) {
            updatedListing.status = "pending";
            await updatedListing.save();
            movedToPendingReview = true;
        }

        return res.status(201).json({
            message: "Report submitted successfully.",
            reportsCount: updatedListing ? updatedListing.reportsCount : listing.reportsCount + 1,
            sellerPenalized,
            movedToPendingReview,
            listingStatus: updatedListing ? updatedListing.status : listing.status
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/messages", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const messageBody = String(req.body.message || "").trim();
        const offerAmountRaw = parseNumberOrNull(req.body.offerAmount);
        const hasOffer = offerAmountRaw !== null && offerAmountRaw > 0;

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const textToSend = messageBody || (hasOffer ? "Buyer submitted an offer." : "");
        if (textToSend.length < 2 || textToSend.length > 500) {
            return res.status(400).json({ message: "Message must be between 2 and 500 characters." });
        }

        if (hasOffer && offerAmountRaw < 50) {
            return res.status(400).json({ message: "Offer amount must be at least 50." });
        }

        const listing = await Listing.findById(listingId).select("seller status availability messages");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (listing.status !== "approved" && String(listing.seller) !== req.user.id) {
            return res.status(400).json({ message: "This listing is not open for messaging." });
        }

        if (listing.availability === "sold" && String(listing.seller) !== req.user.id) {
            return res.status(400).json({ message: "This listing has already been sold." });
        }

        listing.messages.push({
            sender: req.user.id,
            type: hasOffer ? "offer" : "message",
            body: textToSend,
            offerAmount: hasOffer ? Number(offerAmountRaw.toFixed(2)) : null
        });
        await listing.save();

        return res.status(201).json({
            message: hasOffer ? "Offer sent to seller." : "Message sent."
        });
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

        const listing = await Listing.findById(listingId).select(
            "seller price status title availability deliveryAvailable"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        if (listing.status !== "approved") {
            return res.status(400).json({ message: "Only approved listings can be paid for." });
        }

        if (listing.availability === "sold") {
            return res.status(400).json({ message: "This listing is already marked as sold." });
        }

        if (listing.availability === "reserved") {
            return res.status(400).json({ message: "This listing is currently reserved." });
        }

        if (String(listing.seller) === req.user.id) {
            return res.status(400).json({ message: "You cannot pay for your own listing." });
        }

        const transactionId = `MPESA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const processingFee = Number((listing.price * 0.015).toFixed(2));
        const totalCharged = Number((listing.price + processingFee).toFixed(2));

        const roll = Math.random();
        let paymentStatus = "success";
        if (roll < 0.08) {
            paymentStatus = "failed";
        } else if (roll < 0.22) {
            paymentStatus = "pending";
        }

        if (paymentStatus === "success") {
            await Promise.all([
                adjustReputation(req.user.id, 1),
                adjustReputation(listing.seller, 2)
            ]);
        }

        return res.json({
            message:
                paymentStatus === "success"
                    ? "Payment simulated successfully."
                    : paymentStatus === "pending"
                    ? "Payment initiated and awaiting confirmation."
                    : "Payment simulation failed due to timeout.",
            payment: {
                transactionId,
                amount: listing.price,
                processingFee,
                totalCharged,
                method: "M-Pesa (Simulated)",
                listingTitle: listing.title,
                status: paymentStatus,
                expectedFulfilment:
                    paymentStatus === "success"
                        ? listing.deliveryAvailable
                            ? "1-3 days delivery"
                            : "Meetup within 24 hours"
                        : "N/A"
            }
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
