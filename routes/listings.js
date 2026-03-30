const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Report = require("../models/report");
const Escrow = require("../models/escrow");
const User = require("../models/user");
const { auth, requireCommunityVerified } = require("../middleware/auth");
const { adjustReputation } = require("../utils/reputation");
const { computeListingRiskScore } = require("../utils/fraud");
const { createNotification } = require("../utils/notifications");
const { resolveUploadsDir } = require("../config/storage");

const router = express.Router();

const uploadsDir = resolveUploadsDir();
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
const ACTIVE_ESCROW_STATUSES = ["funded", "shipped", "disputed"];
const REPORT_THRESHOLD = Number(process.env.REPORT_THRESHOLD || 3);
const REPORT_PENALTY = Number(process.env.REPORT_PENALTY || 10);
const PAYMENTS_ENABLED =
    String(process.env.ENABLE_SIMULATED_PAYMENTS || "")
        .trim()
        .toLowerCase() === "true";

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

function normalizeServiceRateType(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (["fixed", "hourly", "daily", "negotiable"].includes(raw)) {
        return raw;
    }
    return "fixed";
}

function parseNumberOrNull(value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        return null;
    }
    return parsed;
}

function isValidPhone(phoneNumber) {
    return /^[+]?[0-9][0-9\s-]{7,22}$/.test(phoneNumber);
}

function computeRankingScore(listing, selectedCategory = "") {
    const sellerReputation = Number(listing?.seller?.reputationScore || 100);
    const listingReports = Number(listing?.reportsCount || 0);
    const createdAtMs = new Date(listing?.createdAt || Date.now()).getTime();
    const ageDays = Math.max(0, (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24));
    const freshnessScore = Math.max(0, 30 - ageDays);
    const categoryBoost = selectedCategory && listing.category === selectedCategory ? 12 : 0;
    const verifiedBoost = listing?.seller?.verifiedSeller ? 8 : 0;
    const reportPenalty = listingReports * 9;

    return sellerReputation * 0.65 + freshnessScore * 1.8 + categoryBoost + verifiedBoost - reportPenalty;
}

function ensureListingSeller(listing) {
    if (listing && !listing.seller && listing.owner) {
        listing.seller = listing.owner;
    }
    return listing;
}

function getListingSellerId(listing) {
    if (!listing) {
        return "";
    }
    const seller = listing.seller || listing.owner;
    return seller ? String(seller) : "";
}

function normalizeMessageSenderId(message) {
    if (!message || !message.sender) {
        return "";
    }
    return String(message.sender._id || message.sender);
}

function isServiceListing(listing) {
    return String(listing && listing.category ? listing.category : "")
        .trim()
        .toLowerCase() === "services";
}

function buyerHasNegotiatedWithSeller(listing, buyerId) {
    const buyer = String(buyerId || "");
    if (!buyer) {
        return false;
    }

    const messages = Array.isArray(listing && listing.messages) ? listing.messages : [];
    return messages.some((message) => normalizeMessageSenderId(message) === buyer);
}

function buyerHasAcceptedOfferWithSeller(listing, buyerId) {
    const buyer = String(buyerId || "");
    if (!buyer) {
        return false;
    }

    const messages = Array.isArray(listing && listing.messages) ? listing.messages : [];
    return messages.some((message) => {
        const senderId = normalizeMessageSenderId(message);
        return (
            senderId === buyer &&
            String(message.type || "") === "offer" &&
            String(message.offerStatus || "pending") === "accepted"
        );
    });
}

function isStaffUser(user) {
    const role = String(user && user.role ? user.role : "").toLowerCase();
    return role === "admin" || role === "moderator";
}

async function removeListingImageIfExists(imagePath) {
    const raw = String(imagePath || "").trim();
    if (!raw) {
        return;
    }

    const fileName = path.basename(raw);
    if (!fileName) {
        return;
    }

    const absolutePath = path.join(uploadsDir, fileName);
    try {
        await fs.promises.unlink(absolutePath);
    } catch (error) {
        if (!error || error.code !== "ENOENT") {
            throw error;
        }
    }
}

async function applyListingRiskSignals(listing) {
    const sellerId = getListingSellerId(listing);
    if (!sellerId) {
        return null;
    }

    const seller = await User.findById(sellerId).select("verifiedSeller createdAt");
    if (!seller) {
        return null;
    }

    const risk = computeListingRiskScore({ listing, seller });
    listing.riskScore = risk.score;
    listing.riskLevel = risk.riskLevel;
    listing.riskFlags = risk.flags;
    listing.flaggedForFraud = risk.riskLevel === "high";

    return risk;
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
        const sort = String(req.query.sort || "recommended")
            .trim()
            .toLowerCase();

        const minPrice = parseNumberOrNull(req.query.minPrice);
        const maxPrice = parseNumberOrNull(req.query.maxPrice);

        if ((minPrice !== null && minPrice < 0) || (maxPrice !== null && maxPrice < 0)) {
            return res.status(400).json({ message: "Price filters must be zero or greater." });
        }
        if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
            return res.status(400).json({ message: "Minimum price cannot be greater than maximum price." });
        }

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
            if (minPrice !== null) {
                query.price.$gte = minPrice;
            }
            if (maxPrice !== null) {
                query.price.$lte = maxPrice;
            }
        }

        const sortMap = {
            recommended: { createdAt: -1 },
            newest: { createdAt: -1 },
            oldest: { createdAt: 1 },
            price_low_high: { price: 1, createdAt: -1 },
            price_high_low: { price: -1, createdAt: -1 },
            most_viewed: { viewsCount: -1, createdAt: -1 }
        };
        const sortBy = sortMap[sort] || sortMap.recommended;

        if (sort === "recommended") {
            const listings = await Listing.find(query)
                .populate("seller", "name reputationScore verifiedSeller city")
                .populate("owner", "name reputationScore verifiedSeller city")
                .sort({ createdAt: -1 });

            listings.forEach((listing) => {
                if (!listing.seller && listing.owner) {
                    listing.seller = listing.owner;
                }
                listing.rankingScore = Number(computeRankingScore(listing, category).toFixed(2));
            });

            listings.sort((a, b) => {
                if (b.rankingScore !== a.rankingScore) {
                    return b.rankingScore - a.rankingScore;
                }
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            const total = listings.length;
            const paginatedListings = listings.slice(skip, skip + limit);

            return res.json({
                listings: paginatedListings,
                total,
                page,
                pages: Math.max(1, Math.ceil(total / limit))
            });
        }

        const [listings, total] = await Promise.all([
            Listing.find(query)
                .populate("seller", "name reputationScore verifiedSeller city")
                .populate("owner", "name reputationScore verifiedSeller city")
                .sort(sortBy)
                .skip(skip)
                .limit(limit),
            Listing.countDocuments(query)
        ]);

        listings.forEach((listing) => {
            if (!listing.seller && listing.owner) {
                listing.seller = listing.owner;
            }
            listing.rankingScore = Number(computeRankingScore(listing, category).toFixed(2));
        });

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
        const listings = await Listing.find({
            $or: [{ seller: req.user.id }, { owner: req.user.id }]
        }).sort({ createdAt: -1 });
        listings.forEach(ensureListingSeller);
        return res.json({ listings });
    } catch (error) {
        return next(error);
    }
});

router.get("/inbox", auth, async (req, res, next) => {
    try {
        const sellerId = String(req.user.id);
        const listings = await Listing.find({
            $or: [{ seller: sellerId }, { owner: sellerId }]
        })
            .select("title image location status availability messages updatedAt")
            .sort({ updatedAt: -1 })
            .limit(200);

        const threads = listings
            .map((listing) => {
                ensureListingSeller(listing);
                const messages = Array.isArray(listing.messages) ? listing.messages : [];
                if (messages.length === 0) {
                    return null;
                }

                const unreadCount = messages.filter((message) => {
                    const senderId = normalizeMessageSenderId(message);
                    return senderId && senderId !== sellerId && !message.readBySeller;
                }).length;

                const lastMessage = messages[messages.length - 1];
                const lastSenderId = normalizeMessageSenderId(lastMessage);

                return {
                    listingId: String(listing._id),
                    title: listing.title,
                    image: listing.image,
                    location: listing.location,
                    status: listing.status,
                    availability: listing.availability,
                    unreadCount,
                    totalMessages: messages.length,
                    lastMessage: {
                        body: lastMessage.body || "",
                        type: lastMessage.type || "message",
                        createdAt: lastMessage.createdAt || listing.updatedAt,
                        fromSeller: lastSenderId === sellerId,
                        senderName: lastMessage.senderName || ""
                    }
                };
            })
            .filter(Boolean)
            .sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt));

        const unreadTotal = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);

        return res.json({
            threads,
            unreadTotal
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/", auth, requireCommunityVerified, upload.single("image"), async (req, res, next) => {
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
        const serviceRateType = normalizeServiceRateType(req.body.serviceRateType);
        const serviceRemoteAvailable = parseBoolean(req.body.serviceRemoteAvailable, false);
        const serviceResponseTimeHours = Math.max(
            1,
            Math.min(168, Number(req.body.serviceResponseTimeHours) || 24)
        );
        const isService = String(category).toLowerCase() === "services";

        if (!title || !description || !location || Number.isNaN(price) || !contactPhone) {
            return res.status(400).json({
                message: "Title, description, price, location, and contact phone are required."
            });
        }

        if (!VALID_CATEGORIES.includes(category)) {
            return res.status(400).json({ message: "Invalid listing category." });
        }

        if (!isService && !VALID_CONDITIONS.includes(itemCondition)) {
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
            owner: req.user.id,
            title,
            description,
            price,
            location,
            category,
            itemCondition: isService ? "Used - Good" : itemCondition,
            contactPhone,
            negotiable,
            deliveryAvailable: isService ? false : deliveryAvailable,
            meetupAvailable: isService ? true : meetupAvailable,
            serviceRateType: isService ? serviceRateType : "fixed",
            serviceRemoteAvailable: isService ? serviceRemoteAvailable : false,
            serviceResponseTimeHours: isService ? serviceResponseTimeHours : 24,
            image: req.file ? `/uploads/${req.file.filename}` : "",
            status: "pending"
        });
        await applyListingRiskSignals(listing);
        await listing.save();

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
        })
            .populate("seller", "name reputationScore verifiedSeller city")
            .populate("owner", "name reputationScore verifiedSeller city");

        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        ensureListingSeller(listing);
        listing.viewsCount += 1;
        await listing.save();

        return res.json({ listing });
    } catch (error) {
        return next(error);
    }
});

router.delete("/:id", auth, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const listing = await Listing.findById(listingId).select(
            "seller owner image availability status"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);

        const sellerId = getListingSellerId(listing);
        const isStaff = isStaffUser(req.user);
        const isOwner = sellerId === req.user.id;

        if (!isStaff && !isOwner) {
            return res.status(403).json({
                message: "Only the seller, admin, or moderator can remove this listing."
            });
        }

        const activeEscrows = await Escrow.countDocuments({
            listing: listing._id,
            status: { $in: ACTIVE_ESCROW_STATUSES }
        });
        if (activeEscrows > 0) {
            return res.status(409).json({
                message: "Listing cannot be removed while an active escrow deal exists."
            });
        }

        await Promise.all([
            Listing.findByIdAndDelete(listing._id),
            Report.deleteMany({ listing: listing._id })
        ]);
        await removeListingImageIfExists(listing.image);

        return res.json({ message: "Listing removed successfully." });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/availability", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const availability = String(req.body.availability || "").trim().toLowerCase();

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        if (!VALID_AVAILABILITY.includes(availability)) {
            return res.status(400).json({ message: "Availability must be available, reserved, or sold." });
        }

        const listing = await Listing.findById(listingId).select("seller owner availability");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);

        if (getListingSellerId(listing) !== req.user.id) {
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

router.post("/:id/report", auth, requireCommunityVerified, async (req, res, next) => {
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
            "seller owner reportsCount penalizedForReports status availability"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        ensureListingSeller(listing);
        if (!listing.seller && listing.owner) {
            listing.seller = listing.owner;
            await listing.save();
        }
        const sellerId = getListingSellerId(listing);
        if (!sellerId) {
            return res.status(400).json({ message: "Listing seller is missing. Please contact support." });
        }

        if (sellerId === req.user.id) {
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
                seller: sellerId,
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
            { returnDocument: "after" }
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

        if (updatedListing) {
            const risk = await applyListingRiskSignals(updatedListing);
            if (risk && risk.riskLevel === "high" && updatedListing.status === "approved") {
                updatedListing.status = "pending";
                movedToPendingReview = true;
            }
            await updatedListing.save();
        }

        return res.status(201).json({
            message: "Report submitted successfully.",
            reportsCount: updatedListing ? updatedListing.reportsCount : listing.reportsCount + 1,
            sellerPenalized,
            movedToPendingReview,
            listingStatus: updatedListing ? updatedListing.status : listing.status,
            riskScore: updatedListing ? updatedListing.riskScore : null,
            riskLevel: updatedListing ? updatedListing.riskLevel : null
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/messages", auth, requireCommunityVerified, async (req, res, next) => {
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

        const listing = await Listing.findById(listingId).select(
            "seller owner status availability messages"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);
        if (!listing.seller && listing.owner) {
            listing.seller = listing.owner;
        }

        const sellerId = getListingSellerId(listing);
        if (!sellerId) {
            return res.status(400).json({ message: "Listing seller is missing. Please contact support." });
        }

        if (listing.status !== "approved" && sellerId !== req.user.id) {
            return res.status(400).json({ message: "This listing is not open for messaging." });
        }

        if (listing.availability === "sold" && sellerId !== req.user.id) {
            return res.status(400).json({ message: "This listing has already been sold." });
        }

        const messageId = new mongoose.Types.ObjectId().toString();
        listing.messages.push({
            messageId,
            sender: req.user.id,
            senderName: req.user.name || "",
            senderEmail: req.user.email || "",
            senderPhone: req.user.phoneNumber || "",
            senderCity: req.user.city || "",
            readBySeller: sellerId === req.user.id,
            type: hasOffer ? "offer" : "message",
            body: textToSend,
            offerAmount: hasOffer ? Number(offerAmountRaw.toFixed(2)) : null,
            offerStatus: hasOffer ? "pending" : "pending"
        });
        await listing.save();

        if (sellerId !== req.user.id) {
            await createNotification({
                userId: sellerId,
                type: hasOffer ? "offer" : "message",
                title: hasOffer ? "New Offer Received" : "New Buyer Message",
                body: hasOffer
                    ? `${req.user.name || "A buyer"} offered ${offerAmountRaw.toFixed(
                          2
                      )} on "${listing.title}".`
                    : `${req.user.name || "A buyer"} sent you a message on "${listing.title}".`,
                listingId: listing._id,
                messageId
            });
        }

        return res.status(201).json({
            message: hasOffer ? "Offer sent to seller." : "Message sent."
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/offers/:messageId/decision", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const messageId = String(req.params.messageId || "").trim();
        const decision = String(req.body.decision || "").trim().toLowerCase();

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }
        if (!messageId) {
            return res.status(400).json({ message: "Offer message ID is required." });
        }
        if (!["accepted", "rejected"].includes(decision)) {
            return res.status(400).json({ message: "Decision must be accepted or rejected." });
        }

        const listing = await Listing.findById(listingId).select(
            "title seller owner availability messages"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);

        const sellerId = getListingSellerId(listing);
        if (sellerId !== req.user.id) {
            return res.status(403).json({ message: "Only the seller can decide on offers." });
        }

        const targetOffer = listing.messages.find(
            (message) =>
                String(message.messageId || "") === messageId && String(message.type || "") === "offer"
        );
        if (!targetOffer) {
            return res.status(404).json({ message: "Offer not found for this listing." });
        }

        if (targetOffer.offerStatus !== "pending") {
            return res.status(400).json({ message: "This offer already has a final decision." });
        }

        targetOffer.offerStatus = decision;
        targetOffer.offerDecisionBy = req.user.id;
        targetOffer.offerDecisionAt = new Date();
        targetOffer.readBySeller = true;

        if (decision === "accepted") {
            listing.availability = "reserved";
            listing.messages.forEach((message) => {
                if (
                    message !== targetOffer &&
                    String(message.type || "") === "offer" &&
                    String(message.offerStatus || "pending") === "pending"
                ) {
                    message.offerStatus = "rejected";
                    message.offerDecisionBy = req.user.id;
                    message.offerDecisionAt = new Date();
                }
            });
        }

        await listing.save();

        const buyerId = normalizeMessageSenderId(targetOffer);
        if (buyerId) {
            await createNotification({
                userId: buyerId,
                type: "offer",
                title:
                    decision === "accepted" ? "Offer Accepted" : "Offer Update",
                body:
                    decision === "accepted"
                        ? `Your offer on "${listing.title}" was accepted. You can now start secure payment.`
                        : `Your offer on "${listing.title}" was not accepted.`,
                listingId: listing._id,
                messageId
            });
        }

        return res.json({
            message:
                decision === "accepted"
                    ? "Offer accepted. Listing is now reserved."
                    : "Offer rejected.",
            decision
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/messages/read", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const listing = await Listing.findById(listingId).select("seller owner messages");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);

        const sellerId = getListingSellerId(listing);
        if (sellerId !== req.user.id) {
            return res.status(403).json({ message: "Only the seller can mark messages as read." });
        }

        let updated = 0;
        listing.messages.forEach((message) => {
            const senderId = normalizeMessageSenderId(message);
            if (senderId && senderId !== sellerId && !message.readBySeller) {
                message.readBySeller = true;
                updated += 1;
            }
        });

        if (updated > 0) {
            await listing.save();
        }

        return res.json({
            message: "Messages marked as read.",
            updated
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/:id/messages", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        const listing = await Listing.findById(listingId)
            .select("seller owner messages")
            .populate("messages.sender", "name email phoneNumber city");

        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);

        const isSeller = getListingSellerId(listing) === req.user.id;
        const hasConversation = listing.messages.some(
            (message) => normalizeMessageSenderId(message) === req.user.id
        );

        if (!isSeller && !hasConversation) {
            return res.status(403).json({ message: "You are not allowed to view these messages." });
        }

        if (isSeller) {
            let updated = 0;
            listing.messages.forEach((message) => {
                const senderId = normalizeMessageSenderId(message);
                if (senderId && senderId !== req.user.id && !message.readBySeller) {
                    message.readBySeller = true;
                    updated += 1;
                }
            });
            if (updated > 0) {
                await listing.save();
            }
        }

        const messages = isSeller
            ? listing.messages
            : listing.messages.filter(
                  (msg) => normalizeMessageSenderId(msg) === req.user.id
              );

        return res.json({
            messages,
            isSeller
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/:id/pay", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        if (!PAYMENTS_ENABLED) {
            return res.status(410).json({
                message:
                    "Online payments are disabled in this phase. Please arrange payment directly with the seller."
            });
        }

        const listing = await Listing.findById(listingId).select(
            "seller owner category price status title availability deliveryAvailable messages"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }
        ensureListingSeller(listing);
        const sellerId = getListingSellerId(listing);
        if (!sellerId) {
            return res.status(400).json({ message: "Listing seller is missing. Please contact support." });
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

        if (sellerId === req.user.id) {
            return res.status(400).json({ message: "You cannot pay for your own listing." });
        }

        if (isServiceListing(listing)) {
            return res.status(400).json({
                message:
                    "Service listings are connection-only on TradeCircle. In-app payment is not used for this category."
            });
        }

        if (!buyerHasAcceptedOfferWithSeller(listing, req.user.id)) {
            return res.status(400).json({
                message:
                    "In-app payment starts only after the seller accepts your offer."
            });
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
                adjustReputation(sellerId, 2)
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
