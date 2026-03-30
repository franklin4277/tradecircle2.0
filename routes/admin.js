const express = require("express");
const mongoose = require("mongoose");
const Listing = require("../models/listing");
const Report = require("../models/report");
const User = require("../models/user");
const { auth, requireRole } = require("../middleware/auth");
const { adjustReputation } = require("../utils/reputation");

const router = express.Router();

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
}

router.use(auth, requireRole("admin"));

router.get("/analytics", async (req, res, next) => {
    try {
        const [
            totalUsers,
            totalListings,
            totalReports,
            pendingListings,
            approvedListings,
            rejectedListings,
            soldListings,
            flaggedListings,
            avgPriceAggregation,
            avgReputationAggregation
        ] = await Promise.all([
            User.countDocuments(),
            Listing.countDocuments(),
            Report.countDocuments(),
            Listing.countDocuments({ status: "pending" }),
            Listing.countDocuments({ status: "approved" }),
            Listing.countDocuments({ status: "rejected" }),
            Listing.countDocuments({ availability: "sold" }),
            Listing.countDocuments({ reportsCount: { $gte: 2 } }),
            Listing.aggregate([{ $group: { _id: null, avgPrice: { $avg: "$price" } } }]),
            User.aggregate([{ $group: { _id: null, avgReputation: { $avg: "$reputationScore" } } }])
        ]);

        const avgPrice = Number((avgPriceAggregation[0] && avgPriceAggregation[0].avgPrice) || 0);
        const avgReputation = Number(
            (avgReputationAggregation[0] && avgReputationAggregation[0].avgReputation) || 0
        );

        return res.json({
            totalUsers,
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

        const listing = await Listing.findById(listingId).select("status seller");
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        const previousStatus = listing.status;
        listing.status = status;
        await listing.save();

        if (previousStatus !== "approved" && status === "approved") {
            await adjustReputation(listing.seller, 5);
        }

        if (previousStatus === "approved" && status === "rejected") {
            await adjustReputation(listing.seller, -3);
        }

        if (status === "approved") {
            const approvedCount = await Listing.countDocuments({
                seller: listing.seller,
                status: "approved"
            });
            const seller = await User.findById(listing.seller).select("reputationScore verifiedSeller");
            if (seller && !seller.verifiedSeller && seller.reputationScore >= 140 && approvedCount >= 3) {
                seller.verifiedSeller = true;
                await seller.save();
            }
        }

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

module.exports = router;
