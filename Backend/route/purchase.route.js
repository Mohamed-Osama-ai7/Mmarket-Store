const express = require("express");

const router = express.Router();

const {
    getPurchases,
    getPurchaseById,
    addPurchase,
    checkout
} = require("../controller/purchase.controller");

const { authenticate } = require("../middlewares/auth.middleware");

router.post(
    "/checkout",
    authenticate,
    checkout
);

router.get(
    "/",
    authenticate,
    getPurchases
);


router.get(
    "/:id",
    authenticate,
    getPurchaseById
);


router.post(
    "/",
    authenticate,
    addPurchase
);


module.exports = router;