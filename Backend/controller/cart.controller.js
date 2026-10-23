const mongoose = require("mongoose");
const Cart = require("../model/cart.model");
const Product = require("../model/product.model");
const AppError = require("../utilities/appError");

const PRODUCT_FIELDS = "name slug price stock imgURL isActive variants";
const variantIdFrom = value => typeof value === "string" && mongoose.Types.ObjectId.isValid(value) ? value : "";
const findActiveVariant = (product, variantId) => {
    if (!product || !Array.isArray(product.variants) || !product.variants.length || !variantId) return null;
    return product.variants.find(variant => String(variant._id) === String(variantId) && variant.isActive !== false) || null;
};
const variantOfItem = item => {
    const product = item?.product;
    if (!product || !Array.isArray(product.variants) || !product.variants.length) return null;
    return findActiveVariant(product, item.variantId);
};
const cartResponse = (cart, message = "cart found") => {
    const items = (cart?.items || []).filter(item => item.product).map(item => {
        const plain = typeof item.toObject === "function" ? item.toObject() : { ...item };
        const variant = variantOfItem(item);
        plain.productUnavailable = item.product.isActive === false;
        plain.variantUnavailable = Boolean(!plain.productUnavailable && item.product.variants?.length && !variant);
        return plain;
    });
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = Number(items.reduce((sum, item) => {
        if (item.productUnavailable || item.variantUnavailable) return sum;
        const variant = variantOfItem(item);
        const unitPrice = variant?.price ?? item.product.price;
        return sum + Number(unitPrice || 0) * item.quantity;
    }, 0).toFixed(2));
    return {
        message,
        data: {
            _id: cart?._id,
            user: cart?.user,
            items,
            totalItems,
            totalPrice
        }
    };
};
const populateCart = id => Cart.findById(id).populate("items.product", PRODUCT_FIELDS);

// Get logged-in user's cart. Variant-aware totals are computed from the selected SKU price.
exports.getCart = async (req, res, next) => {
    try {
        const cart = await Cart.findOne({ user: req.user.id }).populate("items.product", PRODUCT_FIELDS);
        return res.status(200).json(cartResponse(cart, cart ? "cart found" : "cart is empty"));
    } catch (err) {
        return next(err);
    }
};

// Add either a legacy simple product or one explicit SKU-level variant to the cart.
exports.addToCart = async (req, res, next) => {
    try {
        const { product, quantity } = req.body || {};
        const variantId = req.body?.variantId === undefined || req.body?.variantId === null || req.body?.variantId === "" ? "" : variantIdFrom(req.body.variantId);
        if (!product || quantity === undefined) return res.status(400).json({ error: "Product and quantity are required" });
        if (!mongoose.Types.ObjectId.isValid(product)) return res.status(400).json({ error: "Invalid product ID" });
        if (req.body?.variantId && !variantId) return res.status(400).json({ error: "Invalid product variant" });
        const cartQuantity = Number(quantity);
        if (!Number.isInteger(cartQuantity) || cartQuantity < 1 || cartQuantity > 20) return res.status(400).json({ error: "Quantity must be a whole number between 1 and 20" });

        const productRecord = await Product.findOne({ _id: product, isActive: true });
        if (!productRecord) return res.status(404).json({ error: "Product not found" });
        if (productRecord.variants?.length && !variantId) return res.status(400).json({ error: "Choose a size/color option before adding this product to your cart" });
        const variant = productRecord.variants?.length ? findActiveVariant(productRecord, variantId) : null;
        if (variantId && !variant) return res.status(404).json({ error: "This product option is no longer available" });
        const availableStock = variant ? variant.stock : productRecord.stock;
        if (cartQuantity > availableStock) return res.status(400).json({ error: "Requested quantity exceeds available stock for this option" });

        let cart = await Cart.findOne({ user: req.user.id });
        if (!cart) {
            cart = await Cart.create({ user: req.user.id, items: [{ product: productRecord._id, ...(variant ? { variantId: variant._id } : {}), quantity: cartQuantity }] });
            const populated = await populateCart(cart._id);
            return res.status(201).json(cartResponse(populated, "product added to cart"));
        }

        const selectedVariantId = variant ? String(variant._id) : "";
        const existingItem = cart.items.find(item => String(item.product) === String(productRecord._id) && String(item.variantId || "") === selectedVariantId);
        const newQuantity = (existingItem?.quantity || 0) + cartQuantity;
        if (newQuantity > availableStock) return res.status(400).json({ error: "Requested quantity exceeds available stock for this option" });
        if (existingItem) existingItem.quantity = newQuantity;
        else cart.items.push({ product: productRecord._id, ...(variant ? { variantId: variant._id } : {}), quantity: cartQuantity });
        await cart.save();
        return res.status(200).json(cartResponse(await populateCart(cart._id), "product added to cart"));
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: "Cart already exists for this user" });
        return next(err);
    }
};

// Merge a browser-persisted guest cart only after the customer authenticates.
// A per-user key makes network retries idempotent and prevents adding the same cart twice.
exports.mergeGuestCart = async (req, res, next) => {
    const guestCartId = typeof req.body?.guestCartId === "string" ? req.body.guestCartId.trim() : "";
    const inputItems = req.body?.items;
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(guestCartId)) return res.status(400).json({ error: "Invalid guest cart identifier" });
    if (!Array.isArray(inputItems) || inputItems.length > 100) return res.status(400).json({ error: "Guest cart items must be a list of at most 100 items" });
    if (!inputItems.length) {
        const empty = await Cart.findOne({ user: req.user.id }).populate("items.product", PRODUCT_FIELDS);
        return res.status(200).json(cartResponse(empty, "No guest items to merge"));
    }

    const User = require("../model/user.model");
    const session = await mongoose.startSession();
    let cartId = null;
    let alreadyMerged = false;
    try {
        await session.withTransaction(async () => {
            const user = await User.findById(req.user.id).select("+mergedGuestCartKeys").session(session);
            if (!user || user.isActive !== true) {
                throw new AppError("Account unavailable", 401);
            }
            if ((user.mergedGuestCartKeys || []).includes(guestCartId)) {
                alreadyMerged = true;
                const currentCart = await Cart.findOne({ user: req.user.id }).session(session);
                cartId = currentCart?._id || null;
                return;
            }

            let cart = await Cart.findOne({ user: req.user.id }).session(session);
            if (!cart) cart = new Cart({ user: req.user.id, items: [] });

            for (const line of inputItems) {
                const productId = typeof line?.product === "string" ? line.product : "";
                const quantity = Number(line?.quantity);
                const variantId = line?.variantId === undefined || line?.variantId === null || line?.variantId === "" ? "" : variantIdFrom(line.variantId);
                if (!mongoose.Types.ObjectId.isValid(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20 || (line?.variantId && !variantId)) {
                    throw new AppError("Guest cart contains an invalid product, variant, or quantity", 400);
                }
                const product = await Product.findOne({ _id: productId, isActive: true }).session(session);
                if (!product) { throw new AppError("A guest-cart product is no longer available", 409); }
                const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
                const variant = hasVariants ? findActiveVariant(product, variantId) : null;
                if ((hasVariants && !variant) || (!hasVariants && variantId)) {
                    throw new AppError(`Choose an available size/color option for ${product.name}`, 409);
                }
                const variantKey = variant ? String(variant._id) : "";
                const existing = cart.items.find(item => String(item.product) === String(product._id) && String(item.variantId || "") === variantKey);
                const nextQuantity = Number(existing?.quantity || 0) + quantity;
                const availableStock = variant ? Number(variant.stock) : Number(product.stock);
                if (nextQuantity > availableStock) { throw new AppError(`Not enough stock to merge ${product.name} into your account cart`, 409); }
                if (existing) existing.quantity = nextQuantity;
                else cart.items.push({ product: product._id, ...(variant ? { variantId: variant._id } : {}), quantity });
            }

            await cart.save({ session });
            user.mergedGuestCartKeys = [...(user.mergedGuestCartKeys || []), guestCartId].slice(-20);
            await user.save({ session });
            cartId = cart._id;
        });
        const populated = cartId ? await populateCart(cartId) : await Cart.findOne({ user: req.user.id }).populate("items.product", PRODUCT_FIELDS);
        return res.status(200).json(cartResponse(populated, alreadyMerged ? "Guest cart was already merged" : "Guest cart merged successfully"));
    } catch (error) {
        return next(error);
    } finally {
        await session.endSession();
    }
};

// Update quantity for a selected product/variant line.
exports.updateCartItem = async (req, res, next) => {
    try {
        const { productId } = req.params;
        const variantId = req.query?.variantId ? variantIdFrom(req.query.variantId) : "";
        const quantity = req.body?.quantity;
        if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ error: "Invalid product ID" });
        if (req.query?.variantId && !variantId) return res.status(400).json({ error: "Invalid product variant" });
        if (quantity === undefined) return res.status(400).json({ error: "Quantity is required" });
        const cartQuantity = Number(quantity);
        if (!Number.isInteger(cartQuantity) || cartQuantity < 1 || cartQuantity > 20) return res.status(400).json({ error: "Quantity must be a whole number between 1 and 20" });

        const product = await Product.findOne({ _id: productId, isActive: true });
        if (!product) return res.status(404).json({ error: "Product not found" });
        if (product.variants?.length && !variantId) return res.status(400).json({ error: "Choose a valid product option" });
        const variant = product.variants?.length ? findActiveVariant(product, variantId) : null;
        if (variantId && !variant) return res.status(404).json({ error: "This product option is no longer available" });
        const stockLimit = variant ? variant.stock : product.stock;
        if (cartQuantity > stockLimit) return res.status(400).json({ error: "Requested quantity exceeds available stock for this option" });

        const cart = await Cart.findOne({ user: req.user.id });
        if (!cart) return res.status(404).json({ error: "Cart not found" });
        const selectedVariantId = variant ? String(variant._id) : "";
        const item = cart.items.find(entry => String(entry.product) === String(productId) && String(entry.variantId || "") === selectedVariantId);
        if (!item) return res.status(404).json({ error: "Product option not found in cart" });
        item.quantity = cartQuantity;
        await cart.save();
        return res.status(200).json(cartResponse(await populateCart(cart._id), "cart item updated"));
    } catch (err) {
        return next(err);
    }
};

// Remove a single variant line when its ID is supplied; preserve legacy remove-by-product behavior otherwise.
exports.removeFromCart = async (req, res, next) => {
    try {
        const { productId } = req.params;
        const rawVariantId = typeof req.query?.variantId === "string" ? req.query.variantId : "";
        const variantId = rawVariantId && rawVariantId !== "none" ? variantIdFrom(rawVariantId) : "";
        const exactLegacyLine = rawVariantId === "none";
        if (!mongoose.Types.ObjectId.isValid(productId)) return res.status(400).json({ error: "Invalid product ID" });
        if (rawVariantId && !exactLegacyLine && !variantId) return res.status(400).json({ error: "Invalid product variant" });
        const cart = await Cart.findOne({ user: req.user.id });
        if (!cart) return res.status(404).json({ error: "Cart not found" });
        const before = cart.items.length;
        cart.items = cart.items.filter(item => {
            const sameProduct = String(item.product) === String(productId);
            const sameVariant = exactLegacyLine ? !item.variantId : variantId ? String(item.variantId || "") === variantId : true;
            return !(sameProduct && sameVariant);
        });
        if (cart.items.length === before) return res.status(404).json({ error: "Product option not found in cart" });
        await cart.save();
        return res.status(200).json(cartResponse(await populateCart(cart._id), "product removed from cart"));
    } catch (err) {
        return next(err);
    }
};

// Clear every line from the logged-in user's cart.
exports.clearCart = async (req, res, next) => {
    try {
        const cart = await Cart.findOne({ user: req.user.id });
        if (!cart) {
            return res.status(200).json({
                message: "cart cleared successfully",
                data: {
                    items: [],
                    totalItems: 0,
                    totalPrice: 0
                }
            });
        }
        cart.items = [];
        await cart.save();
        return res.status(200).json(cartResponse(cart, "cart cleared successfully"));
    } catch (err) {
        return next(err);
    }
};
