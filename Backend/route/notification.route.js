const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const {
    getMyNotifications,
    markNotificationRead,
    markAllNotificationsRead
} = require("../controller/notification.controller");

const router = express.Router();
router.use(authenticate);
router.get("/", getMyNotifications);
router.patch("/read-all", markAllNotificationsRead);
router.patch("/:id/read", markNotificationRead);

module.exports = router;
