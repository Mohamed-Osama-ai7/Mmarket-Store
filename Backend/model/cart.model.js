const mongoose = require("mongoose");


const cartSchema = new mongoose.Schema({

    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        unique: true
    },

    items: [
        {
            product: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Product",
                required: true
            },

            variantId: {
                type: mongoose.Schema.Types.ObjectId,
                default: undefined
            },

            quantity: {
                type: Number,
                required: true,
                min: 1,
                validate: {
                    validator: Number.isInteger,
                    message: "Quantity must be an integer"
                }
            }
        }
    ]

}, {
    timestamps: true
});


const Cart = mongoose.model("Cart", cartSchema);


module.exports = Cart;