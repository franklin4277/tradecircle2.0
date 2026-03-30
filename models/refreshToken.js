const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        tokenHash: {
            type: String,
            required: true,
            index: true
        },
        tokenId: {
            type: String,
            required: true,
            index: true
        },
        expiresAt: {
            type: Date,
            required: true
        },
        revokedAt: {
            type: Date,
            default: null
        },
        replacedByTokenId: {
            type: String,
            default: ""
        },
        userAgent: {
            type: String,
            trim: true,
            maxlength: 300,
            default: ""
        },
        ipAddress: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        }
    },
    { timestamps: true }
);

refreshTokenSchema.index({ user: 1, createdAt: -1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
