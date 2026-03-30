const mongoose = require("mongoose");

const adminLogSchema = new mongoose.Schema(
    {
        actor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        actorRole: {
            type: String,
            enum: ["admin", "moderator"],
            required: true
        },
        action: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        targetType: {
            type: String,
            required: true,
            trim: true,
            maxlength: 60
        },
        targetId: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("AdminLog", adminLogSchema);
