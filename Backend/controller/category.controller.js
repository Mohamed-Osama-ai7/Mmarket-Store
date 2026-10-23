const mongoose = require("mongoose");

const Category = require("../model/category.model");
const Product = require("../model/product.model");
const productListCache = require("../utilities/productListCache");


// Get all active categories
exports.getCategories = async (req, res, next) => {
    try {

        const myCategories = await Category.find({
            isActive: true
        }).sort({
            createdAt: -1
        });

        res.status(200).json({
            message: "categories list",
            data: myCategories
        });

    } catch (err) {
        return next(err);
    }
};


// Get category by slug
exports.getCategoryBySlug = async (req, res, next) => {
    try {

        const { slug } = req.params;

        if (!slug || !slug.trim()) {
            return res.status(400).json({
                error: "Category slug is required"
            });
        }

        const myCategory = await Category.findOne({
            slug: slug.trim().toLowerCase(),
            isActive: true
        });

        if (!myCategory) {
            return res.status(404).json({
                error: `can't find category with slug:${slug}`
            });
        }

        res.status(200).json({
            message: `get category by slug:${slug}`,
            data: myCategory
        });

    } catch (err) {
        return next(err);
    }
};


// Add category
exports.addCategory = async (req, res, next) => {
    try {

        const { name } = req.body;

        if (typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                error: "Category name is required"
            });
        }

        const cleanName = name.trim();

        const existingCategory = await Category.findOne({
            name: cleanName
        });

        if (existingCategory) {
            return res.status(409).json({
                error: "Category with this name already exists"
            });
        }

        const myCategory = await Category.create({
            name: cleanName
        });

        res.status(201).json({
            message: "category created",
            data: myCategory
        });

    } catch (err) {

        if (err.code === 11000) {
            return res.status(409).json({
                error: "Category name or slug already exists"
            });
        }

        return next(err);
    }
};


// Update category
exports.updateCategory = async (req, res, next) => {
    try {

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                error: "Invalid category ID"
            });
        }

        const category = await Category.findById(id);

        if (!category) {
            return res.status(404).json({
                error: "Category not found"
            });
        }

        const { name } = req.body;

        if (name !== undefined) {

            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({
                    error: "Category name cannot be empty"
                });
            }

            const cleanName = name.trim();

            const existingCategory = await Category.findOne({
                name: cleanName,
                _id: { $ne: id }
            });

            if (existingCategory) {
                return res.status(409).json({
                    error: "Category with this name already exists"
                });
            }

            category.name = cleanName;
        }

        const updatedCategory = await category.save();

        await productListCache.invalidate();

        res.status(200).json({
            message: "Category updated successfully",
            data: updatedCategory
        });

    } catch (err) {

        if (err.code === 11000) {
            return res.status(409).json({
                error: "Category name or slug already exists"
            });
        }

        return next(err);
    }
};


// Soft delete category and keep its products out of the active storefront.
exports.deleteCategory = async (req, res, next) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            error: "Invalid category ID"
        });
    }

    const session = await mongoose.startSession();
    let categoryFound = true;

    try {
        await session.withTransaction(async () => {
            const category = await Category.findById(id).session(session);

            if (!category) {
                categoryFound = false;
                return;
            }

            if (!category.isActive) {
                return;
            }

            category.isActive = false;
            await category.save({ session });

            // Products remain in MongoDB, but are no longer purchasable or listed.
            await Product.updateMany(
                { category: category._id, isActive: true },
                { $set: { isActive: false } },
                { session }
            );
        });

        if (!categoryFound) {
            return res.status(404).json({
                error: "Category not found"
            });
        }

        await productListCache.invalidate();

        return res.status(200).json({
            message: "Category and its active products were deactivated successfully"
        });
    } catch (err) {
        return next(err);
    } finally {
        await session.endSession();
    }
};
