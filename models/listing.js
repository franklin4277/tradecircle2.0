const mongoose = require("mongoose");

const listingMessageSchema = new mongoose.Schema(
    {
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        body: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    },
    { _id: false }
);

const listingSchema = new mongoose.Schema(
    {
        seller: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true,
            minlength: 3,
            maxlength: 120
        },
        description: {
            type: String,
            required: true,
            trim: true,
            minlength: 10,
            maxlength: 2500
        },
        price: {
            type: Number,
            required: true,
            min: 0
        },
        image: {
            type: String,
            default: ""
        },
        location: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80
        },
        status: {
            type: String,
            enum: ["pending", "approved", "rejected"],
            default: "pending",
            index: true
        },
        reportsCount: {
            type: Number,
            default: 0,
            min: 0
        },
        penalizedForReports: {
            type: Boolean,
            default: false
        },
        messages: [listingMessageSchema]
    },
    { timestamps: true }
);

listingSchema.index({ title: "text", description: "text" });

module.exports = mongoose.model("Listing", listingSchema);
