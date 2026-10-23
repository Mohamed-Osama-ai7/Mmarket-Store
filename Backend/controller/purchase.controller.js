const mongoose = require("mongoose");

const Purchase = require("../model/purchase.model");
const Product = require("../model/product.model");
const productListCache = require("../utilities/productListCache");
const logger = require("../utilities/logger");


// Get legacy purchases of the logged-in user
exports.getPurchases = async (req, res) => {
    try {

        const myPurchases = await Purchase.find({
            user: req.user.id
        })
            .populate("product", "name slug price imgURL")
            .populate("order", "orderStatus paymentStatus total")
            .sort({
                createdAt: -1
            });

        return res.status(200).json({
            message: "Purchases list",
            data: myPurchases
        });

    } catch (err) {

        logger.logError("purchases.list.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Error getting purchases",
            message: "An unexpected error occurred"
        });

    }
};


// Get one legacy purchase of the logged-in user
exports.getPurchaseById = async (req, res) => {
    try {

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                error: "Invalid purchase ID"
            });
        }

        const myPurchase = await Purchase.findOne({
            _id: id,
            user: req.user.id
        })
            .populate("product", "name slug price imgURL")
            .populate("order", "orderStatus paymentStatus total");

        if (!myPurchase) {
            return res.status(404).json({
                error: "Purchase not found"
            });
        }

        return res.status(200).json({
            message: "Purchase found",
            data: myPurchase
        });

    } catch (err) {

        logger.logError("purchases.get_by_id.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Error getting purchase",
            message: "An unexpected error occurred"
        });

    }
};


// Create a standalone legacy purchase
exports.addPurchase = async (req, res) => {
    try {

        const { product, quantity } = req.body;

        if (
            !product ||
            quantity === undefined
        ) {
            return res.status(400).json({
                error: "Product and quantity are required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(product)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        const purchaseQuantity = Number(quantity);

        if (
            !Number.isInteger(purchaseQuantity) ||
            purchaseQuantity < 1
        ) {
            return res.status(400).json({
                error: "Quantity must be a positive integer"
            });
        }

        let session;
        try {
            session = await mongoose.startSession();

            let purchaseId;
            await session.withTransaction(async () => {
                purchaseId = undefined;

                const myProduct = await Product.findOneAndUpdate(
                    {
                        _id: product,
                        isActive: true,
                        stock: {
                            $gte: purchaseQuantity
                        }
                    },
                    {
                        $inc: {
                            stock: -purchaseQuantity
                        }
                    },
                    {
                        new: true,
                        session
                    }
                );

                if (!myProduct) {
                    const existingProduct = await Product.findOne({
                        _id: product,
                        isActive: true
                    }).session(session);

                    const stockError = new Error(
                        existingProduct
                            ? "Not enough stock"
                            : "Product not found or unavailable"
                    );
                    stockError.statusCode = existingProduct ? 409 : 404;
                    stockError.responseBody = existingProduct
                        ? { error: "Not enough stock" }
                        : { error: "Product not found or unavailable" };
                    throw stockError;
                }

                const price = myProduct.price;
                const totalPrice = price * purchaseQuantity;
                const [myPurchase] = await Purchase.create(
                    [{
                        user: req.user.id,
                        product: myProduct._id,
                        quantity: purchaseQuantity,
                        price,
                        totalPrice,
                        status: "pending"
                    }],
                    { session }
                );

                purchaseId = myPurchase._id;
            });

            if (!purchaseId) {
                throw new Error("Purchase could not be created");
            }

            await productListCache.invalidate();

            const purchaseData = await Purchase.findById(
                purchaseId
            )
                .populate("product", "name slug price imgURL");

            return res.status(201).json({
                message: "Purchase created",
                data: purchaseData
            });
        } finally {
            if (session) {
                await session.endSession();
            }
        }

    } catch (err) {

        logger.logError("purchases.create.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(
            err.statusCode || 500
        ).json(
            err.responseBody || {
                error: "Error creating purchase",
                message: "An unexpected error occurred"
            }
        );

    }
};


// Checkout is handled by order.service.js now.
exports.checkout = async (req, res) => {

    return res.status(410).json({
        error: "This checkout endpoint is no longer supported",
        message: "Please use the order checkout endpoint instead"
    });

};