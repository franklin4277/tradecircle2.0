const express = require("express");
const mongoose = require("mongoose");
const Notification = require("../models/notification");
const { auth } = require("../middleware/auth");

const router = express.Router();

function isValidObjectId(value) {
    return mongoose.Types.ObjectId.isValid(String(value || ""));
}

router.use(auth);

router.get("/", async (req, res, next) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
        const notifications = await Notification.find({ user: req.user.id })
            .sort({ createdAt: -1 })
            .limit(limit);

        const unreadCount = await Notification.countDocuments({
            user: req.user.id,
            read: false
        });

        return res.json({
            notifications,
            unreadCount
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/:id/read", async (req, res, next) => {
    try {
        const notificationId = String(req.params.id || "").trim();
        if (!isValidObjectId(notificationId)) {
            return res.status(400).json({ message: "Invalid notification ID." });
        }

        const notification = await Notification.findOne({
            _id: notificationId,
            user: req.user.id
        });
        if (!notification) {
            return res.status(404).json({ message: "Notification not found." });
        }

        notification.read = true;
        await notification.save();

        const unreadCount = await Notification.countDocuments({
            user: req.user.id,
            read: false
        });

        return res.json({
            message: "Notification marked as read.",
            unreadCount
        });
    } catch (error) {
        return next(error);
    }
});

router.patch("/read-all", async (req, res, next) => {
    try {
        await Notification.updateMany(
            { user: req.user.id, read: false },
            { $set: { read: true } }
        );

        return res.json({
            message: "All notifications marked as read.",
            unreadCount: 0
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
