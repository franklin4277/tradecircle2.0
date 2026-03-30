const express = require("express");
const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Report = require("../models/report");
const User = require("../models/user");
const AdminLog = require("../models/adminLog");
const { auth, requireRole } = require("../middleware/auth");
const { adjustReputation } = require("../utils/reputation");

const router = express.Router();

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
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

function parseOptionalBoolean(value) {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) {
        return null;
    }
    if (["true", "1", "yes", "on"].includes(raw)) {
        return true;
    }
    if (["false", "0", "no", "off"].includes(raw)) {
        return false;
    }
    return null;
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getListingSellerId(listing) {
    return String(listing?.seller || listing?.owner || "");
}

async function writeAdminLog(req, action, targetType, targetId, metadata = {}) {
    try {
        await AdminLog.create({
            actor: req.user.id,
            actorRole: req.user.role === "admin" ? "admin" : "moderator",
            action,
            targetType,
            targetId: String(targetId || ""),
            metadata
        });
    } catch {
        // Logging should not block moderator/admin operations.
    }
}

router.use(auth, requireRole("admin", "moderator"));

router.get("/analytics", async (req, res, next) => {
    try {
        const [
            totalUsers,
            totalModerators,
            totalListings,
            totalReports,
            pendingListings,
            approvedListings,
            rejectedListings,
            soldListings,
            flaggedListings,
            verifiedUsers,
            avgPriceAggregation,
            avgReputationAggregation
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ role: "moderator" }),
            Listing.countDocuments(),
            Report.countDocuments(),
            Listing.countDocuments({ status: "pending" }),
            Listing.countDocuments({ status: "approved" }),
            Listing.countDocuments({ status: "rejected" }),
            Listing.countDocuments({ availability: "sold" }),
            Listing.countDocuments({ reportsCount: { $gte: 2 } }),
            User.countDocuments({ communityVerified: true }),
            Listing.aggregate([{ $group: { _id: null, avgPrice: { $avg: "$price" } } }]),
            User.aggregate([{ $group: { _id: null, avgReputation: { $avg: "$reputationScore" } } }])
        ]);

        const avgPrice = Number((avgPriceAggregation[0] && avgPriceAggregation[0].avgPrice) || 0);
        const avgReputation = Number(
            (avgReputationAggregation[0] && avgReputationAggregation[0].avgReputation) || 0
        );

        return res.json({
            totalUsers,
            totalModerators,
            verifiedUsers,
            pendingVerification: Math.max(totalUsers - verifiedUsers, 0),
            totalListings,
            totalReports,
            pendingListings,
            approvedListings,
            rejectedListings,
            soldListings,
            flaggedListings,
            averagePrice: Number(avgPrice.toFixed(2)),
            averageReputation: Number(avgReputation.toFixed(1))
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/pending", async (req, res, next) => {
    try {
        const listings = await Listing.find({ status: "pending" })
            .populate("seller", "name email reputationScore verifiedSeller city")
            .sort({ createdAt: -1 });

        return res.json({ listings });
    } catch (error) {
        return next(error);
    }
});

router.get("/listings", async (req, res, next) => {
    try {
        const status = String(req.query.status || "").trim();
        const validStatuses = ["pending", "approved", "rejected"];

        const query = validStatuses.includes(status) ? { status } : {};

        const listings = await Listing.find(query)
            .populate("seller", "name email reputationScore verifiedSeller city")
            .sort({ createdAt: -1 });

        return res.json({ listings });
    } catch (error) {
        return next(error);
    }
});

router.patch("/listings/:id/status", async (req, res, next) => {
    try {
        const listingId = String(req.params.id || "").trim();
        const status = String(req.body.status || "").trim();

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID." });
        }

        if (!["approved", "rejected"].includes(status)) {
            return res.status(400).json({ message: "Status must be approved or rejected." });
        }

        const listing = await Listing.findById(listingId).select("status seller owner");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        const sellerId = getListingSellerId(listing);
        if (!sellerId) {
            return res.status(400).json({ message: "Listing seller is missing." });
        }

        const previousStatus = listing.status;
        listing.status = status;
        if (!listing.seller && listing.owner) {
            listing.seller = listing.owner;
        }
        await listing.save();

        if (previousStatus !== "approved" && status === "approved") {
            await adjustReputation(sellerId, 5);
        }

        if (previousStatus === "approved" && status === "rejected") {
            await adjustReputation(sellerId, -3);
        }

        if (status === "approved") {
            const approvedCount = await Listing.countDocuments({
                $or: [{ seller: sellerId }, { owner: sellerId }],
                status: "approved"
            });
            const seller = await User.findById(sellerId).select("reputationScore verifiedSeller");
            if (seller && !seller.verifiedSeller && seller.reputationScore >= 140 && approvedCount >= 3) {
                seller.verifiedSeller = true;
                await seller.save();
            }
        }

        await writeAdminLog(req, "listing_status_change", "listing", listingId, {
            previousStatus,
            nextStatus: status
        });

        return res.json({ message: `Listing ${status}.` });
    } catch (error) {
        return next(error);
    }
});

router.get("/reports", async (req, res, next) => {
    try {
        const reports = await Report.find()
            .populate(
                "listing",
                "title price location status reportsCount category itemCondition availability"
            )
            .populate("reporter", "name email")
            .populate("seller", "name email reputationScore verifiedSeller city")
            .sort({ createdAt: -1 })
            .limit(300);

        return res.json({ reports });
    } catch (error) {
        return next(error);
    }
});

router.get("/users", requireRole("admin"), async (req, res, next) => {
    try {
        const role = String(req.query.role || "").trim().toLowerCase();
        const verified = parseOptionalBoolean(req.query.verified);
        const search = String(req.query.search || "").trim();

        const query = {};
        if (["user", "moderator", "admin"].includes(role)) {
            query.role = role;
        }
        if (verified !== null) {
            query.communityVerified = verified;
        }
        if (search) {
            const escaped = escapeRegex(search);
            query.$or = [
                { name: { $regex: escaped, $options: "i" } },
                { email: { $regex: escaped, $options: "i" } }
            ];
        }

        const users = await User.find(query)
            .select("name email role communityVerified reputationScore verifiedSeller city lastSeenAt createdAt")
            .sort({ createdAt: -1 })
            .limit(500);

        return res.json({ users });
    } catch (error) {
        return next(error);
    }
});

router.patch("/users/:id/verify", requireRole("admin"), async (req, res, next) => {
    try {
        const userId = String(req.params.id || "").trim();
        if (!isValidObjectId(userId)) {
            return res.status(400).json({ message: "Invalid user ID." });
        }

        const communityVerified = parseBoolean(req.body.communityVerified, true);
        const verificationNotes = String(req.body.verificationNotes || "").trim();

        const user = await User.findById(userId).select(
            "name email role communityVerified verificationNotes"
        );
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        user.communityVerified = communityVerified || user.role !== "user";
        user.verificationNotes = verificationNotes;
        await user.save();

        await writeAdminLog(req, "user_verification_change", "user", userId, {
            communityVerified: user.communityVerified
        });

        return res.json({
            message: user.communityVerified
                ? "User verified for community access."
                : "User marked as unverified.",
            user
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/users/:id/role", requireRole("admin"), async (req, res, next) => {
    try {
        const userId = String(req.params.id || "").trim();
        const role = String(req.body.role || "").trim().toLowerCase();
        const allowAdminPromotion =
            String(process.env.ALLOW_ADMIN_PROMOTION || "")
                .trim()
                .toLowerCase() === "true";

        if (!isValidObjectId(userId)) {
            return res.status(400).json({ message: "Invalid user ID." });
        }
        if (!["user", "moderator", "admin"].includes(role)) {
            return res.status(400).json({ message: "Role must be user, moderator, or admin." });
        }

        const user = await User.findById(userId).select("role communityVerified");
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        if (role === "admin" && !allowAdminPromotion) {
            return res.status(403).json({
                message: "Promoting users to admin is disabled by server policy."
            });
        }

        if (String(user._id) === req.user.id && role !== "admin") {
            return res.status(400).json({ message: "You cannot remove your own admin role." });
        }

        if (user.role === "admin" && role !== "admin") {
            const totalAdmins = await User.countDocuments({ role: "admin" });
            if (totalAdmins <= 1) {
                return res.status(400).json({
                    message: "Cannot demote the last admin account."
                });
            }
        }

        const previousRole = user.role;
        user.role = role;
        if (["moderator", "admin"].includes(role)) {
            user.communityVerified = true;
        }
        await user.save();

        await writeAdminLog(req, "user_role_change", "user", userId, {
            previousRole,
            nextRole: role
        });

        return res.json({
            message: `User role updated to ${role}.`,
            user
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/logs", requireRole("admin"), async (req, res, next) => {
    try {
        const logs = await AdminLog.find()
            .populate("actor", "name email role")
            .sort({ createdAt: -1 })
            .limit(250);

        return res.json({ logs });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
