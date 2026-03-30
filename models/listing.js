const mongoose = require("mongoose");

const listingMessageSchema = new mongoose.Schema(
    {
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        type: {
            type: String,
            enum: ["message", "offer"],
            default: "message"
        },
        body: {
            type: String,
            required: true,
            trim: true,
            maxlength: 500
        },
        offerAmount: {
            type: Number,
            min: 0,
            default: null
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
        category: {
            type: String,
            enum: [
                "Electronics",
                "Vehicles",
                "Property",
                "Home & Furniture",
                "Fashion",
                "Jobs",
                "Services",
                "Agriculture",
                "Other"
            ],
            default: "Other"
        },
        itemCondition: {
            type: String,
            enum: ["Brand New", "Like New", "Used - Good", "Used - Fair", "Refurbished"],
            default: "Used - Good"
        },
        negotiable: {
            type: Boolean,
            default: true
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
        contactPhone: {
            type: String,
            required: true,
            trim: true,
            maxlength: 24
        },
        deliveryAvailable: {
            type: Boolean,
            default: false
        },
        meetupAvailable: {
            type: Boolean,
            default: true
        },
        availability: {
            type: String,
            enum: ["available", "reserved", "sold"],
            default: "available"
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
        viewsCount: {
            type: Number,
            default: 0,
            min: 0
        },
        messages: [listingMessageSchema]
    },
    { timestamps: true }
);

listingSchema.index({ title: "text", description: "text" });
listingSchema.index({ status: 1, category: 1, location: 1, price: 1 });

module.exports = mongoose.model("Listing", listingSchema);
