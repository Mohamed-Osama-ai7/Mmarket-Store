const mongoose = require("mongoose");

const Payment = require("../model/payment.model");
const Order = require("../model/order.model");
const Product = require("../model/product.model");
const productListCache = require("../utilities/productListCache");

function createServiceError(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function isValidObjectId(id) {
    return (
        typeof id === "string" &&
        mongoose.Types.ObjectId.isValid(id) &&
        new mongoose.Types.ObjectId(id).toString() === id
    );
}

function getPaymentProvider() {
    const provider = process.env.PAYMENT_PROVIDER || "manual";

    const supportedProviders = ["manual"];

    if (!supportedProviders.includes(provider)) {
        throw createServiceError(
            "Unsupported payment provider configuration",
            500
        );
    }

    return provider;
}

function getPaymentDetails() {
    return [
        {
            path: "order",
            select: [
                "items",
                "subtotal",
                "discount",
                "total",
                "currency",
                "orderStatus",
                "paymentStatus",
                "refundStatus",
                "createdAt"
            ].join(" ")
        }
    ];
}

exports.getPayments = async (userId) => {
    if (!userId) {
        throw createServiceError("User ID is required", 400);
    }

    return Payment.find({ user: userId })
        .populate(getPaymentDetails())
        .sort({ createdAt: -1 })
        .lean();
};

exports.getPaymentById = async ({ userId, paymentId }) => {
    if (!userId) {
        throw createServiceError("User ID is required", 400);
    }

    if (!isValidObjectId(paymentId)) {
        throw createServiceError("Invalid payment ID", 400);
    }

    const payment = await Payment.findOne({
        _id: paymentId,
        user: userId
    }).populate(getPaymentDetails());

    if (!payment) {
        throw createServiceError("Payment not found", 404);
    }

    return payment;
};

exports.createPayment = async ({
    userId,
    orderId,
    method,
    idempotencyKey
}) => {
    if (!userId) {
        throw createServiceError("User ID is required", 400);
    }

    if (!isValidObjectId(orderId)) {
        throw createServiceError("Invalid order ID", 400);
    }

    const supportedMethods = ["cash_on_delivery"];

    if (!supportedMethods.includes(method)) {
        throw createServiceError("Unsupported payment method", 400);
    }

    if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim() ||
        idempotencyKey.trim().length > 200
    ) {
        throw createServiceError(
            "A valid Idempotency-Key is required",
            400
        );
    }

    const cleanKey = idempotencyKey.trim();
    const provider = getPaymentProvider();

    if (provider === "manual" && method !== "cash_on_delivery") {
        throw createServiceError(
            "The manual provider supports cash on delivery only",
            400
        );
    }

    const existingPayment = await Payment.findOne({
        user: userId,
        idempotencyKey: cleanKey
    });

    if (existingPayment) {
        if (
            existingPayment.order.toString() !== orderId ||
            existingPayment.method !== method
        ) {
            throw createServiceError(
                "Idempotency key was already used for a different payment request",
                409
            );
        }

        return {
            payment: existingPayment,
            alreadyCreated: true
        };
    }

    const existingOrderPayment = await Payment.findOne({
        order: orderId
    });

    if (existingOrderPayment) {
        throw createServiceError(
            "Payment already exists for this order",
            409
        );
    }

    const session = await mongoose.startSession();

    try {
        let createdPayment;
        let alreadyCreated = false;

        await session.withTransaction(async () => {
            alreadyCreated = false;

            const duplicate = await Payment.findOne({
                user: userId,
                idempotencyKey: cleanKey
            }).session(session);

            if (duplicate) {
                if (
                    duplicate.order.toString() !== orderId ||
                    duplicate.method !== method
                ) {
                    throw createServiceError(
                        "Idempotency key was already used for a different payment request",
                        409
                    );
                }

                createdPayment = duplicate;
                alreadyCreated = true;
                return;
            }

            const order = await Order.findOne({
                _id: orderId,
                user: userId
            }).session(session);

            if (!order) {
                throw createServiceError("Order not found", 404);
            }

            if (order.orderStatus === "cancelled") {
                throw createServiceError(
                    "Cannot create a payment for a cancelled order",
                    409
                );
            }

            if (order.paymentStatus === "paid") {
                throw createServiceError(
                    "This order has already been paid",
                    409
                );
            }

            if (
                order.paymentStatus === "refunded" ||
                order.paymentStatus === "failed" ||
                order.paymentStatus === "processing"
            ) {
                throw createServiceError(
                    "The order payment state does not allow a new payment",
                    409
                );
            }

            if (order.paymentStatus !== "pending") {
                throw createServiceError(
                    "The order is not eligible for payment",
                    409
                );
            }

            const orderPayment = await Payment.findOne({
                order: order._id
            }).session(session);

            if (orderPayment) {
                throw createServiceError(
                    "Payment already exists for this order",
                    409
                );
            }

            const paymentDocuments = await Payment.create(
                [
                    {
                        user: userId,
                        order: order._id,
                        amount: order.total,
                        currency: order.currency || "EGP",
                        method,
                        provider,
                        status: "pending",
                        refundedAmount: 0,
                        refundStatus: "not_required",
                        refundedAt: null,
                        paidAt: null,
                        idempotencyKey: cleanKey
                    }
                ],
                { session }
            );

            createdPayment = paymentDocuments[0];

            if (method === "cash_on_delivery") {
                const orderUpdate = await Order.updateOne(
                    {
                        _id: order._id,
                        user: userId,
                        paymentStatus: "pending",
                        orderStatus: { $ne: "cancelled" }
                    },
                    {
                        $set: {
                            orderStatus:
                                order.orderStatus === "pending"
                                    ? "confirmed"
                                    : order.orderStatus
                        }
                    },
                    { session }
                );

                if (orderUpdate.matchedCount !== 1) {
                    throw createServiceError(
                        "Order state changed while creating the payment",
                        409
                    );
                }
            }
        });

        if (!createdPayment) {
            throw createServiceError(
                "Payment could not be created",
                500
            );
        }

        return {
            payment: createdPayment,
            alreadyCreated
        };
    } catch (error) {
        if (error.code === 11000) {
            const duplicate = await Payment.findOne({
                user: userId,
                idempotencyKey: cleanKey
            });

            if (duplicate) {
                if (
                    duplicate.order.toString() !== orderId ||
                    duplicate.method !== method
                ) {
                    throw createServiceError(
                        "Idempotency key was already used for a different payment request",
                        409
                    );
                }

                return {
                    payment: duplicate,
                    alreadyCreated: true
                };
            }

            const orderPayment = await Payment.findOne({
                order: orderId
            });

            if (orderPayment) {
                throw createServiceError(
                    "Payment already exists for this order",
                    409
                );
            }
        }

        throw error;
    } finally {
        await session.endSession();
    }
};

exports.handleWebhook = async ({
    receivedSecret,
    eventId,
    type,
    paymentId,
    providerPaymentId
}) => {
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;

    if (!webhookSecret) {
        throw createServiceError(
            "Payment webhook secret is not configured",
            503
        );
    }

    if (
        typeof receivedSecret !== "string" ||
        receivedSecret !== webhookSecret
    ) {
        throw createServiceError("Invalid webhook secret", 401);
    }

    if (
        typeof eventId !== "string" ||
        !eventId.trim() ||
        typeof type !== "string" ||
        typeof paymentId !== "string"
    ) {
        throw createServiceError("Invalid webhook payload", 400);
    }

    const cleanEventId = eventId.trim();

    if (cleanEventId.length > 200) {
        throw createServiceError(
            "Webhook event ID is too long",
            400
        );
    }

    if (!isValidObjectId(paymentId)) {
        throw createServiceError("Invalid payment ID", 400);
    }

    if (
        type !== "payment.succeeded" &&
        type !== "payment.failed"
    ) {
        throw createServiceError(
            "Unsupported webhook event",
            400
        );
    }

    if (
        providerPaymentId !== undefined &&
        providerPaymentId !== null &&
        (
            typeof providerPaymentId !== "string" ||
            !providerPaymentId.trim() ||
            providerPaymentId.trim().length > 200
        )
    ) {
        throw createServiceError(
            "Invalid provider payment ID",
            400
        );
    }

    const cleanProviderPaymentId =
        typeof providerPaymentId === "string"
            ? providerPaymentId.trim()
            : undefined;

    const session = await mongoose.startSession();

    try {
        let resultPayment;
        let productStockChanged = false;

        await session.withTransaction(async () => {
            productStockChanged = false;

            const duplicateEvent = await Payment.findOne({
                providerEventId: cleanEventId
            }).session(session);

            if (duplicateEvent) {
                if (
                    duplicateEvent._id.toString() !== paymentId
                ) {
                    throw createServiceError(
                        "Webhook event ID has already been used",
                        409
                    );
                }

                resultPayment = duplicateEvent;
                return;
            }

            const payment = await Payment.findById(paymentId)
                .session(session);

            if (!payment) {
                throw createServiceError(
                    "Payment not found",
                    404
                );
            }

            const order = await Order.findById(payment.order)
                .session(session);

            if (!order) {
                throw createServiceError(
                    "Order not found",
                    404
                );
            }

            if (payment.method === "cash_on_delivery") {
                throw createServiceError(
                    "Webhook payment events are not supported for cash on delivery",
                    400
                );
            }

            if (
                cleanProviderPaymentId &&
                payment.providerPaymentId &&
                payment.providerPaymentId !== cleanProviderPaymentId
            ) {
                throw createServiceError(
                    "Provider payment ID does not match",
                    409
                );
            }

            if (type === "payment.succeeded") {
                if (
                    payment.status === "failed" ||
                    payment.status === "cancelled"
                ) {
                    throw createServiceError(
                        "Cannot mark a failed or cancelled payment as succeeded",
                        409
                    );
                }

                if (
                    payment.status === "refunded" ||
                    payment.status === "partially_refunded"
                ) {
                    throw createServiceError(
                        "Cannot overwrite an existing refund state with a payment success event",
                        409
                    );
                }

                if (payment.status !== "succeeded") {
                    if (
                        order.paymentStatus !== "pending" &&
                        order.paymentStatus !== "processing"
                    ) {
                        throw createServiceError(
                            "Order state does not allow payment completion",
                            409
                        );
                    }

                    if (order.orderStatus === "cancelled") {
                        throw createServiceError(
                            "Cannot complete payment for a cancelled order",
                            409
                        );
                    }

                    const orderUpdate = await Order.updateOne(
                        {
                            _id: order._id,
                            paymentStatus: {
                                $in: ["pending", "processing"]
                            },
                            orderStatus: {
                                $ne: "cancelled"
                            }
                        },
                        {
                            $set: {
                                paymentStatus: "paid",
                                orderStatus:
                                    order.orderStatus === "pending"
                                        ? "confirmed"
                                        : order.orderStatus
                            }
                        },
                        { session }
                    );

                    if (orderUpdate.matchedCount !== 1) {
                        throw createServiceError(
                            "Order state does not allow payment completion",
                            409
                        );
                    }

                    payment.status = "succeeded";

                    if (!payment.paidAt) {
                        payment.paidAt = new Date();
                    }
                }

                payment.providerEventId = cleanEventId;

                if (cleanProviderPaymentId) {
                    payment.providerPaymentId =
                        cleanProviderPaymentId;
                }

                await payment.save({ session });
            } else {
                if (
                    payment.status === "succeeded" ||
                    payment.status === "partially_refunded" ||
                    payment.status === "refunded" ||
                    payment.status === "cancelled"
                ) {
                    throw createServiceError(
                        "Cannot mark a successful, refunded, or cancelled payment as failed",
                        409
                    );
                }

                if (order.paymentStatus === "paid") {
                    throw createServiceError(
                        "Cannot fail a payment after the order has been paid",
                        409
                    );
                }

                payment.status = "failed";
                payment.providerEventId = cleanEventId;

                if (cleanProviderPaymentId) {
                    payment.providerPaymentId =
                        cleanProviderPaymentId;
                }

                await payment.save({ session });

                if (!order.stockReleasedAt) {
                    for (const item of order.items) {
                        const stockFilter = { _id: item.product };
                        const stockIncrement = {};
                        if (item.variantId) {
                            const currentProduct = await Product.findById(item.product).select("variants").session(session);
                            const currentVariant = currentProduct?.variants.find(variant => String(variant._id) === String(item.variantId));
                            if (!currentVariant) throw createServiceError(`Cannot restore stock for product option: ${item.name}`, 409);
                            stockFilter.variants = { $elemMatch: { _id: item.variantId } };
                            stockIncrement["variants.$.stock"] = item.quantity;
                            if (currentVariant.isActive !== false) stockIncrement.stock = item.quantity;
                        } else {
                            stockIncrement.stock = item.quantity;
                        }
                        const restored = await Product.updateOne(stockFilter, { $inc: stockIncrement }, { session });

                        if (restored.matchedCount !== 1) {
                            throw createServiceError(
                                `Cannot restore stock for product option: ${item.name}`,
                                409
                            );
                        }
                        productStockChanged = true;
                    }

                    const now = new Date();

                    const orderUpdate = await Order.updateOne(
                        {
                            _id: order._id,
                            stockReleasedAt: null,
                            paymentStatus: {
                                $in: [
                                    "pending",
                                    "processing",
                                    "failed"
                                ]
                            },
                            orderStatus: {
                                $ne: "cancelled"
                            }
                        },
                        {
                            $set: {
                                paymentStatus: "failed",
                                orderStatus: "cancelled",
                                stockReleasedAt: now,
                                cancelledAt: now
                            }
                        },
                        { session }
                    );

                    if (orderUpdate.matchedCount !== 1) {
                        throw createServiceError(
                            "Order state changed while processing payment failure",
                            409
                        );
                    }
                } else {
                    const orderUpdate = await Order.updateOne(
                        {
                            _id: order._id,
                            paymentStatus: {
                                $in: [
                                    "pending",
                                    "processing",
                                    "failed"
                                ]
                            }
                        },
                        {
                            $set: {
                                paymentStatus: "failed"
                            }
                        },
                        { session }
                    );

                    if (orderUpdate.matchedCount !== 1) {
                        throw createServiceError(
                            "Order state does not allow payment failure",
                            409
                        );
                    }
                }
            }

            resultPayment = payment;
        });

        if (productStockChanged) {
            await productListCache.invalidate();
        }

        if (!resultPayment) {
            throw createServiceError(
                "Webhook event could not be processed",
                500
            );
        }

        return resultPayment;
    } finally {
        await session.endSession();
    }
};

// Admin: retrieve payment records and their associated orders.
exports.getAdminPayments = async () => {
    return Payment.find()
        .populate(getPaymentDetails())
        .sort({ createdAt: -1 })
        .lean();
};

// Admin confirms cash-on-delivery payment while the order is being processed.
exports.confirmCashOnDelivery = async ({ paymentId }) => {
    if (!isValidObjectId(paymentId)) {
        throw createServiceError("Invalid payment ID", 400);
    }

    const session = await mongoose.startSession();
    try {
        let resultPayment;
        await session.withTransaction(async () => {
            const payment = await Payment.findById(paymentId).session(session);
            if (!payment) {
                throw createServiceError("Payment not found", 404);
            }
            if (payment.method !== "cash_on_delivery" || payment.provider !== "manual") {
                throw createServiceError("This payment is not cash on delivery", 400);
            }

            const order = await Order.findById(payment.order).session(session);
            if (!order) {
                throw createServiceError("Order not found", 404);
            }
            if (payment.status === "succeeded" && order.paymentStatus === "paid") {
                resultPayment = payment;
                return;
            }
            if (order.orderStatus !== "processing") {
                throw createServiceError("Cash-on-delivery payment can be confirmed while the order is processing", 409);
            }
            if (payment.status !== "pending" || order.paymentStatus !== "pending") {
                throw createServiceError("Payment state does not allow COD confirmation", 409);
            }

            payment.status = "succeeded";
            payment.paidAt = new Date();
            await payment.save({ session });

            order.paymentStatus = "paid";
            await order.save({ session });
            resultPayment = payment;
        });

        return Payment.findById(resultPayment._id).populate(getPaymentDetails()).lean();
    } finally {
        await session.endSession();
    }
};
