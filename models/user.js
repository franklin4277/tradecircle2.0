const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: 2,
            maxlength: 80
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            maxlength: 120
        },
        password: {
            type: String,
            required: true,
            minlength: 6
        },
        phoneNumber: {
            type: String,
            trim: true,
            maxlength: 24,
            default: ""
        },
        city: {
            type: String,
            trim: true,
            maxlength: 80,
            default: ""
        },
        role: {
            type: String,
            enum: ["user", "moderator", "admin"],
            default: "user"
        },
        communityVerified: {
            type: Boolean,
            default: false
        },
        verificationNotes: {
            type: String,
            trim: true,
            maxlength: 200,
            default: ""
        },
        verifiedSeller: {
            type: Boolean,
            default: false
        },
        reputationScore: {
            type: Number,
            default: 100,
            min: 0,
            max: 1000
        },
        lastSeenAt: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

userSchema.set("toJSON", {
    transform: (_, ret) => {
        delete ret.password;
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model("User", userSchema);
