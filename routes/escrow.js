const express = require("express");
const mongoose = require("mongoose");
const Escrow = require("../models/escrow");
const Listing = require("../models/listing");
const User = require("../models/user");
const WalletTransaction = require("../models/walletTransaction");
const { auth, requireRole, requireCommunityVerified } = require("../middleware/auth");
const { adjustReputation } = require("../utils/reputation");
const { roundMoney, recordWalletTransaction } = require("../utils/wallet");
const { createNotification, createNotifications } = require("../utils/notifications");

const router = express.Router();

const ACTIVE_ESCROW_STATUSES = ["funded", "shipped", "disputed"];
const ESCROW_FEE_PERCENT = Math.max(0, Number(process.env.ESCROW_FEE_PERCENT || 2));

function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function getListingSellerId(listing) {
    if (!listing) {
        return "";
    }
    const seller = listing.seller || listing.owner;
    return seller ? String(seller) : "";
}

function isServiceListing(listing) {
    return String(listing && listing.category ? listing.category : "")
        .trim()
        .toLowerCase() === "services";
}

function buyerHasAcceptedOfferWithSeller(listing, buyerId) {
    const buyer = String(buyerId || "");
    if (!buyer) {
        return false;
    }

    const messages = Array.isArray(listing && listing.messages) ? listing.messages : [];
    return messages.some((message) => {
        const senderId = String(message && message.sender ? message.sender : "");
        return (
            senderId === buyer &&
            String(message.type || "") === "offer" &&
            String(message.offerStatus || "pending") === "accepted"
        );
    });
}

function buildWalletSnapshot(user) {
    return {
        available: roundMoney(user && user.walletBalance),
        held: roundMoney(user && user.walletHeldBalance)
    };
}

function addEscrowEvent(escrow, action, userId, message = "") {
    escrow.events.push({
        action,
        by: userId,
        message: String(message || "").trim(),
        at: new Date()
    });
}

async function restoreListingAvailabilityIfNeeded(listingId) {
    const [activeCount, listing] = await Promise.all([
        Escrow.countDocuments({
            listing: listingId,
            status: { $in: ACTIVE_ESCROW_STATUSES }
        }),
        Listing.findById(listingId).select("availability")
    ]);

    if (!listing) {
        return;
    }

    if (activeCount === 0 && listing.availability === "reserved") {
        listing.availability = "available";
        await listing.save();
    }
}

async function loadWalletUser(userId) {
    return User.findById(userId).select("walletBalance walletHeldBalance");
}

async function holdBuyerFundsForEscrow(buyerId, totalHeld) {
    const buyer = await loadWalletUser(buyerId);
    if (!buyer) {
        return { ok: false, code: 404, message: "Buyer account not found." };
    }

    const available = roundMoney(buyer.walletBalance);
    const amountToHold = roundMoney(totalHeld);

    if (available < amountToHold) {
        return {
            ok: false,
            code: 400,
            message: `Insufficient wallet balance. Top up at least KES ${roundMoney(
                amountToHold - available
            ).toFixed(2)} to continue.`,
            buyer
        };
    }

    buyer.walletBalance = roundMoney(available - amountToHold);
    buyer.walletHeldBalance = roundMoney(roundMoney(buyer.walletHeldBalance) + amountToHold);
    await buyer.save();
    await recordWalletTransaction({
        userId: buyer._id,
        type: "hold",
        amount: -amountToHold,
        balanceAfter: buyer.walletBalance,
        referenceType: "escrow",
        note: "Funds moved to secure hold."
    });

    return {
        ok: true,
        buyer
    };
}

async function refundBuyerHeldFunds(buyerId, totalHeld) {
    const buyer = await loadWalletUser(buyerId);
    if (!buyer) {
        return { ok: false, code: 404, message: "Buyer account not found." };
    }

    const amountToRefund = roundMoney(totalHeld);
    const held = roundMoney(buyer.walletHeldBalance);
    if (held < amountToRefund) {
        return {
            ok: false,
            code: 409,
            message: "Wallet hold mismatch. Contact admin for manual review."
        };
    }

    buyer.walletHeldBalance = roundMoney(held - amountToRefund);
    buyer.walletBalance = roundMoney(roundMoney(buyer.walletBalance) + amountToRefund);
    await buyer.save();
    await recordWalletTransaction({
        userId: buyer._id,
        type: "refund",
        amount: amountToRefund,
        balanceAfter: buyer.walletBalance,
        referenceType: "escrow",
        note: "Escrow refund returned to wallet."
    });

    return {
        ok: true,
        buyer
    };
}

async function releaseHeldFundsToSeller(escrow) {
    const [buyer, seller] = await Promise.all([
        loadWalletUser(escrow.buyer),
        loadWalletUser(escrow.seller)
    ]);

    if (!buyer || !seller) {
        return {
            ok: false,
            code: 404,
            message: "Buyer or seller account was not found."
        };
    }

    const totalHeld = roundMoney(escrow.totalHeld);
    const held = roundMoney(buyer.walletHeldBalance);
    if (held < totalHeld) {
        return {
            ok: false,
            code: 409,
            message: "Buyer held balance is lower than escrow amount. Admin review required."
        };
    }

    buyer.walletHeldBalance = roundMoney(held - totalHeld);
    seller.walletBalance = roundMoney(roundMoney(seller.walletBalance) + roundMoney(escrow.amount));

    await Promise.all([buyer.save(), seller.save()]);
    await Promise.all([
        recordWalletTransaction({
            userId: buyer._id,
            type: "release_out",
            amount: -totalHeld,
            balanceAfter: buyer.walletBalance,
            referenceType: "escrow",
            referenceId: escrow._id,
            note: "Escrow funds released to seller."
        }),
        recordWalletTransaction({
            userId: seller._id,
            type: "release_in",
            amount: roundMoney(escrow.amount),
            balanceAfter: seller.walletBalance,
            referenceType: "escrow",
            referenceId: escrow._id,
            note: "Escrow payout received."
        })
    ]);

    return {
        ok: true,
        buyer,
        seller
    };
}

router.get("/wallet", auth, async (req, res, next) => {
    try {
        const user = await loadWalletUser(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User account not found." });
        }

        return res.json({
            wallet: buildWalletSnapshot(user)
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/wallet/transactions", auth, async (req, res, next) => {
    try {
        const limit = Math.min(120, Math.max(1, Number(req.query.limit) || 40));
        const transactions = await WalletTransaction.find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .limit(limit);

        return res.json({ transactions });
    } catch (error) {
        return next(error);
    }
});

router.post("/wallet/topup", auth, async (req, res, next) => {
    try {
        const amountInput = Number(req.body.amount);
        const amount = roundMoney(amountInput);

        if (!Number.isFinite(amountInput) || amount <= 0) {
            return res.status(400).json({ message: "Top up amount must be a valid positive number." });
        }

        if (amount > 1000000) {
            return res.status(400).json({ message: "Top up amount is too high for one transaction." });
        }

        const user = await loadWalletUser(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User account not found." });
        }

        user.walletBalance = roundMoney(roundMoney(user.walletBalance) + amount);
        await user.save();
        await recordWalletTransaction({
            userId: user._id,
            type: "topup",
            amount,
            balanceAfter: user.walletBalance,
            referenceType: "manual",
            note: "Demo wallet top-up."
        });
        await createNotification({
            userId: user._id,
            type: "wallet",
            title: "Wallet Top-up Successful",
            body: `KES ${amount.toFixed(2)} has been added to your wallet.`
        });

        return res.status(201).json({
            message: `Wallet topped up with KES ${amount.toFixed(2)}.`,
            wallet: buildWalletSnapshot(user)
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/start", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const listingId = String(req.body.listingId || "").trim();
        const buyerNote = String(req.body.note || "").trim();
        const amountInput = Number(req.body.amount);

        if (!isValidObjectId(listingId)) {
            return res.status(400).json({ message: "Invalid listing ID for escrow." });
        }

        const listing = await Listing.findById(listingId).select(
            "seller owner title category price status availability messages"
        );
        if (!listing) {
            return res.status(404).json({ message: "Listing not found." });
        }

        const sellerId = getListingSellerId(listing);
        if (!sellerId) {
            return res.status(400).json({ message: "Listing seller is missing." });
        }
        if (sellerId === req.user.id) {
            return res.status(400).json({ message: "You cannot open escrow on your own listing." });
        }

        if (listing.status !== "approved") {
            return res.status(400).json({ message: "Escrow can only start for approved listings." });
        }
        if (listing.availability === "sold") {
            return res.status(400).json({ message: "This listing is already sold." });
        }
        if (isServiceListing(listing)) {
            return res.status(400).json({
                message:
                    "Service listings are for connection and scheduling. In-app escrow is not available."
            });
        }
        if (!buyerHasAcceptedOfferWithSeller(listing, req.user.id)) {
            return res.status(400).json({
                message:
                    "Secure hold starts only after the seller accepts your offer."
            });
        }

        const existingEscrow = await Escrow.findOne({
            listing: listing._id,
            buyer: req.user.id,
            status: { $in: ACTIVE_ESCROW_STATUSES }
        }).select("_id");
        if (existingEscrow) {
            return res.status(409).json({
                message: "You already have an active escrow for this listing."
            });
        }

        const activeEscrowForListing = await Escrow.findOne({
            listing: listing._id,
            status: { $in: ACTIVE_ESCROW_STATUSES }
        }).select("buyer");
        if (activeEscrowForListing) {
            return res.status(409).json({
                message: "This listing already has an active secure hold in progress."
            });
        }

        const amount = Number.isFinite(amountInput) && amountInput > 0 ? amountInput : Number(listing.price);
        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ message: "Escrow amount must be a valid positive number." });
        }

        const serviceFee = Number(((amount * ESCROW_FEE_PERCENT) / 100).toFixed(2));
        const totalHeld = Number((amount + serviceFee).toFixed(2));
        const holdResult = await holdBuyerFundsForEscrow(req.user.id, totalHeld);
        if (!holdResult.ok) {
            return res.status(holdResult.code).json({ message: holdResult.message });
        }

        const buyerBeforeWorkflow = {
            walletBalance: holdResult.buyer.walletBalance,
            walletHeldBalance: holdResult.buyer.walletHeldBalance
        };

        const shippingWindowHours = Math.max(1, Number(process.env.ESCROW_SHIP_WINDOW_HOURS || 72));
        const shipByAt = new Date(Date.now() + shippingWindowHours * 60 * 60 * 1000);

        let escrow;
        try {
            escrow = await Escrow.create({
                listing: listing._id,
                buyer: req.user.id,
                seller: sellerId,
                amount: Number(amount.toFixed(2)),
                serviceFee,
                totalHeld,
                buyerNote,
                shipByAt,
                status: "funded",
                events: [
                    {
                        action: "funded",
                        by: req.user.id,
                        message: "Buyer funded TradeCircle escrow."
                    }
                ]
            });

            if (listing.availability === "available") {
                listing.availability = "reserved";
            }
            listing.messages.push({
                sender: req.user.id,
                senderName: req.user.name || "",
                senderEmail: req.user.email || "",
                senderPhone: req.user.phoneNumber || "",
                senderCity: req.user.city || "",
                readBySeller: false,
                type: "message",
                body: `Buyer started a TradeCircle secure hold of KES ${amount.toFixed(
                    2
                )}. Funds are held by the platform until delivery is confirmed.`
            });
            await listing.save();

            await createNotifications([
                {
                    userId: req.user.id,
                    type: "escrow",
                    title: "Escrow Started",
                    body: `Secure hold for "${listing.title}" started successfully.`,
                    listingId: listing._id,
                    escrowId: escrow._id
                },
                {
                    userId: sellerId,
                    type: "escrow",
                    title: "Buyer Started Escrow",
                    body: `A buyer started secure hold for "${listing.title}". Ship before deadline.`,
                    listingId: listing._id,
                    escrowId: escrow._id
                }
            ]);
        } catch (workflowError) {
            if (escrow && escrow._id) {
                await Escrow.findByIdAndDelete(escrow._id).catch(() => null);
            }
            holdResult.buyer.walletBalance = roundMoney(
                buyerBeforeWorkflow.walletBalance + roundMoney(totalHeld)
            );
            holdResult.buyer.walletHeldBalance = Math.max(
                0,
                roundMoney(buyerBeforeWorkflow.walletHeldBalance - roundMoney(totalHeld))
            );
            await holdResult.buyer.save().catch(() => null);
            throw workflowError;
        }

        return res.status(201).json({
            message: "Funds held safely in TradeCircle escrow.",
            escrow,
            wallet: buildWalletSnapshot(holdResult.buyer)
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/mine", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const escrows = await Escrow.find({
            $or: [{ buyer: req.user.id }, { seller: req.user.id }]
        })
            .populate("listing", "title image location price availability status")
            .populate("buyer", "name email")
            .populate("seller", "name email")
            .sort({ updatedAt: -1 })
            .limit(250);

        return res.json({ escrows });
    } catch (error) {
        return next(error);
    }
});

router.get("/admin/disputes", auth, requireRole("admin", "moderator"), async (req, res, next) => {
    try {
        const escrows = await Escrow.find({ status: "disputed" })
            .populate("listing", "title image location price availability status")
            .populate("buyer", "name email")
            .populate("seller", "name email")
            .sort({ updatedAt: -1 })
            .limit(250);

        return res.json({ escrows });
    } catch (error) {
        return next(error);
    }
});

router.get("/:id", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const escrowId = String(req.params.id || "").trim();
        if (!isValidObjectId(escrowId)) {
            return res.status(400).json({ message: "Invalid escrow ID." });
        }

        const escrow = await Escrow.findById(escrowId)
            .populate("listing", "title image location price availability status")
            .populate("buyer", "name email")
            .populate("seller", "name email")
            .populate("events.by", "name role");

        if (!escrow) {
            return res.status(404).json({ message: "Escrow not found." });
        }

        const isParticipant =
            String(escrow.buyer?._id || escrow.buyer) === req.user.id ||
            String(escrow.seller?._id || escrow.seller) === req.user.id;
        const isStaff = ["admin", "moderator"].includes(req.user.role);

        if (!isParticipant && !isStaff) {
            return res.status(403).json({ message: "You cannot view this escrow." });
        }

        return res.json({ escrow });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/ship", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const escrowId = String(req.params.id || "").trim();
        if (!isValidObjectId(escrowId)) {
            return res.status(400).json({ message: "Invalid escrow ID." });
        }

        const escrow = await Escrow.findById(escrowId).select("seller buyer listing status events");
        if (!escrow) {
            return res.status(404).json({ message: "Escrow not found." });
        }
        if (String(escrow.seller) !== req.user.id) {
            return res.status(403).json({ message: "Only the seller can mark escrow as shipped." });
        }
        if (escrow.status !== "funded") {
            return res.status(400).json({ message: "Escrow can only be shipped from funded state." });
        }

        escrow.status = "shipped";
        addEscrowEvent(escrow, "shipped", req.user.id, "Seller marked order as shipped/ready.");
        await escrow.save();

        await createNotifications([
            {
                userId: escrow.buyer,
                type: "escrow",
                title: "Seller Marked Order Shipped",
                body: "Your escrow item was marked as shipped. Confirm delivery once received.",
                listingId: escrow.listing,
                escrowId: escrow._id
            },
            {
                userId: escrow.seller,
                type: "escrow",
                title: "Escrow Updated",
                body: "Shipment status recorded successfully.",
                listingId: escrow.listing,
                escrowId: escrow._id
            }
        ]);

        return res.json({
            message: "Escrow updated to shipped.",
            escrow
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/confirm", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const escrowId = String(req.params.id || "").trim();
        if (!isValidObjectId(escrowId)) {
            return res.status(400).json({ message: "Invalid escrow ID." });
        }

        const escrow = await Escrow.findById(escrowId).select(
            "buyer seller listing status events amount totalHeld resolution releasedAt"
        );
        if (!escrow) {
            return res.status(404).json({ message: "Escrow not found." });
        }
        if (String(escrow.buyer) !== req.user.id) {
            return res.status(403).json({ message: "Only the buyer can confirm delivery." });
        }
        if (escrow.status !== "shipped") {
            return res.status(400).json({ message: "Escrow must be shipped before confirmation." });
        }

        const transferResult = await releaseHeldFundsToSeller(escrow);
        if (!transferResult.ok) {
            return res.status(transferResult.code).json({ message: transferResult.message });
        }

        escrow.status = "released";
        escrow.releasedAt = new Date();
        escrow.resolution = "release_to_seller";
        addEscrowEvent(escrow, "released", req.user.id, "Buyer confirmed delivery. Funds released.");
        await escrow.save();

        await Promise.all([
            adjustReputation(escrow.buyer, 2),
            adjustReputation(escrow.seller, 4)
        ]);

        const listing = await Listing.findById(escrow.listing).select("availability");
        if (listing && listing.availability !== "sold") {
            listing.availability = "sold";
            await listing.save();
        }

        await createNotifications([
            {
                userId: escrow.buyer,
                type: "escrow",
                title: "Escrow Completed",
                body: "You confirmed delivery. Funds were released.",
                listingId: escrow.listing,
                escrowId: escrow._id
            },
            {
                userId: escrow.seller,
                type: "wallet",
                title: "Escrow Payout Received",
                body: "Delivery was confirmed and funds were released to your wallet.",
                listingId: escrow.listing,
                escrowId: escrow._id
            }
        ]);

        return res.json({
            message: "Delivery confirmed. Funds released to seller.",
            escrow,
            buyerWallet: buildWalletSnapshot(transferResult.buyer),
            sellerWallet: buildWalletSnapshot(transferResult.seller)
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/cancel", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const escrowId = String(req.params.id || "").trim();
        if (!isValidObjectId(escrowId)) {
            return res.status(400).json({ message: "Invalid escrow ID." });
        }

        const escrow = await Escrow.findById(escrowId).select(
            "buyer listing status events resolution totalHeld"
        );
        if (!escrow) {
            return res.status(404).json({ message: "Escrow not found." });
        }
        if (String(escrow.buyer) !== req.user.id) {
            return res.status(403).json({ message: "Only the buyer can cancel this escrow." });
        }
        if (escrow.status !== "funded") {
            return res.status(400).json({ message: "Escrow can only be cancelled before shipping." });
        }

        const refundResult = await refundBuyerHeldFunds(escrow.buyer, escrow.totalHeld);
        if (!refundResult.ok) {
            return res.status(refundResult.code).json({ message: refundResult.message });
        }

        escrow.status = "refunded";
        escrow.resolution = "refund_to_buyer";
        addEscrowEvent(escrow, "refunded", req.user.id, "Buyer cancelled escrow before shipping.");
        await escrow.save();

        await restoreListingAvailabilityIfNeeded(escrow.listing);
        await createNotifications([
            {
                userId: escrow.buyer,
                type: "wallet",
                title: "Escrow Cancelled",
                body: "Your escrow was cancelled and funds were refunded.",
                listingId: escrow.listing,
                escrowId: escrow._id
            },
            {
                userId: escrow.seller,
                type: "escrow",
                title: "Escrow Cancelled by Buyer",
                body: "Buyer cancelled the escrow before shipment.",
                listingId: escrow.listing,
                escrowId: escrow._id
            }
        ]);

        return res.json({
            message: "Escrow cancelled and buyer refunded.",
            escrow,
            buyerWallet: buildWalletSnapshot(refundResult.buyer)
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/dispute", auth, requireCommunityVerified, async (req, res, next) => {
    try {
        const escrowId = String(req.params.id || "").trim();
        const reason = String(req.body.reason || "").trim();

        if (!isValidObjectId(escrowId)) {
            return res.status(400).json({ message: "Invalid escrow ID." });
        }
        if (reason.length < 5 || reason.length > 400) {
            return res.status(400).json({
                message: "Dispute reason must be between 5 and 400 characters."
            });
        }

        const escrow = await Escrow.findById(escrowId).select(
            "buyer seller status disputeReason disputeOpenedBy events"
        );
        if (!escrow) {
            return res.status(404).json({ message: "Escrow not found." });
        }

        const isParticipant =
            String(escrow.buyer) === req.user.id || String(escrow.seller) === req.user.id;
        if (!isParticipant) {
            return res.status(403).json({ message: "Only escrow participants can raise disputes." });
        }

        if (!["funded", "shipped"].includes(escrow.status)) {
            return res.status(400).json({
                message: "Only funded or shipped escrows can be disputed."
            });
        }

        escrow.status = "disputed";
        escrow.disputeReason = reason;
        escrow.disputeOpenedBy = req.user.id;
        addEscrowEvent(escrow, "disputed", req.user.id, reason);
        await escrow.save();

        await createNotifications([
            {
                userId: escrow.buyer,
                type: "escrow",
                title: "Escrow Dispute Opened",
                body: "A dispute is now open for this escrow.",
                escrowId: escrow._id
            },
            {
                userId: escrow.seller,
                type: "escrow",
                title: "Escrow Dispute Opened",
                body: "A dispute is now open for this escrow.",
                escrowId: escrow._id
            }
        ]);

        return res.json({
            message: "Dispute opened. Admin/moderator review is now required.",
            escrow
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/resolve", auth, requireRole("admin", "moderator"), async (req, res, next) => {
    try {
        const escrowId = String(req.params.id || "").trim();
        const resolution = String(req.body.resolution || "").trim().toLowerCase();
        const note = String(req.body.note || "").trim();

        if (!isValidObjectId(escrowId)) {
            return res.status(400).json({ message: "Invalid escrow ID." });
        }
        if (!["release_to_seller", "refund_to_buyer"].includes(resolution)) {
            return res.status(400).json({
                message: "Resolution must be release_to_seller or refund_to_buyer."
            });
        }

        const escrow = await Escrow.findById(escrowId).select(
            "buyer seller listing status resolution releasedAt events amount totalHeld"
        );
        if (!escrow) {
            return res.status(404).json({ message: "Escrow not found." });
        }
        if (escrow.status !== "disputed") {
            return res.status(400).json({ message: "Only disputed escrows can be resolved." });
        }

        escrow.resolution = resolution;
        escrow.releasedAt = new Date();
        let buyerWallet = null;
        let sellerWallet = null;

        if (resolution === "release_to_seller") {
            const transferResult = await releaseHeldFundsToSeller(escrow);
            if (!transferResult.ok) {
                return res.status(transferResult.code).json({ message: transferResult.message });
            }

            escrow.status = "released";
            addEscrowEvent(
                escrow,
                "released",
                req.user.id,
                note || "Dispute resolved by staff. Funds released to seller."
            );
            buyerWallet = buildWalletSnapshot(transferResult.buyer);
            sellerWallet = buildWalletSnapshot(transferResult.seller);
            await Promise.all([
                adjustReputation(escrow.buyer, 1),
                adjustReputation(escrow.seller, 2)
            ]);

            const listing = await Listing.findById(escrow.listing).select("availability");
            if (listing && listing.availability !== "sold") {
                listing.availability = "sold";
                await listing.save();
            }
        } else {
            const refundResult = await refundBuyerHeldFunds(escrow.buyer, escrow.totalHeld);
            if (!refundResult.ok) {
                return res.status(refundResult.code).json({ message: refundResult.message });
            }

            escrow.status = "refunded";
            addEscrowEvent(
                escrow,
                "refunded",
                req.user.id,
                note || "Dispute resolved by staff. Buyer refunded."
            );
            buyerWallet = buildWalletSnapshot(refundResult.buyer);
            await restoreListingAvailabilityIfNeeded(escrow.listing);
        }

        await escrow.save();

        await createNotifications([
            {
                userId: escrow.buyer,
                type: "escrow",
                title: "Escrow Dispute Resolved",
                body:
                    resolution === "release_to_seller"
                        ? "Dispute resolved. Funds released to seller."
                        : "Dispute resolved. Funds refunded to your wallet.",
                listingId: escrow.listing,
                escrowId: escrow._id
            },
            {
                userId: escrow.seller,
                type: "escrow",
                title: "Escrow Dispute Resolved",
                body:
                    resolution === "release_to_seller"
                        ? "Dispute resolved. Funds released to your wallet."
                        : "Dispute resolved. Buyer refunded.",
                listingId: escrow.listing,
                escrowId: escrow._id
            }
        ]);

        return res.json({
            message:
                resolution === "release_to_seller"
                    ? "Escrow dispute resolved. Funds released to seller."
                    : "Escrow dispute resolved. Buyer refunded.",
            escrow,
            buyerWallet,
            sellerWallet
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
