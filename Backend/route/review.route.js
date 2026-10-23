const express = require("express");

const router = express.Router();

const {
    createReview,
    getProductReviews,
    updateReview,
    deleteReview
} = require("../controller/review.controller");

const { authenticate } = require("../middlewares/auth.middleware");


// Get all reviews for a product
router.get("/product/:productId", getProductReviews);


// Create a review
router.post("/:productId", authenticate, createReview);


// Update a review
router.put("/:reviewId", authenticate, updateReview);


// Delete a review
router.delete("/:reviewId", authenticate, deleteReview);


module.exports = router;