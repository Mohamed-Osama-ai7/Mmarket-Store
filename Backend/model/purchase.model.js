const mongoose = require("mongoose");

const purchaseSchema = new mongoose.Schema(
    {
        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            default: null
        },

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Product",
            required: true
        },

        quantity: {
            type: Number,
            required: true,
            min: 1,
            validate: {
                validator: Number.isInteger,
                message: "Quantity must be an integer"
            }
        },

        price: {
            type: Number,
            required: true,
            min: 0
        },

        totalPrice: {
            type: Number,
            required: true,
            min: 0
        },

        status: {
            type: String,
            enum: [
                "pending",
                "completed",
                "cancelled"
            ],
            default: "pending"
        },

        purchasedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

purchaseSchema.index({
    order: 1
});

purchaseSchema.index({
    user: 1,
    purchasedAt: -1
});

const Purchase = mongoose.model(
    "Purchase",
    purchaseSchema
);

module.exports = Purchase;