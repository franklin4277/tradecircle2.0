const mongoose = require("mongoose");

module.exports = mongoose.model("User", new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, required: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    contact: { type: String, default: "" }, // phone or other contact info
    profile: {
        bio: { type: String, default: "", trim: true },
        location: { type: String, default: "", trim: true }
    },
    role: { type: String, enum: ["user", "admin"], default: "user" }
}, { timestamps: true }));
