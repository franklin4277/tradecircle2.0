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
        const [totalUsers, totalListings, totalReports, pendingListings, approvedListings, rejectedListings] =
            await Promise.all([
                User.countDocuments(),
                Listing.countDocuments(),
                Report.countDocuments(),
                Listing.countDocuments({ status: "pending" }),
                Listing.countDocuments({ status: "approved" }),
                Listing.countDocuments({ status: "rejected" })
            ]);

        return res.json({
            totalUsers,
            totalListings,
            totalReports,
            pendingListings,
            approvedListings,
            rejectedListings
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/pending", async (req, res, next) => {
    try {
        const listings = await Listing.find({ status: "pending" })
            .populate("seller", "name email reputationScore")
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
            .populate("seller", "name email reputationScore")
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

        return res.json({ message: `Listing ${status}.` });
    } catch (error) {
        return next(error);
    }
});

router.get("/reports", async (req, res, next) => {
    try {
        const reports = await Report.find()
            .populate("listing", "title price location status reportsCount")
            .populate("reporter", "name email")
            .populate("seller", "name email reputationScore")
            .sort({ createdAt: -1 })
            .limit(300);

        return res.json({ reports });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
