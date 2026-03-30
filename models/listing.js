const mongoose = require("mongoose");

const listingMessageSchema = new mongoose.Schema(
    {
        messageId: {
            type: String,
            trim: true,
            maxlength: 64,
            default: ""
        },
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        senderName: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        },
        senderEmail: {
            type: String,
            trim: true,
            maxlength: 120,
            default: ""
        },
        senderPhone: {
            type: String,
            trim: true,
            maxlength: 24,
            default: ""
        },
        senderCity: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        },
        readBySeller: {
            type: Boolean,
            default: false
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
        offerStatus: {
            type: String,
            enum: ["pending", "accepted", "rejected", "withdrawn"],
            default: "pending"
        },
        offerDecisionBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        offerDecisionAt: {
            type: Date,
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
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
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
        listingType: {
            type: String,
            enum: ["item", "service"],
            default: "item",
            index: true
        },
        itemCondition: {
            type: String,
            enum: ["Brand New", "Like New", "Used - Good", "Used - Fair", "Refurbished"],
            default: "Used - Good"
        },
        serviceRateType: {
            type: String,
            enum: ["fixed", "hourly", "daily", "negotiable"],
            default: "fixed"
        },
        serviceRemoteAvailable: {
            type: Boolean,
            default: false
        },
        serviceResponseTimeHours: {
            type: Number,
            min: 1,
            max: 168,
            default: 24
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
            required: false,
            trim: true,
            maxlength: 24,
            default: ""
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
        riskScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0
        },
        riskLevel: {
            type: String,
            enum: ["low", "medium", "high"],
            default: "low"
        },
        riskFlags: {
            type: [String],
            default: []
        },
        flaggedForFraud: {
            type: Boolean,
            default: false,
            index: true
        },
        messages: [listingMessageSchema]
    },
    { timestamps: true }
);

listingSchema.index({ title: "text", description: "text" });
listingSchema.index({ status: 1, category: 1, location: 1, price: 1 });

listingSchema.pre("validate", function setLegacySeller() {
    if (!this.seller && this.owner) {
        this.seller = this.owner;
    }

    if (String(this.category || "").toLowerCase() === "services") {
        this.listingType = "service";
        this.itemCondition = "Used - Good";
        this.deliveryAvailable = false;
        this.availability = "available";
    } else {
        this.listingType = "item";
    }
});

module.exports = mongoose.model("Listing", listingSchema);
