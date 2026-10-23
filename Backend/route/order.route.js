const express = require("express");

const router = express.Router();

const {
    getOrders,
    getAdminOrders,
    getOrderById,
    cancelMyOrder,
    checkout,
    guestCheckout,
    getGuestOrder,
    cancelGuestOrder,
    updateStatus
} = require("../controller/order.controller");

const { authenticate } = require("../middlewares/auth.middleware");
const { authorize } = require("../middlewares/role.middleware");
const { createRateLimit } = require("../middlewares/rateLimit.middleware");
const guestCheckoutLimiter = createRateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 5, message: "Too many guest checkout attempts. Please try again later." });
const guestOrderReadLimiter = createRateLimit({ windowMs: 60 * 1000, maxRequests: 30, message: "Too many guest order requests. Please wait a moment." });


// New guest orders are intentionally disabled. Guests may keep a local cart, but must authenticate before placing an order.
router.post("/guest-checkout", guestCheckoutLimiter, guestCheckout);
router.get("/guest/:id", guestOrderReadLimiter, getGuestOrder);
router.patch("/guest/:id/cancel", guestOrderReadLimiter, cancelGuestOrder);

// Get all orders belonging to the authenticated user
router.get(
    "/",
    authenticate,
    getOrders
);


// Admin: list orders for fulfilment and payment management.
router.get(
    "/admin",
    authenticate,
    authorize("admin"),
    getAdminOrders
);


// Checkout the authenticated user's cart
router.post(
    "/checkout",
    authenticate,
    checkout
);


// Update order status (Admin only)
router.patch(
    "/:id/status",
    authenticate,
    authorize("admin"),
    updateStatus
);


// Customer cancellation is limited by the service to their own pending/confirmed, unpaid orders.
router.patch(
    "/:id/cancel",
    authenticate,
    cancelMyOrder
);


// Get a specific order belonging to the authenticated user
router.get(
    "/:id",
    authenticate,
    getOrderById
);


module.exports = router;