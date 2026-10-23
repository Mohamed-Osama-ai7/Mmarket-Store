const mongoose = require("mongoose");

// Order item schema
const orderItemSchema = new mongoose.Schema(
    {
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },

        slug: {
            type: String,
            required: true,
            trim: true
        },

        // Immutable snapshots keep the purchased variant intelligible even if the catalogue later changes.
        variantId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
        size: { type: String, trim: true, maxlength: 32, default: "" },
        color: { type: String, trim: true, maxlength: 50, default: "" },
        sku: { type: String, trim: true, uppercase: true, maxlength: 60, default: "" },

        quantity: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isInteger,
                message: "Quantity must be an integer"
            }
        },

        unitPrice: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Unit price must be a valid number"
            }
        },

        totalPrice: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Total price must be a valid number"
            }
        }
    },
    {
        _id: true
    }
);


// Validate item total before saving the parent order.
orderItemSchema.pre("validate", function () {
    if (
        Number.isFinite(this.unitPrice) &&
        Number.isInteger(this.quantity) &&
        this.quantity >= 1 &&
        Number.isFinite(this.totalPrice)
    ) {
        const expectedTotal = Number(
            (this.unitPrice * this.quantity).toFixed(2)
        );

        if (Math.abs(this.totalPrice - expectedTotal) > 0.001) {
            this.invalidate(
                "totalPrice",
                "Item total must equal unit price multiplied by quantity"
            );
        }
    }
});


// Order schema
const orderSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },

        guestName: { type: String, trim: true, maxlength: 100, default: undefined },
        guestEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: undefined },
        guestAccessTokenHash: { type: String, select: false, default: undefined },

        deliveryDetails: {
            name: { type: String, trim: true, maxlength: 100, default: "" },
            phone: { type: String, trim: true, maxlength: 24, default: "" },
            address: { type: String, trim: true, maxlength: 300, default: "" }
        },

        items: {
            type: [orderItemSchema],
            required: true,
            validate: {
                validator: items =>
                    Array.isArray(items) && items.length > 0,
                message: "Order must contain at least one item"
            }
        },

        subtotal: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Subtotal must be a valid number"
            }
        },

        discount: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
            validate: {
                validator: Number.isFinite,
                message: "Discount must be a valid number"
            }
        },

        total: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Total must be a valid number"
            }
        },

        currency: {
            type: String,
            required: true,
            default: "EGP",
            uppercase: true,
            trim: true
        },

        orderStatus: {
            type: String,
            enum: [
                "pending",
                "confirmed",
                "processing",
                "completed",
                "cancelled"
            ],
            required: true,
            default: "pending"
        },

        paymentStatus: {
            type: String,
            enum: [
                "pending",
                "processing",
                "paid",
                "failed",
                "refunded"
            ],
            required: true,
            default: "pending"
        },

        // Tracks the refund lifecycle for this order.
        refundStatus: {
            type: String,
            enum: [
                "not_required",
                "pending",
                "approved",
                "rejected",
                "processing",
                "completed",
                "failed",
                "partially_refunded"
            ],
            required: true,
            default: "not_required"
        },

        cancelledAt: {
            type: Date,
            default: null
        },

        completedAt: {
            type: Date,
            default: null
        },

        stockReleasedAt: {
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


// Every order belongs either to an account or to a guest protected by a high-entropy access token.
orderSchema.pre("validate", function () {
    if (this.user) {
        this.guestName = undefined;
        this.guestEmail = undefined;
        this.guestAccessTokenHash = undefined;
    } else {
        if (!this.guestName || !this.guestEmail || !this.guestAccessTokenHash) {
            this.invalidate("guestEmail", "Guest orders require a name, email, and access-token hash");
        }
        if (this.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.guestEmail)) {
            this.invalidate("guestEmail", "Guest email is invalid");
        }
    }
});

// Validate that the order total matches its components.
orderSchema.pre("validate", function () {
    if (
        Number.isFinite(this.subtotal) &&
        Number.isFinite(this.discount) &&
        Number.isFinite(this.total)
    ) {
        const expectedTotal = Number(
            (this.subtotal - this.discount).toFixed(2)
        );

        if (
            expectedTotal < 0 ||
            Math.abs(this.total - expectedTotal) > 0.001
        ) {
            this.invalidate(
                "total",
                "Total must equal subtotal minus discount"
            );
        }
    }

    if (
        Array.isArray(this.items) &&
        this.items.length > 0 &&
        this.items.every(item =>
            Number.isFinite(item.totalPrice)
        ) &&
        Number.isFinite(this.subtotal)
    ) {
        const expectedSubtotal = Number(
            this.items
                .reduce((sum, item) => sum + item.totalPrice, 0)
                .toFixed(2)
        );

        if (Math.abs(this.subtotal - expectedSubtotal) > 0.001) {
            this.invalidate(
                "subtotal",
                "Subtotal must equal the sum of order item totals"
            );
        }
    }
});


// Indexes
orderSchema.index(
    {
        user: 1,
        idempotencyKey: 1
    },
    {
        unique: true
    }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ guestEmail: 1, createdAt: -1 });

orderSchema.index({
    orderStatus: 1,
    createdAt: -1
});

orderSchema.index({
    paymentStatus: 1,
    completedAt: -1
});


const Order = mongoose.model("Order", orderSchema);

module.exports = Order;