const Notification = require("../models/notification");

async function createNotification({
    userId,
    type = "system",
    title,
    body,
    listingId = null,
    escrowId = null,
    messageId = ""
}) {
    if (!userId || !title || !body) {
        return null;
    }

    return Notification.create({
        user: userId,
        type,
        title: String(title || "").trim(),
        body: String(body || "").trim(),
        meta: {
            listingId,
            escrowId,
            messageId: String(messageId || "")
        }
    });
}

async function createNotifications(notifications = []) {
    if (!Array.isArray(notifications) || notifications.length === 0) {
        return [];
    }

    const valid = notifications.filter(
        (item) => item && item.userId && item.title && item.body
    );
    if (!valid.length) {
        return [];
    }

    const docs = valid.map((item) => ({
        user: item.userId,
        type: item.type || "system",
        title: String(item.title || "").trim(),
        body: String(item.body || "").trim(),
        meta: {
            listingId: item.listingId || null,
            escrowId: item.escrowId || null,
            messageId: String(item.messageId || "")
        }
    }));

    return Notification.insertMany(docs, { ordered: false });
}

module.exports = {
    createNotification,
    createNotifications
};
