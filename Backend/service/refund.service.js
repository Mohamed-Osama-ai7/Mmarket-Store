const mongoose = require("mongoose");

const Refund = require("../model/refund.model");
const Payment = require("../model/payment.model");
const Order = require("../model/order.model");


// Create service errors with HTTP status codes.
const createServiceError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;

    return error;
};


// Validate MongoDB ObjectId.
const isValidObjectId = (id) => {
    return (
        typeof id === "string" &&
        mongoose.Types.ObjectId.isValid(id) &&
        new mongoose.Types.ObjectId(id).toString() === id
    );
};


// Validate a monetary amount with a maximum of two decimal places.
const isValidMoneyAmount = (amount) => {
    return (
        typeof amount === "number" &&
        Number.isFinite(amount) &&
        amount > 0 &&
        Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
    );
};


// Convert a monetary amount into a two-decimal-place value.
const toCents = (amount) => {
    return Math.round(amount * 100);
};


// Find an active refund request for a payment.
const hasActiveRefund = async (paymentId, session) => {
    return Refund.findOne({
        payment: paymentId,
        status: {
            $in: [
                "pending",
                "approved",
                "processing"
            ]
        }
    }).session(session);
};


// Find a refund by ID or throw an error.
const getRefundByIdOrThrow = async (refundId, session) => {
    if (!isValidObjectId(refundId)) {
        throw createServiceError("Invalid refund ID", 400);
    }

    const refund = await Refund.findById(refundId).session(session);

    if (!refund) {
        throw createServiceError("Refund not found", 404);
    }

    return refund;
};


// Validate and normalize an idempotency key.
const getCleanIdempotencyKey = (userId, idempotencyKey) => {
    if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim()
    ) {
        throw createServiceError(
            "A valid idempotency key is required",
            400
        );
    }

    const cleanKey = `${userId}:${idempotencyKey.trim()}`;

    if (cleanKey.length > 200) {
        throw createServiceError(
            "Idempotency key is too long",
            400
        );
    }

    return cleanKey;
};


// Check whether an existing request matches a repeated request.
const validateExistingRequest = (
    existingRequest,
    paymentId,
    amount,
    reason
) => {
    if (
        existingRequest.payment.toString() !== paymentId ||
        toCents(existingRequest.amount) !== toCents(amount) ||
        existingRequest.reason !== reason.trim()
    ) {
        throw createServiceError(
            "Idempotency key was already used for a different refund request",
            409
        );
    }

    return {
        refund: existingRequest,
        created: false
    };
};


// Create a full or partial refund request.
exports.createRefundRequest = async ({
    userId,
    paymentId,
    amount,
    reason,
    idempotencyKey
}) => {
    if (!isValidObjectId(paymentId)) {
        throw createServiceError("Invalid payment ID", 400);
    }

    if (!isValidObjectId(String(userId))) {
        throw createServiceError("Invalid user ID", 400);
    }

    if (!isValidMoneyAmount(amount)) {
        throw createServiceError(
            "Refund amount must be positive and have no more than two decimal places",
            400
        );
    }

    if (
        typeof reason !== "string" ||
        reason.trim().length < 3 ||
        reason.trim().length > 1000
    ) {
        throw createServiceError(
            "Refund reason must contain between 3 and 1000 characters",
            400
        );
    }

    const cleanKey = getCleanIdempotencyKey(
        String(userId),
        idempotencyKey
    );

    const cleanReason = reason.trim();

    // Return an existing request when the same key is reused.
    const existingRequest = await Refund.findOne({
        user: userId,
        idempotencyKey: cleanKey
    });

    if (existingRequest) {
        return validateExistingRequest(
            existingRequest,
            paymentId,
            amount,
            cleanReason
        );
    }

    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            // Check again inside the transaction to reduce duplicate requests.
            const duplicateRequest = await Refund.findOne({
                user: userId,
                idempotencyKey: cleanKey
            }).session(session);

            if (duplicateRequest) {
                result = validateExistingRequest(
                    duplicateRequest,
                    paymentId,
                    amount,
                    cleanReason
                );

                return;
            }

            const payment = await Payment.findOne({
                _id: paymentId,
                user: userId
            }).session(session);

            if (!payment) {
                throw createServiceError("Payment not found", 404);
            }

            if (
                payment.status !== "succeeded" &&
                payment.status !== "partially_refunded"
            ) {
                throw createServiceError(
                    "Only successful payments can be refunded",
                    409
                );
            }

            const order = await Order.findOne({
                _id: payment.order,
                user: userId
            }).session(session);

            if (!order) {
                throw createServiceError(
                    "Associated order not found",
                    404
                );
            }

            // Only one active refund request is allowed per payment.
            const activeRefund = await hasActiveRefund(
                payment._id,
                session
            );

            if (activeRefund) {
                throw createServiceError(
                    "An active refund request already exists for this payment",
                    409
                );
            }

            const remainingAmount = Number(
                (
                    toCents(payment.amount) -
                    toCents(payment.refundedAmount || 0)
                ) / 100
            );

            if (toCents(amount) > toCents(remainingAmount)) {
                throw createServiceError(
                    `Refund amount exceeds the remaining refundable amount of ${remainingAmount} ${payment.currency}`,
                    400
                );
            }

            const refundDocuments = await Refund.create(
                [
                    {
                        user: userId,
                        payment: payment._id,
                        order: order._id,
                        amount,
                        currency: payment.currency,
                        reason: cleanReason,
                        status: "pending",
                        idempotencyKey: cleanKey
                    }
                ],
                {
                    session
                }
            );

            const refund = refundDocuments[0];

            payment.refundStatus = "pending";

            order.refundStatus = "pending";

            await payment.save({
                session
            });

            await order.save({
                session
            });

            result = {
                refund,
                created: true
            };
        });

        return result;

    } finally {
        await session.endSession();
    }
};


// Get the logged-in user's refund history.
exports.getMyRefunds = async (userId) => {
    return Refund.find({
        user: userId
    })
        .populate(
            "payment",
            "amount currency method status refundedAmount refundStatus"
        )
        .populate(
            "order",
            "orderStatus paymentStatus total currency refundStatus"
        )
        .sort({
            createdAt: -1
        })
        .lean();
};


// Get one refund belonging to the logged-in user.
exports.getMyRefundById = async ({
    userId,
    refundId
}) => {
    if (!isValidObjectId(refundId)) {
        throw createServiceError("Invalid refund ID", 400);
    }

    const refund = await Refund.findOne({
        _id: refundId,
        user: userId
    })
        .populate(
            "payment",
            "amount currency method status refundedAmount refundStatus"
        )
        .populate(
            "order",
            "orderStatus paymentStatus total currency refundStatus"
        )
        .lean();

    if (!refund) {
        throw createServiceError("Refund not found", 404);
    }

    return refund;
};


// Admin: get all refund requests with pagination.
exports.getAllRefunds = async ({
    status,
    page = 1,
    limit = 20
}) => {
    const filter = {};

    if (status) {
        const allowedStatuses = [
            "pending",
            "approved",
            "rejected",
            "processing",
            "completed",
            "failed"
        ];

        if (!allowedStatuses.includes(status)) {
            throw createServiceError(
                "Invalid refund status filter",
                400
            );
        }

        filter.status = status;
    }

    const safePage = Math.max(
        1,
        Math.floor(Number(page) || 1)
    );

    const safeLimit = Math.min(
        100,
        Math.max(1, Math.floor(Number(limit) || 20))
    );

    const [refunds, total] = await Promise.all([
        Refund.find(filter)
            .populate("user", "name email")
            .populate(
                "payment",
                "amount currency method status refundedAmount refundStatus"
            )
            .populate(
                "order",
                "orderStatus paymentStatus total currency refundStatus"
            )
            .populate("reviewedBy", "name email")
            .populate("processedBy", "name email")
            .sort({
                createdAt: -1
            })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .lean(),

        Refund.countDocuments(filter)
    ]);

    return {
        refunds,
        pagination: {
            page: safePage,
            limit: safeLimit,
            total,
            pages: Math.ceil(total / safeLimit)
        }
    };
};


// Admin: approve or reject a pending refund request.
exports.reviewRefund = async ({
    adminId,
    refundId,
    decision,
    reviewNote
}) => {
    if (!["approve", "reject"].includes(decision)) {
        throw createServiceError(
            "Decision must be approve or reject",
            400
        );
    }

    if (
        reviewNote !== undefined &&
        (
            typeof reviewNote !== "string" ||
            reviewNote.trim().length > 1000
        )
    ) {
        throw createServiceError(
            "Review note must not exceed 1000 characters",
            400
        );
    }

    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            const refund = await getRefundByIdOrThrow(
                refundId,
                session
            );

            // Idempotent response for an identical repeated decision.
            if (
                refund.status === "approved" &&
                decision === "approve"
            ) {
                result = refund;
                return;
            }

            if (
                refund.status === "rejected" &&
                decision === "reject"
            ) {
                result = refund;
                return;
            }

            if (refund.status !== "pending") {
                throw createServiceError(
                    "Only pending refund requests can be reviewed",
                    409
                );
            }

            const payment = await Payment.findById(
                refund.payment
            ).session(session);

            const order = await Order.findById(
                refund.order
            ).session(session);

            if (!payment || !order) {
                throw createServiceError(
                    "Associated payment or order was not found",
                    404
                );
            }

            refund.reviewedBy = adminId;
            refund.reviewedAt = new Date();

            if (reviewNote !== undefined) {
                refund.reviewNote = reviewNote.trim();
            }

            if (decision === "approve") {
                refund.status = "approved";

                payment.refundStatus = "approved";
                order.refundStatus = "approved";

            } else {
                refund.status = "rejected";

                payment.refundStatus =
                    payment.refundedAmount > 0
                        ? "partially_refunded"
                        : "rejected";

                order.refundStatus =
                    payment.refundedAmount > 0
                        ? "partially_refunded"
                        : "rejected";
            }

            await refund.save({
                session
            });

            await payment.save({
                session
            });

            await order.save({
                session
            });

            result = refund;
        });

        return result;

    } finally {
        await session.endSession();
    }
};


// Admin: mark an approved refund as processing.
// This function does not initiate a real provider refund.
exports.startRefundProcessing = async ({
    adminId,
    refundId
}) => {
    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            const refund = await getRefundByIdOrThrow(
                refundId,
                session
            );

            if (refund.status === "processing") {
                result = refund;
                return;
            }

            if (refund.status !== "approved") {
                throw createServiceError(
                    "Only approved refunds can enter processing",
                    409
                );
            }

            const payment = await Payment.findById(
                refund.payment
            ).session(session);

            const order = await Order.findById(
                refund.order
            ).session(session);

            if (!payment || !order) {
                throw createServiceError(
                    "Associated payment or order was not found",
                    404
                );
            }

            refund.status = "processing";
            refund.processedBy = adminId;
            refund.processingStartedAt = new Date();

            payment.refundStatus = "processing";
            order.refundStatus = "processing";

            await refund.save({
                session
            });

            await payment.save({
                session
            });

            await order.save({
                session
            });

            result = refund;
        });

        return result;

    } finally {
        await session.endSession();
    }
};


// Admin: record a refund confirmed by the payment provider.
// This function does not call Stripe, Paymob, or another provider.
exports.completeRefund = async ({
    adminId,
    refundId,
    providerRefundId
}) => {
    if (
        typeof providerRefundId !== "string" ||
        !providerRefundId.trim() ||
        providerRefundId.trim().length > 200
    ) {
        throw createServiceError(
            "A valid refund confirmation reference is required",
            400
        );
    }

    const cleanProviderRefundId = providerRefundId.trim();
    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            const refund = await getRefundByIdOrThrow(
                refundId,
                session
            );

            if (refund.status === "completed") {
                if (
                    refund.providerRefundId !== cleanProviderRefundId
                ) {
                    throw createServiceError(
                        "Refund was already completed with a different confirmation reference",
                        409
                    );
                }

                result = refund;
                return;
            }

            if (refund.status !== "processing") {
                throw createServiceError(
                    "Only processing refunds can be completed",
                    409
                );
            }

            const duplicateReference = await Refund.findOne({
                providerRefundId: cleanProviderRefundId,
                _id: {
                    $ne: refund._id
                }
            }).session(session);

            if (duplicateReference) {
                throw createServiceError(
                    "This refund confirmation reference has already been used",
                    409
                );
            }

            const payment = await Payment.findById(
                refund.payment
            ).session(session);

            const order = await Order.findById(
                refund.order
            ).session(session);

            if (!payment || !order) {
                throw createServiceError(
                    "Associated payment or order was not found",
                    404
                );
            }

            const updatedRefundedAmount = Number(
                (
                    toCents(payment.refundedAmount || 0) +
                    toCents(refund.amount)
                ) / 100
            );

            if (
                toCents(updatedRefundedAmount) >
                toCents(payment.amount)
            ) {
                throw createServiceError(
                    "Total refunded amount cannot exceed the original payment amount",
                    409
                );
            }

            refund.status = "completed";
            refund.providerRefundId = cleanProviderRefundId;
            refund.processedBy = adminId;
            refund.completedAt = new Date();

            payment.refundedAmount = updatedRefundedAmount;

            const isFullyRefunded =
                toCents(updatedRefundedAmount) >=
                toCents(payment.amount);

            payment.status = isFullyRefunded
                ? "refunded"
                : "partially_refunded";

            payment.refundStatus = isFullyRefunded
                ? "completed"
                : "partially_refunded";

            if (isFullyRefunded) {
                payment.refundedAt = new Date();

                order.paymentStatus = "refunded";
                order.refundStatus = "completed";

            } else {
                order.refundStatus = "partially_refunded";
            }

            await refund.save({
                session
            });

            await payment.save({
                session
            });

            await order.save({
                session
            });

            result = refund;
        });

        return result;

    } finally {
        await session.endSession();
    }
};


// Admin: record a failed refund attempt.
exports.failRefund = async ({
    adminId,
    refundId,
    failureReason
}) => {
    if (
        typeof failureReason !== "string" ||
        !failureReason.trim() ||
        failureReason.trim().length > 1000
    ) {
        throw createServiceError(
            "A failure reason is required",
            400
        );
    }

    const session = await mongoose.startSession();

    try {
        let result;

        await session.withTransaction(async () => {
            const refund = await getRefundByIdOrThrow(
                refundId,
                session
            );

            if (refund.status === "failed") {
                result = refund;
                return;
            }

            if (refund.status !== "processing") {
                throw createServiceError(
                    "Only processing refunds can be marked as failed",
                    409
                );
            }

            const payment = await Payment.findById(
                refund.payment
            ).session(session);

            const order = await Order.findById(
                refund.order
            ).session(session);

            if (!payment || !order) {
                throw createServiceError(
                    "Associated payment or order was not found",
                    404
                );
            }

            refund.status = "failed";
            refund.processedBy = adminId;
            refund.failureReason = failureReason.trim();

            payment.refundStatus =
                payment.refundedAmount > 0
                    ? "partially_refunded"
                    : "failed";

            order.refundStatus =
                payment.refundedAmount > 0
                    ? "partially_refunded"
                    : "failed";

            await refund.save({
                session
            });

            await payment.save({
                session
            });

            await order.save({
                session
            });

            result = refund;
        });

        return result;

    } finally {
        await session.endSession();
    }
};