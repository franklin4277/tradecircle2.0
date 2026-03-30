const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
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
                "topup",
                "hold",
                "release_out",
                "release_in",
                "refund",
                "adjustment"
            ],
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        balanceAfter: {
            type: Number,
            required: true,
            min: 0
        },
        referenceType: {
            type: String,
            enum: ["escrow", "listing", "manual", "system"],
            default: "system"
        },
        referenceId: {
            type: String,
            default: ""
        },
        note: {
            type: String,
            trim: true,
            maxlength: 240,
            default: ""
        }
    },
    { timestamps: true }
);

walletTransactionSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
