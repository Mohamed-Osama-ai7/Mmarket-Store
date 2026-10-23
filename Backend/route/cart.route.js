const express = require("express");

const router = express.Router();


const {
    getCart,
    addToCart,
    mergeGuestCart,
    updateCartItem,
    removeFromCart,
    clearCart
} = require("../controller/cart.controller");


const { authenticate } = require("../middlewares/auth.middleware");


router.get(
    "/",
    authenticate,
    getCart
);


router.post(
    "/",
    authenticate,
    addToCart
);

router.post(
    "/merge-guest",
    authenticate,
    mergeGuestCart
);


router.put(
    "/:productId",
    authenticate,
    updateCartItem
);


router.delete(
    "/:productId",
    authenticate,
    removeFromCart
);


router.delete(
    "/",
    authenticate,
    clearCart
);


module.exports = router;