const express = require("express");

const router = express.Router();

const {
    getPayments,
    getAdminPayments,
    confirmCashOnDelivery,
    getPaymentById,
    createPayment,
    handleWebhook
} = require("../controller/payment.controller");

const { authenticate } = require("../middlewares/auth.middleware");
const { authorize } = require("../middlewares/role.middleware");


// Disabled online-payment webhook (COD-only project)
router.post(
    "/webhook",
    handleWebhook
);


// Admin endpoints must be registered before the dynamic payment ID route.
router.get(
    "/admin",
    authenticate,
    authorize("admin"),
    getAdminPayments
);

router.patch(
    "/:id/confirm-cash-on-delivery",
    authenticate,
    authorize("admin"),
    confirmCashOnDelivery
);


// Get logged-in user's payments
router.get(
    "/",
    authenticate,
    getPayments
);


// Get logged-in user's payment by ID
router.get(
    "/:id",
    authenticate,
    getPaymentById
);


// Create a payment
router.post(
    "/",
    authenticate,
    createPayment
);


module.exports = router;