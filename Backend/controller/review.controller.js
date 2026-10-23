const mongoose = require("mongoose");

const Review = require("../model/review.model");
const Product = require("../model/product.model");
const Order = require("../model/order.model");
const productListCache = require("../utilities/productListCache");

const invalidateProductRatings = async () => {
    try { await productListCache.invalidate(); } catch { /* A cache failure must not fail a persisted review change. */ }
};


// Create Review
exports.createReview = async (req, res, next) => {
    try {
        const { productId } = req.params;
        const { rating, comment } = req.body;

        // Validate Product ID
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        // Validate rating
        if (
            rating === undefined ||
            !Number.isInteger(Number(rating)) ||
            Number(rating) < 1 ||
            Number(rating) > 5
        ) {
            return res.status(400).json({
                error: "Rating must be an integer between 1 and 5"
            });
        }

        // Validate comment
        if (
            typeof comment !== "string" ||
            !comment.trim()
        ) {
            return res.status(400).json({
                error: "Comment is required"
            });
        }

        // Check Product
        const product = await Product.findOne({
            _id: productId,
            isActive: true
        });

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }

        // Check if user already reviewed this product
        const existingReview = await Review.findOne({
            user: req.user.id,
            product: productId
        });

        if (existingReview) {
            return res.status(409).json({
                error: "You have already reviewed this product"
            });
        }

        // Find a completed order containing this product
        const order = await Order.findOne({
            user: req.user.id,
            orderStatus: "completed",
            "items.product": productId
        }).sort({
            createdAt: -1
        });

        if (!order) {
            return res.status(403).json({
                error: "You can only review products from a completed order"
            });
        }

        // Create Review
        let review;

        try {
            review = await Review.create({
                user: req.user.id,
                product: productId,
                order: order._id,
                rating: Number(rating),
                comment: comment.trim()
            });
        } catch (err) {
            // Handle concurrent duplicate review creation
            if (err.code === 11000) {
                return res.status(409).json({
                    error: "You have already reviewed this product"
                });
            }

            throw err;
        }

        await invalidateProductRatings();
        const reviewData = await Review.findById(review._id)
            .populate("user", "name")
            .populate("product", "name slug");

        return res.status(201).json({
            message: "Review created successfully",
            data: reviewData
        });

    } catch (err) {
        return next(err);
    }
};


// Get Product Reviews
exports.getProductReviews = async (req, res, next) => {
    try {
        const { productId } = req.params;

        // Validate Product ID
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        // Check Product
        const product = await Product.findOne({
            _id: productId,
            isActive: true
        });

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }

        const reviews = await Review.find({
            product: productId
        })
            .populate("user", "name")
            .sort({
                createdAt: -1
            });

        return res.status(200).json({
            message: "Product reviews found",
            data: {
                reviews,
                totalReviews: reviews.length
            }
        });

    } catch (err) {
        return next(err);
    }
};


// Update Review
exports.updateReview = async (req, res, next) => {
    try {
        const { reviewId } = req.params;
        const { rating, comment } = req.body;

        // Validate Review ID
        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({
                error: "Invalid review ID"
            });
        }

        // Validate rating if provided
        if (
            rating !== undefined &&
            (
                !Number.isInteger(Number(rating)) ||
                Number(rating) < 1 ||
                Number(rating) > 5
            )
        ) {
            return res.status(400).json({
                error: "Rating must be an integer between 1 and 5"
            });
        }

        // Validate comment if provided
        if (
            comment !== undefined &&
            (
                typeof comment !== "string" ||
                !comment.trim()
            )
        ) {
            return res.status(400).json({
                error: "Comment cannot be empty"
            });
        }

        const review = await Review.findOne({
            _id: reviewId,
            user: req.user.id
        });

        if (!review) {
            return res.status(404).json({
                error: "Review not found"
            });
        }

        if (rating !== undefined) {
            review.rating = Number(rating);
        }

        if (comment !== undefined) {
            review.comment = comment.trim();
        }

        await review.save();
        await invalidateProductRatings();

        const reviewData = await Review.findById(review._id)
            .populate("user", "name")
            .populate("product", "name slug");

        return res.status(200).json({
            message: "Review updated successfully",
            data: reviewData
        });

    } catch (err) {
        return next(err);
    }
};


// Delete Review
exports.deleteReview = async (req, res, next) => {
    try {
        const { reviewId } = req.params;

        // Validate Review ID
        if (!mongoose.Types.ObjectId.isValid(reviewId)) {
            return res.status(400).json({
                error: "Invalid review ID"
            });
        }

        const review = await Review.findOne({
            _id: reviewId,
            user: req.user.id
        });

        if (!review) {
            return res.status(404).json({
                error: "Review not found"
            });
        }

        await Review.deleteOne({
            _id: reviewId,
            user: req.user.id
        });
        await invalidateProductRatings();

        return res.status(200).json({
            message: "Review deleted successfully"
        });

    } catch (err) {
        return next(err);
    }
};