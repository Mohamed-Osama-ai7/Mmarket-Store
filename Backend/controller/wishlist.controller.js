const mongoose = require("mongoose");

const Wishlist = require("../model/wishlist.model");
const Product = require("../model/product.model");


// Get user's wishlist
exports.getWishlist = async (req, res, next) => {
    try {
        const wishlist = await Wishlist.findOne({
            user: req.user.id
        }).populate({
            path: "products",
            select: "name slug price stock imgURL images category isActive variants brand sku garmentType audience",
            match: {
                isActive: true
            }
        });

        if (!wishlist) {
            return res.status(200).json({
                message: "wishlist is empty",
                data: {
                    products: [],
                    totalProducts: 0
                }
            });
        }

        // Inactive/deleted products are filtered by populate match.
        const activeProducts = wishlist.products.filter(
            product => product
        );

        return res.status(200).json({
            message: "wishlist found",
            data: {
                _id: wishlist._id,
                user: wishlist.user,
                products: activeProducts,
                totalProducts: activeProducts.length
            }
        });

    } catch (err) {
        return next(err);
    }
};


// Add product to wishlist
exports.addToWishlist = async (req, res, next) => {
    try {
        const { productId } = req.params;

        // Validate product ID
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        // Product must exist and be active
        const product = await Product.findOne({
            _id: productId,
            isActive: true
        });

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }

        let wishlist = await Wishlist.findOne({
            user: req.user.id
        });

        // Create wishlist if user does not have one
        if (!wishlist) {
            try {
                wishlist = await Wishlist.create({
                    user: req.user.id,
                    products: [product._id]
                });
            } catch (err) {
                // Another concurrent request may have created
                // the wishlist for the same user.
                if (err.code === 11000) {
                    wishlist = await Wishlist.findOne({
                        user: req.user.id
                    });

                    if (!wishlist) {
                        throw err;
                    }
                } else {
                    throw err;
                }
            }

            // If the wishlist was created by this request,
            // the product is already inside it.
            if (wishlist.products.some(
                item => item.toString() === product._id.toString()
            )) {
                const wishlistData = await Wishlist.findById(
                    wishlist._id
                ).populate({
                    path: "products",
                    select: "name slug price stock imgURL images category isActive variants brand sku garmentType audience",
                    match: {
                        isActive: true
                    }
                });

                return res.status(201).json({
                    message: "Product added to wishlist",
                    data: wishlistData
                });
            }
        }

        // Prevent duplicate product
        const alreadyExists = wishlist.products.some(
            item => item.toString() === product._id.toString()
        );

        if (alreadyExists) {
            return res.status(409).json({
                error: "Product already exists in wishlist"
            });
        }

        /*
         * Use $addToSet instead of push to prevent duplicate
         * products even if concurrent requests happen.
         */
        const updatedWishlist = await Wishlist.findOneAndUpdate(
            {
                _id: wishlist._id,
                user: req.user.id,
                products: {
                    $ne: product._id
                }
            },
            {
                $addToSet: {
                    products: product._id
                }
            },
            {
                new: true,
                runValidators: true
            }
        );

        // If another request added the product first
        if (!updatedWishlist) {
            return res.status(409).json({
                error: "Product already exists in wishlist"
            });
        }

        const wishlistData = await Wishlist.findById(
            updatedWishlist._id
        ).populate({
            path: "products",
            select: "name slug price stock imgURL images category isActive variants brand sku garmentType audience",
            match: {
                isActive: true
            }
        });

        return res.status(200).json({
            message: "Product added to wishlist",
            data: wishlistData
        });

    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({
                error: "Wishlist already exists for this user"
            });
        }

        return next(err);
    }
};


// Remove product from wishlist
exports.removeFromWishlist = async (req, res, next) => {
    try {
        const { productId } = req.params;

        // Validate product ID
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        const wishlist = await Wishlist.findOne({
            user: req.user.id
        });

        if (!wishlist) {
            return res.status(404).json({
                error: "Wishlist not found"
            });
        }

        const productIndex = wishlist.products.findIndex(
            item => item.toString() === productId
        );

        if (productIndex === -1) {
            return res.status(404).json({
                error: "Product not found in wishlist"
            });
        }

        wishlist.products.splice(productIndex, 1);

        const updatedWishlist = await wishlist.save();

        const wishlistData = await Wishlist.findById(
            updatedWishlist._id
        ).populate({
            path: "products",
            select: "name slug price stock imgURL images category isActive variants brand sku garmentType audience",
            match: {
                isActive: true
            }
        });

        return res.status(200).json({
            message: "Product removed from wishlist",
            data: wishlistData
        });

    } catch (err) {
        return next(err);
    }
};


// Clear wishlist
exports.clearWishlist = async (req, res, next) => {
    try {
        const wishlist = await Wishlist.findOne({
            user: req.user.id
        });

        if (!wishlist) {
            return res.status(404).json({
                error: "Wishlist not found"
            });
        }

        // Keep the wishlist document and clear its products.
        wishlist.products = [];

        await wishlist.save();

        return res.status(200).json({
            message: "Wishlist cleared successfully",
            data: {
                products: [],
                totalProducts: 0
            }
        });

    } catch (err) {
        return next(err);
    }
};