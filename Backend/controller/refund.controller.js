const refundService = require("../service/refund.service");
const logger = require("../utilities/logger");
const Refund = require("../model/refund.model");
const { notifyUser, notifyAdministrators } = require("../utilities/notificationPublisher");

async function publishRefundUpdate(refund, title, message, notifyAdmins = false) {
    try {
        let recipient = refund?.user?._id || refund?.user;
        if (!recipient && refund?._id) {
            const saved = await Refund.findById(refund._id).select("user").lean();
            recipient = saved?.user;
        }
        const link = "/refunds";
        if (recipient) await notifyUser({ recipient, type: "refund_status", title, message, link });
        if (notifyAdmins) await notifyAdministrators({ type: "refund_status", title: "New refund request", message, link: "/dashboard/refunds" });
    } catch (error) {
        logger.logError("refunds.notification.failed", error, { event: "refunds.notification.failed" });
    }
}



// Create a full or partial refund request.
exports.createRefundRequest = async (req, res) => {
    const idempotencyKey = req.get("Idempotency-Key");

    if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim()
    ) {
        return res.status(400).json({
            error: "Idempotency-Key header is required"
        });
    }

    const {
        payment,
        amount,
        reason
    } = req.body || {};

    if (
        !payment ||
        amount === undefined ||
        reason === undefined
    ) {
        return res.status(400).json({
            error: "Payment, amount, and reason are required"
        });
    }

    if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            error: "Amount must be a positive number"
        });
    }

    try {
        const result = await refundService.createRefundRequest({
            userId: req.user.id,
            paymentId: payment,
            amount,
            reason,
            idempotencyKey: idempotencyKey.trim()
        });

        if (result.created) await publishRefundUpdate(result.refund, "Refund request received", `Your refund request #${String(result.refund._id).slice(-8).toUpperCase()} has been received.`, true);

        return res.status(result.created ? 201 : 200).json({
            message: result.created
                ? "Refund request created successfully"
                : "Refund request already exists",
            data: result.refund
        });

    } catch (err) {
        logger.logError("refunds.create.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to create refund request"
        });
    }
};


// Get the logged-in user's refund history.
exports.getMyRefunds = async (req, res) => {
    try {
        const refunds = await refundService.getMyRefunds(
            req.user.id
        );

        return res.status(200).json({
            message: "Refund history retrieved successfully",
            data: refunds
        });

    } catch (err) {
        logger.logError("refunds.history.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Failed to retrieve refund history"
        });
    }
};


// Get one refund belonging to the logged-in user.
exports.getMyRefundById = async (req, res) => {
    try {
        const refund = await refundService.getMyRefundById({
            userId: req.user.id,
            refundId: req.params.id
        });

        return res.status(200).json({
            message: "Refund retrieved successfully",
            data: refund
        });

    } catch (err) {
        logger.logError("refunds.get_by_id.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to retrieve refund"
        });
    }
};


// Admin: retrieve all refund requests.
exports.getAllRefunds = async (req, res) => {
    try {
        const result = await refundService.getAllRefunds({
            status: req.query.status,
            page: req.query.page,
            limit: req.query.limit
        });

        return res.status(200).json({
            message: "Refund requests retrieved successfully",
            data: result.refunds,
            pagination: result.pagination
        });

    } catch (err) {
        logger.logError("refunds.list.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to retrieve refund requests"
        });
    }
};


// Admin: approve or reject a request.
exports.reviewRefund = async (req, res) => {
    const {
        decision,
        reviewNote
    } = req.body || {};

    try {
        const refund = await refundService.reviewRefund({
            adminId: req.user.id,
            refundId: req.params.id,
            decision,
            reviewNote
        });

        const message = decision === "approve"
            ? "Refund request approved successfully"
            : "Refund request rejected successfully";
        await publishRefundUpdate(refund, "Refund request reviewed", `Your refund request #${String(refund._id).slice(-8).toUpperCase()} was ${decision === "approve" ? "approved" : "rejected"}.`);

        return res.status(200).json({
            message,
            data: refund
        });

    } catch (err) {
        logger.logError("refunds.review.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to review refund request"
        });
    }
};


// Admin: move an approved refund to processing.
exports.startRefundProcessing = async (req, res) => {
    try {
        const refund = await refundService.startRefundProcessing({
            adminId: req.user.id,
            refundId: req.params.id
        });
        await publishRefundUpdate(refund, "Refund processing started", `Your refund request #${String(refund._id).slice(-8).toUpperCase()} is being processed.`);

        return res.status(200).json({
            message: "Refund processing started",
            data: refund
        });

    } catch (err) {
        logger.logError("refunds.processing_start.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to start refund processing"
        });
    }
};


// Admin: record a confirmed refund.
exports.completeRefund = async (req, res) => {
    const {
        providerRefundId
    } = req.body || {};

    try {
        const refund = await refundService.completeRefund({
            adminId: req.user.id,
            refundId: req.params.id,
            providerRefundId
        });
        await publishRefundUpdate(refund, "Refund completed", `Your refund request #${String(refund._id).slice(-8).toUpperCase()} has been completed.`);

        return res.status(200).json({
            message: "Refund completed successfully",
            data: refund
        });

    } catch (err) {
        logger.logError("refunds.complete.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to complete refund"
        });
    }
};


// Admin: record a failed refund attempt.
exports.failRefund = async (req, res) => {
    const {
        failureReason
    } = req.body || {};

    try {
        const refund = await refundService.failRefund({
            adminId: req.user.id,
            refundId: req.params.id,
            failureReason
        });
        await publishRefundUpdate(refund, "Refund status updated", `Your refund request #${String(refund._id).slice(-8).toUpperCase()} could not be completed. Please contact support if you need help.`);

        return res.status(200).json({
            message: "Refund marked as failed",
            data: refund
        });

    } catch (err) {
        logger.logError("refunds.fail.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: err.statusCode
                ? err.message
                : "Failed to update refund"
        });
    }
};