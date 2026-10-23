const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        guestEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: undefined },

        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: true,
            unique: true
        },

        amount: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Payment amount must be a valid number"
            }
        },

        currency: {
            type: String,
            required: true,
            default: "EGP",
            uppercase: true,
            trim: true
        },

        method: {
            type: String,
            enum: [
                "cash_on_delivery",
                "card",
                "wallet"
            ],
            required: true
        },

        provider: {
            type: String,
            enum: [
                "manual",
                "stripe",
                "paymob"
            ],
            required: true
        },

        providerPaymentId: {
            type: String,
            unique: true,
            sparse: true,
            trim: true
        },

        providerEventId: {
            type: String,
            unique: true,
            sparse: true,
            trim: true
        },

        status: {
            type: String,
            enum: [
                "pending",
                "processing",
                "succeeded",
                "partially_refunded",
                "failed",
                "cancelled",
                "refunded"
            ],
            default: "pending",
            required: true
        },

        refundedAmount: {
            type: Number,
            required: true,
            default: 0,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Refunded amount must be a valid number"
            }
        },

        refundStatus: {
            type: String,
            enum: [
                "not_required",
                "pending",
                "approved",
                "processing",
                "completed",
                "partially_refunded",
                "rejected",
                "failed"
            ],
            required: true,
            default: "not_required"
        },

        refundedAt: {
            type: Date,
            default: null
        },

        failureReason: {
            type: String,
            trim: true
        },

        paidAt: {
            type: Date,
            default: null
        },

        idempotencyKey: {
            type: String,
            required: true,
            trim: true,
            minlength: 1,
            maxlength: 200
        }
    },
    {
        timestamps: true
    }
);


paymentSchema.pre("validate", function () {
    if (!this.user && !this.guestEmail) {
        this.invalidate("guestEmail", "A payment must belong to a user or a guest email");
    }
});

// Query a user's payment history efficiently.
paymentSchema.index({ user: 1, createdAt: -1 });
paymentSchema.index({ guestEmail: 1, createdAt: -1 });

paymentSchema.index(
    {
        user: 1,
        idempotencyKey: 1
    },
    {
        unique: true
    }
);


// Find payments by their refund state.
paymentSchema.index({
    refundStatus: 1,
    updatedAt: -1
});


const Payment = mongoose.model("Payment", paymentSchema);

module.exports = Payment;