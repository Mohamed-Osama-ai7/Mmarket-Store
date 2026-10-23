const express = require("express");
const logger = require("../utilities/logger");

const router = express.Router();
logger.logSafely("debug", "Wishlist routes loaded", {
    event: "routes.wishlist.loaded"
});

const {
    getWishlist,
    addToWishlist,
    removeFromWishlist,
    clearWishlist
} = require("../controller/wishlist.controller");

const { authenticate } = require("../middlewares/auth.middleware");


// Get user's wishlist
router.get(
    "/",
    authenticate,
    getWishlist
);


// Add product to wishlist
router.post(
    "/:productId",
    authenticate,
    addToWishlist
);


// Remove product from wishlist
router.delete(
    "/:productId",
    authenticate,
    removeFromWishlist
);


// Clear wishlist
router.delete(
    "/",
    authenticate,
    clearWishlist
);


module.exports = router;