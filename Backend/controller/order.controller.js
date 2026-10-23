const Order = require("../model/order.model");
const {
    checkoutCart,
    getGuestOrderByToken,
    getUserOrders,
    getUserOrderById,
    updateOrderStatus
} = require("../service/order.service");
const logger = require("../utilities/logger");
const User = require("../model/user.model");
const { notifyUser, notifyAdministrators } = require("../utilities/notificationPublisher");
const { sendOrderUpdateEmail } = require("../utilities/emailService");


// Get all orders of the logged-in user
exports.getOrders = async (req, res) => {
    try {
        const orders = await getUserOrders(req.user.id);

        return res.status(200).json({
            message: "Orders retrieved successfully",
            data: orders
        });

    } catch (err) {
        logger.logError("orders.list.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Failed to retrieve orders",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};



// Admin: list all orders for fulfilment management.
exports.getAdminOrders = async (req, res) => {
    const parsedPage = Number.parseInt(req.query.page, 10);
    const parsedPageSize = Number.parseInt(req.query.pageSize, 10);
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize = Number.isInteger(parsedPageSize) && parsedPageSize > 0
        ? Math.min(parsedPageSize, 100)
        : 50;

    try {
        const [orders, totalItems] = await Promise.all([
            Order.find()
                .populate("user", "name email")
                .sort({ createdAt: -1 })
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
            Order.countDocuments()
        ]);

        return res.status(200).json({
            message: "Orders retrieved successfully",
            data: orders,
            pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }
        });
    } catch (err) {
        logger.logError("orders.admin_list.failed", err, {
            requestId: req.id,
            method: req.method
        });
        return res.status(500).json({ error: "Failed to retrieve orders", message: "Internal server error" });
    }
};

// Get one order belonging to the logged-in user
exports.getOrderById = async (req, res) => {
    try {
        const order = await getUserOrderById({
            userId: req.user.id,
            orderId: req.params.id
        });

        return res.status(200).json({
            message: "Order retrieved successfully",
            data: order
        });

    } catch (err) {
        logger.logError("orders.get_by_id.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Failed to retrieve order",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};


// Checkout the cart and create an order
exports.checkout = async (req, res) => {
    try {
        const idempotencyKey = req.get("Idempotency-Key");

        if (
            typeof idempotencyKey !== "string" ||
            !idempotencyKey.trim()
        ) {
            return res.status(400).json({
                error: "Idempotency-Key header is required"
            });
        }

        const delivery = req.body?.deliveryDetails || {};
        const deliveryName = typeof delivery.name === "string" ? delivery.name.trim() : "";
        const deliveryPhone = typeof delivery.phone === "string" ? delivery.phone.trim() : "";
        const deliveryAddress = typeof delivery.address === "string" ? delivery.address.trim() : "";
        if (deliveryName.length < 2 || deliveryName.length > 100) {
            return res.status(400).json({ error: "Enter a valid delivery name." });
        }
        if (!/^[+()0-9 .-]{7,24}$/.test(deliveryPhone)) {
            return res.status(400).json({ error: "Enter a valid delivery phone number." });
        }
        if (deliveryAddress.length < 8 || deliveryAddress.length > 300) {
            return res.status(400).json({ error: "Enter a delivery address between 8 and 300 characters." });
        }
        const result = await checkoutCart({
            userId: req.user.id,
            idempotencyKey: idempotencyKey.trim(),
            deliveryDetails: { name: deliveryName, phone: deliveryPhone, address: deliveryAddress }
        });

        if (!result.alreadyCreated) {
            const shortOrderId = String(result.order?._id || "").slice(-8).toUpperCase();
            await notifyUser({
                recipient: req.user._id,
                type: "order_created",
                title: "Order received",
                message: `Your order #${shortOrderId} has been received.`,
                link: "/orders"
            });
            await sendOrderUpdateEmail({ user: req.user, order: result.order, subject: "Order received", message: "We have received your order and saved it to your account." });
            await notifyAdministrators({
                type: "order_created",
                title: "New store order",
                message: `Order #${shortOrderId} is waiting for fulfilment.`,
                link: "/dashboard/orders"
            });
        }

        return res.status(
            result.alreadyCreated ? 200 : 201
        ).json({
            message: result.alreadyCreated
                ? "Order already created"
                : "Order created successfully",
            data: result.order
        });

    } catch (err) {
        logger.logError("orders.checkout.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Checkout failed",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};



// Guest checkout is intentionally disabled. Guest carts are client-side only; orders must
// always be created through the authenticated checkout route. Keep this explicit handler
// so even a future accidental route reattachment cannot create a guest order.
exports.guestCheckout = async (req, res) => {
    return res.status(401).json({
        error: "Authentication required",
        message: "Sign up or log in to complete your order. Your cart has been kept."
    });
};

exports.getGuestOrder = async (req, res) => {
    try {
        const order = await getGuestOrderByToken({ orderId: req.params.id, guestAccessToken: req.get("X-Guest-Order-Token") });
        return res.status(200).json({ message: "Guest order retrieved successfully", data: order });
    } catch (error) {
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Could not retrieve guest order" });
    }
};

exports.cancelGuestOrder = async (req, res) => {
    try {
        const order = await updateOrderStatus({ orderId: req.params.id, status: "cancelled", guestAccessToken: req.get("X-Guest-Order-Token") });
        await sendOrderUpdateEmail({ user: { name: order.guestName, email: order.guestEmail }, order, subject: "Guest order cancelled", message: "Your guest order was cancelled and the reserved stock was returned to the catalogue." });
        await notifyAdministrators({ type: "order_status", title: "Guest order cancelled", message: `Guest order #${String(order._id).slice(-8).toUpperCase()} was cancelled.`, link: "/dashboard/orders" });
        return res.status(200).json({ message: "Guest order cancelled successfully", data: order });
    } catch (error) {
        logger.logError("orders.guest_cancellation.failed", error, { requestId: req.id, method: req.method });
        return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : "Could not cancel guest order" });
    }
};

// Update order status (Admin only)
exports.updateStatus = async (req, res) => {
    try {
        const order = await updateOrderStatus({
            orderId: req.params.id,
            status: req.body?.status
        });

        const orderOwnerId = order?.user?._id || order?.user;
        const shortOrderId = String(order._id || req.params.id).slice(-8).toUpperCase();
        if (orderOwnerId) {
            await notifyUser({ recipient: orderOwnerId, type: "order_status", title: "Order status updated", message: `Order #${shortOrderId} is now ${String(order.orderStatus || req.body?.status).replace(/_/g, " ")}.`, link: "/orders" });
            const customer = await User.findById(orderOwnerId).select("name email").lean();
            await sendOrderUpdateEmail({ user: customer, order, subject: "Order status updated", message: `Your order status is now ${String(order.orderStatus || req.body?.status).replace(/_/g, " ")}.` });
        } else if (order?.guestEmail) {
            await sendOrderUpdateEmail({ user: { name: order.guestName, email: order.guestEmail }, order, subject: "Guest order status updated", message: `Your guest order status is now ${String(order.orderStatus || req.body?.status).replace(/_/g, " ")}.` });
        }

        return res.status(200).json({
            message: "Order status updated successfully",
            data: order
        });

    } catch (err) {
        logger.logError("orders.status_update.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(err.statusCode || 500).json({
            error: "Failed to update order status",
            message: err.statusCode
                ? err.message
                : "Internal server error"
        });
    }
};

// Allow customers to cancel their own eligible unpaid order before processing.
exports.cancelMyOrder = async (req, res) => {
    try {
        const order = await updateOrderStatus({
            orderId: req.params.id,
            status: "cancelled",
            userId: req.user.id
        });
        await notifyUser({ recipient: req.user.id, type: "order_status", title: "Order cancelled", message: `Order #${String(order._id).slice(-8).toUpperCase()} was cancelled.`, link: "/orders" });
        await sendOrderUpdateEmail({ user: req.user, order, subject: "Order cancelled", message: "Your order was cancelled and the reserved stock was returned to the catalogue." });
        await notifyAdministrators({
            type: "order_status",
            title: "Customer cancelled an order",
            message: `Order #${String(order._id).slice(-8).toUpperCase()} was cancelled by its customer.`,
            link: "/dashboard/orders"
        });
        return res.status(200).json({
            message: "Order cancelled successfully",
            data: order
        });
    } catch (err) {
        logger.logError("orders.customer_cancellation.failed", err, {
            requestId: req.id,
            method: req.method
        });
        return res.status(err.statusCode || 500).json({
            error: err.statusCode ? err.message : "Failed to cancel order"
        });
    }
};

