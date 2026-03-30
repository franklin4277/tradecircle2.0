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
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user"
        },
        reputationScore: {
            type: Number,
            default: 100,
            min: 0,
            max: 1000
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
