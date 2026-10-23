const mongoose = require("mongoose");

const refundSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        payment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            required: true
        },

        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: true
        },

        amount: {
            type: Number,
            required: true,
            min: 0.01,
            validate: {
                validator: Number.isFinite,
                message: "Refund amount must be a valid number"
            }
        },

        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true
        },

        reason: {
            type: String,
            required: true,
            trim: true,
            minlength: 3,
            maxlength: 1000
        },

        status: {
            type: String,
            enum: [
                "pending",
                "approved",
                "rejected",
                "processing",
                "completed",
                "failed"
            ],
            default: "pending",
            required: true
        },

        idempotencyKey: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            minlength: 1,
            maxlength: 200
        },

        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        reviewedAt: {
            type: Date,
            default: null
        },

        reviewNote: {
            type: String,
            trim: true,
            maxlength: 1000
        },

        processedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        processingStartedAt: {
            type: Date,
            default: null
        },

        providerRefundId: {
            type: String,
            unique: true,
            sparse: true,
            trim: true
        },

        completedAt: {
            type: Date,
            default: null
        },

        failureReason: {
            type: String,
            trim: true,
            maxlength: 1000
        }
    },
    {
        timestamps: true
    }
);

refundSchema.index({
    user: 1,
    createdAt: -1
});

refundSchema.index({
    payment: 1,
    status: 1,
    createdAt: -1
});

refundSchema.index({
    status: 1,
    createdAt: -1
});

const Refund = mongoose.model("Refund", refundSchema);

module.exports = Refund;