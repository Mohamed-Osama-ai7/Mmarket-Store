const Notification = require("../model/notification.model");
const User = require("../model/user.model");
const logger = require("./logger");
const { getIO } = require("./socket");

async function notifyUser({ recipient, type, title, message, link = "/orders" }) {
    try {
        if (!recipient) return null;
        const notification = await Notification.create({ recipient, type, title, message, link });
        const safeNotification = notification.toObject();
        const io = getIO();
        if (io) io.to(`user:${String(recipient)}`).emit("notification:new", safeNotification);
        return safeNotification;
    } catch (error) {
        // Notifications are secondary to order/payment state changes and must not roll those back.
        logger.logError("notifications.publish.failed", error, { event: "notifications.publish.failed" });
        return null;
    }
}

async function notifyAdministrators(notification) {
    try {
        const administrators = await User.find({ role: "admin", isActive: true }).select("_id").lean();
        await Promise.all(administrators.map(user => notifyUser({ ...notification, recipient: user._id })));
    } catch (error) {
        logger.logError("notifications.admin_publish.failed", error, { event: "notifications.admin_publish.failed" });
    }
}

module.exports = { notifyUser, notifyAdministrators };
