const mongoose = require("mongoose");

module.exports = mongoose.model("Listing", new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    price: { type: String, required: true, trim: true },
    category: { type: String, default: "Other", trim: true },
    location: { type: String, default: "All Kenya", trim: true },
    contactPlatform: {
        type: String,
        enum: ["Phone", "WhatsApp", "Telegram", "Email", "SMS", "Other"],
        default: "Phone"
    },
    picture: String, // URL or filename
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" }
}, { timestamps: true }));
