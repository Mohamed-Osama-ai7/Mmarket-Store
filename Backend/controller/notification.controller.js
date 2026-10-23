const mongoose = require("mongoose");
const Notification = require("../model/notification.model");

const positiveInteger = (value, fallback, maximum) => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
};

exports.getMyNotifications = async (req, res, next) => {
    try {
        const page = positiveInteger(req.query.page, 1, 100000);
        const pageSize = positiveInteger(req.query.pageSize, 20, 50);
        if (page === null || pageSize === null) {
            return res.status(400).json({ error: "page must be positive and pageSize must be between 1 and 50" });
        }
        const recipient = req.user._id;
        const [notifications, totalItems, unreadCount] = await Promise.all([
            Notification.find({ recipient }).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
            Notification.countDocuments({ recipient }),
            Notification.countDocuments({ recipient, readAt: null })
        ]);
        return res.status(200).json({
            message: "Notifications retrieved successfully",
            data: notifications,
            unreadCount,
            pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }
        });
    } catch (error) {
        return next(error);
    }
};

exports.markNotificationRead = async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ error: "Invalid notification ID" });
        }
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user._id, readAt: null },
            { $set: { readAt: new Date() } },
            { new: true }
        ).lean();
        if (!notification) {
            const existing = await Notification.exists({ _id: req.params.id, recipient: req.user._id });
            if (!existing) return res.status(404).json({ error: "Notification not found" });
            return res.status(200).json({ message: "Notification already read", data: existing });
        }
        return res.status(200).json({ message: "Notification marked as read", data: notification });
    } catch (error) {
        return next(error);
    }
};

exports.markAllNotificationsRead = async (req, res, next) => {
    try {
        const result = await Notification.updateMany(
            { recipient: req.user._id, readAt: null },
            { $set: { readAt: new Date() } }
        );
        return res.status(200).json({
            message: "Notifications marked as read",
            data: { updatedCount: result.modifiedCount }
        });
    } catch (error) {
        return next(error);
    }
};
