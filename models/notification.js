const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: [
                "message",
                "offer",
                "listing",
                "escrow",
                "fraud",
                "wallet",
                "system"
            ],
            default: "system"
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        body: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        },
        read: {
            type: Boolean,
            default: false,
            index: true
        },
        meta: {
            listingId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Listing",
                default: null
            },
            escrowId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Escrow",
                default: null
            },
            messageId: {
                type: String,
                trim: true,
                default: ""
            }
        }
    },
    { timestamps: true }
);

notificationSchema.index({ user: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
