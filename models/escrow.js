const mongoose = require("mongoose");

const escrowEventSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            trim: true,
            maxlength: 60
        },
        by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        message: {
            type: String,
            trim: true,
            maxlength: 400,
            default: ""
        },
        at: {
            type: Date,
            default: Date.now
        }
    },
    { _id: false }
);

const escrowSchema = new mongoose.Schema(
    {
        listing: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Listing",
            required: true,
            index: true
        },
        buyer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        seller: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        amount: {
            type: Number,
            required: true,
            min: 1
        },
        serviceFee: {
            type: Number,
            required: true,
            min: 0
        },
        totalHeld: {
            type: Number,
            required: true,
            min: 1
        },
        currency: {
            type: String,
            default: "KES",
            trim: true,
            maxlength: 8
        },
        status: {
            type: String,
            enum: ["funded", "shipped", "released", "disputed", "cancelled", "refunded"],
            default: "funded",
            index: true
        },
        buyerNote: {
            type: String,
            trim: true,
            maxlength: 400,
            default: ""
        },
        disputeReason: {
            type: String,
            trim: true,
            maxlength: 400,
            default: ""
        },
        disputeOpenedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        resolution: {
            type: String,
            enum: ["none", "release_to_seller", "refund_to_buyer"],
            default: "none"
        },
        releasedAt: {
            type: Date,
            default: null
        },
        shipByAt: {
            type: Date,
            default: null,
            index: true
        },
        reminderSentAt: {
            type: Date,
            default: null
        },
        autoRefundedAt: {
            type: Date,
            default: null
        },
        events: [escrowEventSchema]
    },
    { timestamps: true }
);

escrowSchema.index({ listing: 1, buyer: 1, status: 1 });

module.exports = mongoose.model("Escrow", escrowSchema);
