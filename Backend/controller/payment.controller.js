const paymentService = require("../service/payment.service");
const logger = require("../utilities/logger");
const Order = require("../model/order.model");
const { notifyUser, notifyAdministrators } = require("../utilities/notificationPublisher");
const { sendOrderUpdateEmail } = require("../utilities/emailService");

// Get logged-in user's payments
exports.getPayments = async (req, res) => {
    try {
        const myPayments = await paymentService.getPayments(
            req.user.id
        );

        return res.status(200).json({
            message: "Payments retrieved successfully",
            data: myPayments
        });

    } catch (err) {
        logger.logError("payments.list.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Failed to retrieve payments",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};


// Get one payment belonging to the logged-in user
exports.getPaymentById = async (req, res) => {
    try {
        const myPayment = await paymentService.getPaymentById({
            userId: req.user.id,
            paymentId: req.params.id
        });

        return res.status(200).json({
            message: "Payment retrieved successfully",
            data: myPayment
        });

    } catch (err) {
        logger.logError("payments.get_by_id.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Failed to retrieve payment",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};


// Create a payment record
exports.createPayment = async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");

    if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim()
    ) {
        return res.status(400).json({
            error: "Idempotency-Key header is required"
        });
    }

    const cleanIdempotencyKey = idempotencyKey.trim();

    if (cleanIdempotencyKey.length > 200) {
        return res.status(400).json({
            error: "Idempotency key is too long"
        });
    }

    const { order, method } = req.body || {};

    if (!order || !method) {
        return res.status(400).json({
            error: "Order and payment method are required"
        });
    }

    try {
        const myPayment = await paymentService.createPayment({
            userId: req.user.id,
            orderId: order,
            method,
            idempotencyKey: cleanIdempotencyKey
        });

        return res.status(myPayment.alreadyCreated ? 200 : 201).json({
            message: myPayment.alreadyCreated
                ? "Payment already created"
                : "Payment created successfully",
            data: myPayment.payment
        });

    } catch (err) {
        logger.logError("payments.create.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Failed to create payment",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};


// Online-provider webhooks are intentionally disabled for this course project.
// Cash on delivery is recorded manually by an authorized administrator.
exports.handleWebhook = async (req, res) => {
    return res.status(503).json({
        error: "Online payment webhooks are not enabled. Cash on delivery is the only supported payment method."
    });
};


// Admin: list all payments for order fulfilment.
exports.getAdminPayments = async (req, res) => {
    try {
        const payments = await paymentService.getAdminPayments();
        return res.status(200).json({
            message: "Payments retrieved successfully",
            data: payments
        });
    } catch (err) {
        logger.logError("payments.admin_list.failed", err, { requestId: req.id, method: req.method });
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : "Failed to retrieve payments" });
    }
};

// Admin: confirm cash-on-delivery payment during order processing.
exports.confirmCashOnDelivery = async (req, res) => {
    try {
        const payment = await paymentService.confirmCashOnDelivery({ paymentId: req.params.id });
        const orderId = payment?.order?._id || payment?.order;
        const order = orderId ? await Order.findById(orderId).populate("user", "name email").lean() : null;
        if (order) {
            const recipient = order.user?._id || order.user;
            if (recipient) {
                await notifyUser({ recipient, type: "payment_status", title: "Cash payment confirmed", message: `Cash-on-delivery payment for order #${String(order._id).slice(-8).toUpperCase()} was confirmed.`, link: "/orders" });
                if (order.user && typeof order.user === "object") await sendOrderUpdateEmail({ user: order.user, order, subject: "Cash-on-delivery payment confirmed", message: "Your cash-on-delivery payment has been confirmed." });
            } else if (order.guestEmail) {
                await sendOrderUpdateEmail({ user: { name: order.guestName, email: order.guestEmail }, order, subject: "Cash-on-delivery payment confirmed", message: "Your cash-on-delivery payment has been confirmed." });
            }
            await notifyAdministrators({ type: "payment_status", title: "COD payment confirmed", message: `Payment confirmed for order #${String(order._id).slice(-8).toUpperCase()}.`, link: "/dashboard/orders" });
        }
        return res.status(200).json({ message: "Cash-on-delivery payment confirmed", data: payment });
    } catch (err) {
        logger.logError("payments.cod_confirmation.failed", err, { requestId: req.id, method: req.method });
        return res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : "Failed to confirm COD payment" });
    }
};
