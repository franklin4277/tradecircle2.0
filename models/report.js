const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
    {
        listing: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Listing",
            required: true,
            index: true
        },
        reporter: {
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
        reason: {
            type: String,
            required: true,
            enum: ["Scam", "Fake Product", "Abusive Content", "Spam", "Other"]
        },
        notes: {
            type: String,
            trim: true,
            maxlength: 500,
            default: ""
        }
    },
    { timestamps: true }
);

reportSchema.index({ listing: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model("Report", reportSchema);
