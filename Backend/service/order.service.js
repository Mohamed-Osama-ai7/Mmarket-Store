const mongoose = require("mongoose");
const crypto = require("node:crypto");

const Order = require("../model/order.model");
const Cart = require("../model/cart.model");
const Product = require("../model/product.model");
const Payment = require("../model/payment.model");
const productListCache = require("../utilities/productListCache");


const createServiceError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.isOperational = true;

    return error;
};


// Checkout cart and create one order.
const checkoutCart = async ({
    userId,
    idempotencyKey,
    deliveryDetails = {},
}) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw createServiceError(
            "Invalid user ID",
            400
        );
    }

    if (
        typeof idempotencyKey !== "string" ||
        !idempotencyKey.trim()
    ) {
        throw createServiceError(
            "Idempotency-Key header is required",
            400
        );
    }

    const cleanIdempotencyKey = idempotencyKey.trim();

    if (cleanIdempotencyKey.length > 200) {
        throw createServiceError(
            "Idempotency key is too long",
            400
        );
    }


    // Return the existing order for a repeated checkout request.
    const existingOrder = await Order.findOne({
        user: userId,
        idempotencyKey: cleanIdempotencyKey
    });

    if (existingOrder) {
        return {
            order: existingOrder,
            alreadyCreated: true
        };
    }


    const session = await mongoose.startSession();

    try {
        let orderId = null;
        let alreadyCreated = false;
        let productStockChanged = false;

        await session.withTransaction(async () => {
            productStockChanged = false;

            // Check again inside the transaction.
            const duplicateOrder = await Order.findOne({
                user: userId,
                idempotencyKey: cleanIdempotencyKey
            }).session(session);

            if (duplicateOrder) {
                orderId = duplicateOrder._id;
                alreadyCreated = true;
                return;
            }


            // Get the user's cart.
            const cart = await Cart.findOne({
                user: userId
            }).session(session);

            if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
                throw createServiceError(
                    "Cart is empty",
                    400
                );
            }


            const orderItems = [];
            let subtotal = 0;


            // Validate products and reserve stock.
            for (const cartItem of cart.items) {
                const quantity = cartItem.quantity;

                if (
                    !Number.isInteger(quantity) ||
                    quantity < 1
                ) {
                    throw createServiceError(
                        "Invalid cart quantity",
                        400
                    );
                }

                if (
                    !cartItem.product ||
                    !mongoose.Types.ObjectId.isValid(cartItem.product)
                ) {
                    throw createServiceError(
                        "Invalid product in cart",
                        400
                    );
                }


                // Only active products can be purchased.
                const product = await Product.findOne({
                    _id: cartItem.product,
                    isActive: true
                }).session(session);

                if (!product) {
                    throw createServiceError(
                        "One or more products are unavailable",
                        400
                    );
                }


                const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
                const selectedVariant = hasVariants
                    ? product.variants.find(variant => String(variant._id) === String(cartItem.variantId || "") && variant.isActive !== false)
                    : null;
                if (hasVariants && !selectedVariant) {
                    throw createServiceError(`Choose an available size/color option for ${product.name}`, 400);
                }
                if (!hasVariants && cartItem.variantId) {
                    throw createServiceError(`The selected option for ${product.name} is no longer available`, 409);
                }

                // Atomically reserve both aggregate product stock and the chosen SKU stock.
                const stockFilter = {
                    _id: product._id,
                    isActive: true,
                    stock: { $gte: quantity }
                };
                const stockUpdate = { $inc: { stock: -quantity } };
                if (selectedVariant) {
                    stockFilter.variants = { $elemMatch: { _id: selectedVariant._id, isActive: true, stock: { $gte: quantity } } };
                    stockUpdate.$inc["variants.$.stock"] = -quantity;
                }
                const updatedProduct = await Product.findOneAndUpdate(stockFilter, stockUpdate, {
                    new: true,
                    session,
                    runValidators: true
                });

                if (!updatedProduct) {
                    throw createServiceError(
                        `Not enough stock for the selected option of ${product.name}`,
                        409
                    );
                }

                productStockChanged = true;
                const reservedVariant = selectedVariant ? updatedProduct.variants.find(variant => String(variant._id) === String(selectedVariant._id)) : null;
                const unitPrice = Number(reservedVariant?.price ?? updatedProduct.price);
                const totalPrice = unitPrice * quantity;

                if (
                    !Number.isFinite(unitPrice) ||
                    !Number.isFinite(totalPrice)
                ) {
                    throw createServiceError(
                        "Invalid product price",
                        400
                    );
                }

                orderItems.push({
                    product: updatedProduct._id,
                    name: updatedProduct.name,
                    slug: updatedProduct.slug,
                    ...(reservedVariant ? { variantId: reservedVariant._id, size: reservedVariant.size, color: reservedVariant.color, sku: reservedVariant.sku } : {}),
                    quantity,
                    unitPrice,
                    totalPrice
                });

                subtotal += totalPrice;
            }


            // Shipping fees remain out of scope; delivery contact details are saved as an order snapshot.
            const discount = 0;
            const total = Number((subtotal - discount).toFixed(2));

            if (
                !Number.isFinite(subtotal) ||
                !Number.isFinite(total) ||
                subtotal < 0 ||
                total < 0
            ) {
                throw createServiceError(
                    "Invalid order total",
                    400
                );
            }


            // Create a single order for the whole cart.
            const createdOrders = await Order.create(
                [
                    {
                        user: userId,
                        deliveryDetails: {
                            name: String(deliveryDetails.name || "").trim(),
                            phone: String(deliveryDetails.phone || "").trim(),
                            address: String(deliveryDetails.address || "").trim()
                        },
                        items: orderItems,
                        subtotal,
                        discount,
                        total,
                        currency: "EGP",
                        orderStatus: "pending",
                        paymentStatus: "pending",
                        refundStatus: "not_required",
                        cancelledAt: null,
                        completedAt: null,
                        stockReleasedAt: null,
                        idempotencyKey: cleanIdempotencyKey
                    }
                ],
                {
                    session
                }
            );

            orderId = createdOrders[0]._id;


            // Clear the cart in the same transaction.
            cart.items = [];

            await cart.save({
                session
            });
        });

        if (productStockChanged) {
            await productListCache.invalidate();
        }

        const order = await Order.findById(orderId);

        if (!order) {
            throw createServiceError(
                "Order could not be retrieved after checkout",
                500
            );
        }

        return {
            order,
            alreadyCreated
        };

    } catch (err) {
        // Recover from a duplicate idempotency-key insertion.
        if (err.code === 11000) {
            const duplicateOrder = await Order.findOne({
                user: userId,
                idempotencyKey: cleanIdempotencyKey
            });

            if (duplicateOrder) {
                return {
                    order: duplicateOrder,
                    alreadyCreated: true
                };
            }
        }

        throw err;

    } finally {
        await session.endSession();
    }
};


// Get all orders belonging to the logged-in user.
const getUserOrders = async userId => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        throw createServiceError(
            "Invalid user ID",
            400
        );
    }

    return Order.find({
        user: userId
    })
        .sort({
            createdAt: -1
        })
        .lean();
};


// Get one order belonging to the logged-in user.
const getUserOrderById = async ({
    userId,
    orderId
}) => {
    if (
        !mongoose.Types.ObjectId.isValid(orderId) ||
        !mongoose.Types.ObjectId.isValid(userId)
    ) {
        throw createServiceError(
            "Invalid user ID or order ID",
            400
        );
    }

    const order = await Order.findOne({
        _id: orderId,
        user: userId
    }).lean();

    if (!order) {
        throw createServiceError(
            "Order not found",
            404
        );
    }

    return order;
};


// Update order status and restore stock when cancellation is allowed.
const updateOrderStatus = async ({
    orderId,
    status,
    userId,
    guestAccessToken
}) => {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
        throw createServiceError(
            "Invalid order ID",
            400
        );
    }

    const allowedStatuses = [
        "pending",
        "confirmed",
        "processing",
        "completed",
        "cancelled"
    ];

    if (!allowedStatuses.includes(status)) {
        throw createServiceError(
            "Invalid order status",
            400
        );
    }

    if (userId && (!mongoose.Types.ObjectId.isValid(userId) || status !== "cancelled")) {
        throw createServiceError("Invalid customer order action", 400);
    }
    if (guestAccessToken !== undefined && status !== "cancelled") {
        throw createServiceError("Invalid guest order action", 400);
    }

    const session = await mongoose.startSession();

    try {
        let updatedOrder;
        let productStockChanged = false;

        await session.withTransaction(async () => {
            productStockChanged = false;

            const orderQuery = userId ? { _id: orderId, user: userId } : guestAccessToken !== undefined ? { _id: orderId, user: null } : null;
            let orderQueryResult = userId || guestAccessToken !== undefined
                ? Order.findOne(orderQuery)
                : Order.findById(orderId);
            if (guestAccessToken !== undefined) orderQueryResult = orderQueryResult.select("+guestAccessTokenHash");
            const order = await orderQueryResult.session(session);

            if (!order) {
                throw createServiceError(
                    "Order not found",
                    404
                );
            }

            // Customers may cancel only their own early-stage, unpaid orders.
            if (guestAccessToken !== undefined && !guestTokenMatches(guestAccessToken, order.guestAccessTokenHash)) {
                throw createServiceError("Order not found or access token is invalid", 404);
            }
            if ((userId || guestAccessToken !== undefined) && (!['pending', 'confirmed'].includes(order.orderStatus) || order.paymentStatus !== 'pending')) {
                throw createServiceError(
                    "This order can no longer be cancelled online. Contact support for help.",
                    409
                );
            }

            const allowedTransitions = {
                pending: [
                    "confirmed",
                    "cancelled"
                ],
                confirmed: [
                    "processing",
                    "cancelled"
                ],
                processing: [
                    "completed",
                    "cancelled"
                ],
                completed: [],
                cancelled: []
            };

            if (
                !allowedTransitions[order.orderStatus] ||
                !allowedTransitions[order.orderStatus].includes(status)
            ) {
                throw createServiceError(
                    `Cannot change order status from ${order.orderStatus} to ${status}`,
                    400
                );
            }


            // A paid order must be refunded before it can be cancelled.
            // This service does not perform refunds itself.
            if (
                status === "cancelled" &&
                order.paymentStatus === "paid"
            ) {
                throw createServiceError(
                    "A paid order must be refunded before cancellation",
                    400
                );
            }


            // Restore stock exactly once when cancelling.
            if (status === "cancelled") {
                if (order.stockReleasedAt) {
                    throw createServiceError(
                        "Stock has already been released for this order",
                        409
                    );
                }

                for (const item of order.items) {
                    const stockFilter = { _id: item.product };
                    const stockIncrement = {};
                    if (item.variantId) {
                        const currentProduct = await Product.findById(item.product).select("variants").session(session);
                        const currentVariant = currentProduct?.variants.find(variant => String(variant._id) === String(item.variantId));
                        if (!currentVariant) throw createServiceError(`Cannot restore stock for product option: ${item.name}`, 409);
                        stockFilter.variants = { $elemMatch: { _id: item.variantId } };
                        stockIncrement["variants.$.stock"] = item.quantity;
                        // Disabled options retain order history but must not re-enter sellable aggregate stock.
                        if (currentVariant.isActive !== false) stockIncrement.stock = item.quantity;
                    } else {
                        stockIncrement.stock = item.quantity;
                    }
                    const restoredProduct = await Product.updateOne(stockFilter, { $inc: stockIncrement }, { session });

                    if (restoredProduct.matchedCount !== 1) {
                        throw createServiceError(
                            `Cannot restore stock for product option: ${item.name}`,
                            409
                        );
                    }
                    productStockChanged = true;
                }

                order.stockReleasedAt = new Date();
                order.cancelledAt = new Date();

                // Keep a pending COD payment record consistent with the cancelled order.
                await Payment.updateOne(
                    { order: order._id, status: 'pending' },
                    { $set: { status: 'cancelled' } },
                    { session }
                );
            }


            // A course-project order is completed after its COD payment is confirmed.
            if (status === "completed") {
                if (order.paymentStatus !== "paid") {
                    throw createServiceError(
                        "Confirm the cash-on-delivery payment before completing this order",
                        400
                    );
                }
                order.completedAt = new Date();
            }


            order.orderStatus = status;

            await order.save({
                session
            });

            updatedOrder = order;
        });

        if (productStockChanged) {
            await productListCache.invalidate();
        }

        if (guestAccessToken !== undefined && updatedOrder) updatedOrder.guestAccessTokenHash = undefined;
        return updatedOrder;

    } finally {
        await session.endSession();
    }
};




const hashGuestAccessToken = (token) => crypto.createHash("sha256").update(token, "utf8").digest("hex");

const guestTokenMatches = (providedToken, expectedHash) => {
    if (typeof providedToken !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(providedToken) || typeof expectedHash !== "string") return false;
    const actual = Buffer.from(hashGuestAccessToken(providedToken), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

// Public checkout for guests. Product prices and stock are always verified by the server.
const checkoutGuestOrder = async ({ guestName, guestEmail, items, idempotencyKey, guestAccessToken }) => {
    const cleanName = typeof guestName === "string" ? guestName.trim().replace(/\s+/g, " ") : "";
    const cleanEmail = typeof guestEmail === "string" ? guestEmail.trim().toLowerCase() : "";
    if (cleanName.length < 2 || cleanName.length > 100) throw createServiceError("Enter a name between 2 and 100 characters", 400);
    if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw createServiceError("Enter a valid email address", 400);
    if (!Array.isArray(items) || items.length < 1 || items.length > 25) throw createServiceError("Guest checkout requires between 1 and 25 cart items", 400);
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{12,200}$/.test(idempotencyKey.trim())) throw createServiceError("A valid Idempotency-Key is required", 400);
    if (typeof guestAccessToken !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(guestAccessToken)) throw createServiceError("A valid guest order access token is required", 400);

    const normalizedItems = [];
    const seenLines = new Set();
    for (const item of items) {
        const productId = typeof item?.product === "string" ? item.product : "";
        const quantity = item?.quantity;
        const rawVariantId = item?.variantId === undefined || item?.variantId === null || item?.variantId === "" ? "" : item.variantId;
        if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || (rawVariantId && (typeof rawVariantId !== "string" || !mongoose.Types.ObjectId.isValid(rawVariantId)))) {
            throw createServiceError("One or more cart items are invalid", 400);
        }
        const canonicalId = new mongoose.Types.ObjectId(productId).toString();
        const canonicalVariantId = rawVariantId ? new mongoose.Types.ObjectId(rawVariantId).toString() : "";
        const lineKey = `${canonicalId}:${canonicalVariantId}`;
        if (seenLines.has(lineKey)) throw createServiceError("A product option can appear only once in the guest cart", 400);
        seenLines.add(lineKey);
        normalizedItems.push({ product: canonicalId, variantId: canonicalVariantId || undefined, quantity });
    }

    const cleanKey = idempotencyKey.trim();
    const tokenHash = hashGuestAccessToken(guestAccessToken);
    const findDuplicate = async (session = null) => {
        let query = Order.findOne({ user: null, idempotencyKey: cleanKey }).select("+guestAccessTokenHash");
        if (session) query = query.session(session);
        const existing = await query;
        if (!existing) return null;
        if (!guestTokenMatches(guestAccessToken, existing.guestAccessTokenHash)) {
            throw createServiceError("This checkout key has already been used. Start a new checkout", 409);
        }
        existing.guestAccessTokenHash = undefined;
        return existing;
    };

    const existingOrder = await findDuplicate();
    if (existingOrder) return { order: existingOrder, alreadyCreated: true };

    const session = await mongoose.startSession();
    let orderId = null;
    let stockChanged = false;
    let alreadyCreated = false;
    try {
        await session.withTransaction(async () => {
            stockChanged = false;
            alreadyCreated = false;
            const duplicate = await findDuplicate(session);
            if (duplicate) {
                orderId = duplicate._id;
                alreadyCreated = true;
                return;
            }

            const orderItems = [];
            let subtotal = 0;
            for (const item of normalizedItems) {
                const product = await Product.findOne({ _id: item.product, isActive: true }).session(session);
                if (!product) throw createServiceError("One or more products are unavailable", 400);
                const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
                const selectedVariant = hasVariants
                    ? product.variants.find(variant => String(variant._id) === String(item.variantId || "") && variant.isActive !== false)
                    : null;
                if (hasVariants && !selectedVariant) throw createServiceError(`Choose an available size/color option for ${product.name}`, 400);
                if (!hasVariants && item.variantId) throw createServiceError(`The selected option for ${product.name} is no longer available`, 409);
                const stockFilter = { _id: product._id, isActive: true, stock: { $gte: item.quantity } };
                const stockUpdate = { $inc: { stock: -item.quantity } };
                if (selectedVariant) {
                    stockFilter.variants = { $elemMatch: { _id: selectedVariant._id, isActive: true, stock: { $gte: item.quantity } } };
                    stockUpdate.$inc["variants.$.stock"] = -item.quantity;
                }
                const updatedProduct = await Product.findOneAndUpdate(stockFilter, stockUpdate, { new: true, session, runValidators: true });
                if (!updatedProduct) throw createServiceError(`Not enough stock for the selected option of ${product.name}`, 409);
                stockChanged = true;
                const reservedVariant = selectedVariant ? updatedProduct.variants.find(variant => String(variant._id) === String(selectedVariant._id)) : null;
                const unitPrice = Number(reservedVariant?.price ?? updatedProduct.price);
                const totalPrice = Number((unitPrice * item.quantity).toFixed(2));
                if (!Number.isFinite(unitPrice) || !Number.isFinite(totalPrice) || unitPrice < 0) throw createServiceError("Invalid product price", 400);
                orderItems.push({ product: updatedProduct._id, name: updatedProduct.name, slug: updatedProduct.slug, ...(reservedVariant ? { variantId: reservedVariant._id, size: reservedVariant.size, color: reservedVariant.color, sku: reservedVariant.sku } : {}), quantity: item.quantity, unitPrice, totalPrice });
                subtotal += totalPrice;
            }
            subtotal = Number(subtotal.toFixed(2));
            const [createdOrder] = await Order.create([{
                user: null,
                guestName: cleanName,
                guestEmail: cleanEmail,
                guestAccessTokenHash: tokenHash,
                items: orderItems,
                subtotal,
                discount: 0,
                total: subtotal,
                currency: "EGP",
                orderStatus: "confirmed",
                paymentStatus: "pending",
                refundStatus: "not_required",
                cancelledAt: null,
                completedAt: null,
                stockReleasedAt: null,
                idempotencyKey: cleanKey
            }], { session });
            orderId = createdOrder._id;
            await Payment.create([{
                user: null,
                guestEmail: cleanEmail,
                order: createdOrder._id,
                amount: subtotal,
                currency: "EGP",
                method: "cash_on_delivery",
                provider: "manual",
                status: "pending",
                refundedAmount: 0,
                refundStatus: "not_required",
                refundedAt: null,
                paidAt: null,
                idempotencyKey: `guest-${createdOrder._id.toString()}`
            }], { session });
        });
        if (stockChanged) await productListCache.invalidate();
        const order = await Order.findById(orderId);
        if (!order) throw createServiceError("Order could not be retrieved after checkout", 500);
        return { order, alreadyCreated };
    } catch (error) {
        if (error.code === 11000) {
            const duplicate = await findDuplicate();
            if (duplicate) return { order: duplicate, alreadyCreated: true };
        }
        throw error;
    } finally {
        await session.endSession();
    }
};

const getGuestOrderByToken = async ({ orderId, guestAccessToken }) => {
    if (!mongoose.Types.ObjectId.isValid(orderId)) throw createServiceError("Order not found", 404);
    if (typeof guestAccessToken !== "string") throw createServiceError("Guest order access is required", 401);
    const order = await Order.findOne({ _id: orderId, user: null }).select("+guestAccessTokenHash");
    if (!order || !guestTokenMatches(guestAccessToken, order.guestAccessTokenHash)) throw createServiceError("Order not found or access token is invalid", 404);
    const data = order.toObject();
    delete data.guestAccessTokenHash;
    return data;
};

module.exports = {
    checkoutCart,
    checkoutGuestOrder,
    getGuestOrderByToken,
    getUserOrders,
    getUserOrderById,
    updateOrderStatus
};