const Escrow = require("../models/escrow");
const Listing = require("../models/listing");
const User = require("../models/user");
const { createNotifications } = require("../utils/notifications");
const { roundMoney, recordWalletTransaction } = require("../utils/wallet");

const ACTIVE_ESCROW_STATUSES = ["funded", "shipped", "disputed"];
const REMINDER_LEAD_HOURS = Math.max(1, Number(process.env.ESCROW_REMINDER_LEAD_HOURS || 24));

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

function addEscrowEvent(escrow, action, userId, message) {
    escrow.events.push({
        action,
        by: userId,
        message: String(message || "").trim(),
        at: new Date()
    });
}

async function sendReminderNotifications(escrow, listingTitle) {
    await createNotifications([
        {
            userId: escrow.seller,
            type: "escrow",
            title: "Escrow Shipping Reminder",
            body: `Ship "${listingTitle}" before timeout to avoid auto-refund.`,
            listingId: escrow.listing,
            escrowId: escrow._id
        },
        {
            userId: escrow.buyer,
            type: "escrow",
            title: "Escrow Update",
            body: `Seller has been reminded to ship "${listingTitle}" before timeout.`,
            listingId: escrow.listing,
            escrowId: escrow._id
        }
    ]);
}

async function autoRefundExpiredEscrow(escrow, listingTitle, now) {
    const buyer = await User.findById(escrow.buyer).select("walletBalance walletHeldBalance");
    if (!buyer) {
        escrow.status = "disputed";
        addEscrowEvent(
            escrow,
            "disputed",
            escrow.seller,
            "Auto-review: buyer account missing during SLA timeout."
        );
        await escrow.save();
        return;
    }

    const totalHeld = roundMoney(escrow.totalHeld);
    const held = roundMoney(buyer.walletHeldBalance);
    if (held < totalHeld) {
        escrow.status = "disputed";
        addEscrowEvent(
            escrow,
            "disputed",
            escrow.seller,
            "Auto-review: held amount mismatch during timeout refund."
        );
        await escrow.save();
        return;
    }

    buyer.walletHeldBalance = roundMoney(held - totalHeld);
    buyer.walletBalance = roundMoney(roundMoney(buyer.walletBalance) + totalHeld);
    await buyer.save();

    await recordWalletTransaction({
        userId: buyer._id,
        type: "refund",
        amount: totalHeld,
        balanceAfter: buyer.walletBalance,
        referenceType: "escrow",
        referenceId: escrow._id,
        note: "Auto-refund after seller shipping deadline."
    });

    escrow.status = "refunded";
    escrow.resolution = "refund_to_buyer";
    escrow.autoRefundedAt = now;
    escrow.releasedAt = now;
    addEscrowEvent(
        escrow,
        "auto_refunded",
        escrow.buyer,
        "Seller did not ship before deadline. Funds auto-refunded to buyer."
    );
    await escrow.save();

    await restoreListingAvailabilityIfNeeded(escrow.listing);

    await createNotifications([
        {
            userId: escrow.buyer,
            type: "escrow",
            title: "Escrow Auto-Refunded",
            body: `Your escrow for "${listingTitle}" was refunded because seller did not ship in time.`,
            listingId: escrow.listing,
            escrowId: escrow._id
        },
        {
            userId: escrow.seller,
            type: "escrow",
            title: "Escrow Timed Out",
            body: `Escrow for "${listingTitle}" was auto-refunded due to missed shipping deadline.`,
            listingId: escrow.listing,
            escrowId: escrow._id
        }
    ]);
}

async function processEscrowSlaTick() {
    const now = new Date();
    const reminderDeadline = new Date(now.getTime() + REMINDER_LEAD_HOURS * 60 * 60 * 1000);

    const [pendingReminders, timedOutEscrows] = await Promise.all([
        Escrow.find({
            status: "funded",
            shipByAt: { $gt: now, $lte: reminderDeadline },
            reminderSentAt: null
        }).populate("listing", "title"),
        Escrow.find({
            status: "funded",
            shipByAt: { $lte: now }
        }).populate("listing", "title")
    ]);

    for (const escrow of pendingReminders) {
        const listingTitle = escrow.listing && escrow.listing.title ? escrow.listing.title : "Listing";
        escrow.reminderSentAt = now;
        addEscrowEvent(escrow, "reminder", escrow.seller, "Seller reminder sent before timeout.");
        await escrow.save();
        await sendReminderNotifications(escrow, listingTitle);
    }

    for (const escrow of timedOutEscrows) {
        const listingTitle = escrow.listing && escrow.listing.title ? escrow.listing.title : "Listing";
        await autoRefundExpiredEscrow(escrow, listingTitle, now);
    }

    return {
        remindersSent: pendingReminders.length,
        autoRefunded: timedOutEscrows.length
    };
}

function startEscrowSlaWorker() {
    const intervalMs = Math.max(60 * 1000, Number(process.env.ESCROW_SLA_INTERVAL_MS || 5 * 60 * 1000));
    const timer = setInterval(() => {
        processEscrowSlaTick().catch(() => null);
    }, intervalMs);
    timer.unref();
    return timer;
}

module.exports = {
    processEscrowSlaTick,
    startEscrowSlaWorker
};
