const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
    {
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

        order: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Order",
            required: true
        },

        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
            validate: {
                validator: Number.isInteger,
                message: "Rating must be an integer between 1 and 5"
            }
        },

        comment: {
            type: String,
            required: true,
            trim: true,
            minlength: 1
        }
    },
    {
        timestamps: true
    }
);


// One review per user for the same product
reviewSchema.index(
    {
        user: 1,
        product: 1
    },
    {
        unique: true
    }
);


// Useful for retrieving product reviews
reviewSchema.index({
    product: 1,
    createdAt: -1
});


const Review = mongoose.model("Review", reviewSchema);

module.exports = Review;