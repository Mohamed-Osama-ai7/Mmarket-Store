const mongoose = require("mongoose");
const fs = require("node:fs/promises");
const path = require("node:path");

const Product = require("../model/product.model");
const Order = require("../model/order.model");
const Category = require("../model/category.model");
const Review = require("../model/review.model");
const logger = require("../utilities/logger");
const productListCache = require("../utilities/productListCache");

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const MAX_SKIP = 100000;
const UPLOAD_DIRECTORY = path.resolve(__dirname, "../uploads");

// Match the price presented by ProductService.startingPrice(): the lowest price
// among active, in-stock variants, falling back to the product's base price.
const cataloguePriceExpression = {
    $let: {
        vars: {
            availableVariantPrices: {
                $map: {
                    input: {
                        $filter: {
                            input: { $ifNull: ["$variants", []] },
                            as: "variant",
                            cond: {
                                $and: [
                                    { $ne: ["$$variant.isActive", false] },
                                    { $gt: ["$$variant.stock", 0] }
                                ]
                            }
                        }
                    },
                    as: "variant",
                    in: { $ifNull: ["$$variant.price", "$price"] }
                }
            }
        },
        in: {
            $cond: [
                { $gt: [{ $size: "$$availableVariantPrices" }, 0] },
                { $min: "$$availableVariantPrices" },
                "$price"
            ]
        }
    }
};

const getImageNames = (product) => [...new Set([product?.imgURL, ...(Array.isArray(product?.images) ? product.images : [])].filter(name => typeof name === "string" && name.trim()))];

// Delete replaced files only when no other product record references them.
// Cleanup is best-effort: a cleanup problem must not turn a successful database write into a failed API response.
const deleteUnreferencedProductImages = async (imageNames, currentProductId) => {
    const safeNames = [...new Set(imageNames)].filter(name => path.basename(name) === name && name !== "." && name !== "..");
    if (!safeNames.length) return;
    try {
        const references = await Product.find({
            _id: { $ne: currentProductId },
            $or: [{ imgURL: { $in: safeNames } }, { images: { $in: safeNames } }]
        }).select("imgURL images").lean();
        const stillReferenced = new Set(references.flatMap(item => getImageNames(item)));
        await Promise.all(safeNames.filter(name => !stillReferenced.has(name)).map(async name => {
            const filePath = path.resolve(UPLOAD_DIRECTORY, name);
            if (!filePath.startsWith(`${UPLOAD_DIRECTORY}${path.sep}`)) return;
            try { await fs.unlink(filePath); }
            catch (error) {
                if (error.code !== "ENOENT") logger.logSafely("warn", "Could not remove an unreferenced product image", { event: "products.image_cleanup.failed", filename: name });
            }
        }));
    } catch {
        logger.logSafely("warn", "Could not check unreferenced product images", { event: "products.image_cleanup.references_failed" });
    }
};

const getUploadedProductImages = (req) => {
    if (req.files && typeof req.files === "object") {
        return [...(req.files.img || []), ...(req.files.images || [])].slice(0, 5);
    }
    return req.file ? [req.file] : [];
};

// Parse and validate optional SKU-level stock variants while preserving legacy products.
const parseProductVariants = (value) => {
    if (value === undefined) return { variants: undefined };
    let raw = value;
    if (typeof raw === "string") {
        if (raw.length > 50000) return { error: "Variant data is too large" };
        try { raw = JSON.parse(raw); }
        catch { return { error: "Variants must be valid JSON data" }; }
    }
    if (!Array.isArray(raw) || raw.length > 100) return { error: "Variants must be a list containing no more than 100 options" };

    const combinations = new Set();
    const skus = new Set();
    const variantIds = new Set();
    const variants = [];
    for (const item of raw) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return { error: "Each variant must be an object" };
        const size = typeof item.size === "string" ? item.size.trim().slice(0, 32) : "";
        const color = typeof item.color === "string" ? item.color.trim().slice(0, 50) : "";
        const sku = typeof item.sku === "string" ? item.sku.trim().toUpperCase() : "";
        const variantId = item._id === undefined || item._id === null || item._id === "" ? "" : String(item._id);
        if (variantId && (!mongoose.Types.ObjectId.isValid(variantId) || variantIds.has(variantId))) return { error: "Variant IDs must be valid and unique" };
        if (variantId) variantIds.add(variantId);
        const stock = Number(item.stock);
        const price = item.price === undefined || item.price === null || item.price === "" ? undefined : Number(item.price);
        if (!size && !color) return { error: "Each variant needs a size, a color, or both" };
        if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) return { error: "Variant stock must be a whole number from 0 to 1,000,000" };
        if (price !== undefined && (!Number.isFinite(price) || price < 0 || price > 100000000)) return { error: "Variant price must be a valid non-negative number" };
        if (sku && (sku.length > 60 || !/^[A-Z0-9._-]+$/.test(sku))) return { error: "Variant SKU may contain letters, numbers, periods, underscores, and hyphens only" };
        const combination = `${size.toLocaleLowerCase()}::${color.toLocaleLowerCase()}`;
        if (combinations.has(combination)) return { error: "Each size/color variant combination must be unique" };
        combinations.add(combination);
        if (sku && skus.has(sku)) return { error: "Variant SKUs must be unique within a product" };
        if (sku) skus.add(sku);
        variants.push({ ...(variantId ? { _id: variantId } : {}), size, color, sku, stock, ...(price === undefined ? {} : { price }), isActive: item.isActive !== false });
    }
    return { variants };
};

const parsePositiveInteger = (value, name, defaultValue, maximum) => {
    if (value === undefined) {
        return {
            value: defaultValue
        };
    }

    if (
        typeof value !== "string" ||
        !/^[1-9]\d*$/.test(value)
    ) {
        return {
            error: `${name} must be a positive integer`
        };
    }

    const parsedValue = Number(value);
    if (
        !Number.isSafeInteger(parsedValue) ||
        parsedValue > maximum
    ) {
        return {
            error: `${name} is too large`
        };
    }

    return {
        value: parsedValue
    };
};

// Return filter values from the active catalogue so the frontend never hard-codes them.
exports.getProductFilterOptions = async (req, res) => {
    try {
        const [brands, variantFacets] = await Promise.all([
            Product.distinct("brand", { isActive: true, brand: { $nin: ["", null] } }),
            Product.aggregate([
                { $match: { isActive: true, variants: { $exists: true, $ne: [] } } },
                { $unwind: "$variants" },
                { $match: { "variants.isActive": { $ne: false }, "variants.stock": { $gt: 0 } } },
                { $group: { _id: null, sizes: { $addToSet: "$variants.size" }, colors: { $addToSet: "$variants.color" } } },
                { $project: { _id: 0, sizes: 1, colors: 1 } }
            ])
        ]);
        const tidy = (values) => {
            const sorted = (values || [])
                .filter(value => typeof value === "string")
                .map(value => value.trim())
                .filter(Boolean)
                .sort((a, b) => {
                    const insensitive = a.localeCompare(b, undefined, { sensitivity: "base" });
                    if (insensitive !== 0) return insensitive;
                    const aIsLowercase = a === a.toLocaleLowerCase();
                    const bIsLowercase = b === b.toLocaleLowerCase();
                    if (aIsLowercase !== bIsLowercase) return aIsLowercase ? 1 : -1;
                    return a.localeCompare(b);
                });
            const seen = new Set();
            return sorted.filter(value => {
                const normalized = value.toLocaleLowerCase();
                if (seen.has(normalized)) return false;
                seen.add(normalized);
                return true;
            });
        };
        const options = variantFacets[0] || { sizes: [], colors: [] };
        return res.status(200).json({
            message: "Product filter options",
            data: { brands: tidy(brands), sizes: tidy(options.sizes), colors: tidy(options.colors) }
        });
    } catch (err) {
        logger.logError("products.filters.failed", err, { requestId: req.id, method: req.method });
        return res.status(500).json({ error: "Could not load product filter options" });
    }
};

// Get active products with validated server-side filtering, ratings, and bounded pagination.
exports.getProducts = async (req, res) => {
    const pageSizeResult = parsePositiveInteger(req.query.pageSize, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    if (pageSizeResult.error) return res.status(400).json({ error: pageSizeResult.error });

    const pageSize = pageSizeResult.value;
    const maximumPage = Math.floor(MAX_SKIP / pageSize) + 1;
    const pageResult = parsePositiveInteger(req.query.page, "page", DEFAULT_PAGE, maximumPage);
    if (pageResult.error) return res.status(400).json({ error: pageResult.error });

    const page = pageResult.value;
    const skip = (page - 1) * pageSize;
    const textQuery = (name, maxLength = 100) => typeof req.query[name] === "string" ? req.query[name].trim().slice(0, maxLength) : "";
    const search = textQuery("search");
    const categorySlug = textQuery("category").toLowerCase();
    const brand = textQuery("brand", 80);
    const size = textQuery("size", 32);
    const color = textQuery("color", 50);
    const sortOptions = {
        newest: { createdAt: -1, _id: 1 },
        oldest: { createdAt: 1, _id: 1 },
        "price-asc": { price: 1, _id: 1 },
        "price-desc": { price: -1, _id: 1 },
        "name-asc": { name: 1, _id: 1 }
    };
    const sortName = typeof req.query.sort === "string" ? req.query.sort : "newest";
    if (!Object.prototype.hasOwnProperty.call(sortOptions, sortName)) {
        return res.status(400).json({ error: "sort must be one of newest, oldest, price-asc, price-desc, name-asc" });
    }

    let minRating;
    if (req.query.minRating !== undefined) {
        if (typeof req.query.minRating !== "string" || !/^[1-5]$/.test(req.query.minRating)) {
            return res.status(400).json({ error: "minRating must be a whole number from 1 to 5" });
        }
        minRating = Number(req.query.minRating);
    }

    const filter = { isActive: true };
    const filterKeyData = { search, category: categorySlug, brand, size, color, sort: sortName };
    const cataloguePriceComparisons = [];
    let minPriceValue;
    let maxPriceValue;

    if (req.query.minPrice !== undefined) {
        const minPrice = Number(req.query.minPrice);
        if (typeof req.query.minPrice !== "string" || !req.query.minPrice.trim() || !Number.isFinite(minPrice) || minPrice < 0) {
            return res.status(400).json({ error: "minPrice must be a finite non-negative number" });
        }
        minPriceValue = minPrice;
        cataloguePriceComparisons.push({ $gte: [cataloguePriceExpression, minPrice] });
        filterKeyData.minPrice = minPrice;
    }

    if (req.query.maxPrice !== undefined) {
        const maxPrice = Number(req.query.maxPrice);
        if (typeof req.query.maxPrice !== "string" || !req.query.maxPrice.trim() || !Number.isFinite(maxPrice) || maxPrice < 0) {
            return res.status(400).json({ error: "maxPrice must be a finite non-negative number" });
        }
        maxPriceValue = maxPrice;
        cataloguePriceComparisons.push({ $lte: [cataloguePriceExpression, maxPrice] });
        filterKeyData.maxPrice = maxPrice;
    }
    if (minPriceValue !== undefined && maxPriceValue !== undefined && minPriceValue > maxPriceValue) {
        return res.status(400).json({ error: "minPrice cannot be greater than maxPrice" });
    }
    if (cataloguePriceComparisons.length) {
        filter.$expr = cataloguePriceComparisons.length === 1
            ? cataloguePriceComparisons[0]
            : { $and: cataloguePriceComparisons };
    }

    if (brand) {
        const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.brand = new RegExp(`^${escapedBrand}$`, "i");
        filterKeyData.brand = brand.toLocaleLowerCase();
    }
    if (size || color) {
        const variantMatch = { isActive: { $ne: false }, stock: { $gt: 0 } };
        if (size) variantMatch.size = new RegExp(`^${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
        if (color) variantMatch.color = new RegExp(`^${color.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
        filter.variants = { $elemMatch: variantMatch };
    }
    if (minRating !== undefined) filterKeyData.minRating = minRating;

    try {
        if (categorySlug) {
            const category = await Category.findOne({ slug: categorySlug, isActive: true }).select("_id").lean();
            if (!category) {
                return res.status(200).json({ message: "Products list", data: [], pagination: { page, pageSize, totalItems: 0, totalPages: 0 } });
            }
            filter.category = category._id;
        }

        if (search) {
            const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const searchPattern = new RegExp(escapedSearch, "i");
            filter.$or = [{ name: searchPattern }, { desc: searchPattern }, { brand: searchPattern }];
        }

        const hasNonDefaultFilters = Boolean(
            search || categorySlug || brand || size || color || minRating !== undefined ||
            req.query.minPrice !== undefined || req.query.maxPrice !== undefined || sortName !== "newest"
        );
        const filterKey = hasNonDefaultFilters ? JSON.stringify(filterKeyData) : "";
        let cachedResponse;
        try { cachedResponse = await productListCache.get(page, pageSize, filterKey); }
        catch (err) { logger.logError("products.list.cache_read.failed", err, { requestId: req.id, method: req.method }); }
        if (cachedResponse !== undefined) return res.status(200).json(cachedResponse);

        const cacheGeneration = await productListCache.getVersion();
        let products;
        let totalItems;
        const sortByCataloguePrice = sortName === "price-asc" || sortName === "price-desc";

        if (minRating !== undefined || sortByCataloguePrice) {
            // Price sorting must use the same effective price as the catalogue cards.
            // Rating filtering also uses aggregation so it can be applied before pagination.
            const pipeline = [{ $match: filter }];
            if (sortByCataloguePrice) {
                pipeline.push({ $addFields: { __cataloguePrice: cataloguePriceExpression } });
            }
            if (minRating !== undefined) {
                pipeline.push(
                    { $lookup: {
                        from: Review.collection.name,
                        let: { productId: "$_id" },
                        pipeline: [
                            { $match: { $expr: { $eq: ["$product", "$$productId"] } } },
                            { $group: { _id: null, ratingAverage: { $avg: "$rating" }, ratingCount: { $sum: 1 } } }
                        ],
                        as: "ratingStats"
                    } },
                    { $addFields: {
                        ratingAverage: { $ifNull: [{ $arrayElemAt: ["$ratingStats.ratingAverage", 0] }, 0] },
                        ratingCount: { $ifNull: [{ $arrayElemAt: ["$ratingStats.ratingCount", 0] }, 0] }
                    } },
                    { $match: { ratingAverage: { $gte: minRating } } }
                );
            }
            const sort = sortByCataloguePrice
                ? { __cataloguePrice: sortName === "price-asc" ? 1 : -1, _id: 1 }
                : sortOptions[sortName];
            pipeline.push({
                $facet: {
                    data: [
                        { $sort: sort }, { $skip: skip }, { $limit: pageSize },
                        { $lookup: { from: Category.collection.name, localField: "category", foreignField: "_id", as: "categoryData" } },
                        { $addFields: { category: { $arrayElemAt: ["$categoryData", 0] } } },
                        { $project: { categoryData: 0, ratingStats: 0, __cataloguePrice: 0 } }
                    ],
                    total: [{ $count: "count" }]
                }
            });
            const aggregateResults = await Product.aggregate(pipeline);
            products = aggregateResults[0]?.data || [];
            totalItems = aggregateResults[0]?.total?.[0]?.count || 0;
        } else {
            [products, totalItems] = await Promise.all([
                Product.find(filter).populate("category", "name slug").sort(sortOptions[sortName]).skip(skip).limit(pageSize).lean(),
                Product.countDocuments(filter)
            ]);
        }

        if (minRating === undefined && products.length) {
            try {
                const ratingStats = await Review.aggregate([
                    { $match: { product: { $in: products.map(product => product._id) } } },
                    { $group: { _id: "$product", ratingAverage: { $avg: "$rating" }, ratingCount: { $sum: 1 } } }
                ]);
                const ratingsByProduct = new Map(ratingStats.map(stat => [String(stat._id), { ratingAverage: Math.round(stat.ratingAverage * 10) / 10, ratingCount: stat.ratingCount }]));
                products = products.map(product => ({ ...product, ...(ratingsByProduct.get(String(product._id)) || { ratingAverage: 0, ratingCount: 0 }) }));
            } catch (ratingError) {
                // Product browsing should remain available if the optional review summary is temporarily unavailable.
                logger.logError("products.rating_summary.failed", ratingError, { requestId: req.id, method: req.method });
                products = products.map(product => ({ ...product, ratingAverage: 0, ratingCount: 0 }));
            }
        }

        const responseBody = {
            message: "Products list",
            data: products,
            pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) }
        };
        try { await productListCache.set(page, pageSize, responseBody, cacheGeneration, filterKey); }
        catch (err) { logger.logError("products.list.cache_write.failed", err, { requestId: req.id, method: req.method }); }
        return res.status(200).json(responseBody);
    } catch (err) {
        logger.logError("products.list.failed", err, { requestId: req.id, method: req.method });
        return res.status(500).json({ error: "Error getting products" });
    }
};

// Get product by slug
exports.getProductBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        if (
            typeof slug !== "string" ||
            !slug.trim()
        ) {
            return res.status(400).json({
                error: "Product slug is required"
            });
        }

        const product = await Product.findOne({
            slug: slug.trim().toLowerCase(),
            isActive: true
        })
            .populate("category", "name slug")
            .lean();

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }

        return res.status(200).json({
            message: "Product found",
            data: product
        });

    } catch (err) {
        logger.logError("products.get_by_slug.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Error getting product"
        });
    }
};


// Add product
exports.addProduct = async (req, res) => {
    try {
        const {
            name,
            price,
            desc,
            stock,
            category,
            brand,
            sku,
            audience,
            garmentType
        } = req.body;

        // Validate name
        if (
            typeof name !== "string" ||
            !name.trim()
        ) {
            return res.status(400).json({
                error: "Product name is required"
            });
        }

        // Validate price
        if (
            price === undefined ||
            price === null ||
            price === ""
        ) {
            return res.status(400).json({
                error: "Product price is required"
            });
        }

        const numericPrice = Number(price);

        if (
            !Number.isFinite(numericPrice) ||
            numericPrice < 0
        ) {
            return res.status(400).json({
                error: "Product price must be a valid non-negative number"
            });
        }

        // Validate description
        if (
            typeof desc !== "string" ||
            !desc.trim()
        ) {
            return res.status(400).json({
                error: "Product description is required"
            });
        }

        // Validate stock
        const numericStock =
            stock === undefined ||
            stock === null ||
            stock === ""
                ? 0
                : Number(stock);

        if (
            !Number.isInteger(numericStock) ||
            numericStock < 0
        ) {
            return res.status(400).json({
                error: "Product stock must be a non-negative integer"
            });
        }

        // Validate category
        if (
            typeof category !== "string" ||
            !mongoose.Types.ObjectId.isValid(category)
        ) {
            return res.status(400).json({
                error: "Valid product category is required"
            });
        }

        // Validate optional brand
        if (
            brand !== undefined &&
            typeof brand !== "string"
        ) {
            return res.status(400).json({
                error: "Brand must be a string"
            });
        }

        // A new product must have at least one validated PNG/JPEG image.
        const uploadedImages = getUploadedProductImages(req);
        if (!uploadedImages.length) {
            return res.status(400).json({ error: "At least one product image is required" });
        }
        if (sku !== undefined && (typeof sku !== "string" || sku.trim().length > 60 || (sku.trim() && !/^[A-Za-z0-9._-]+$/.test(sku.trim())))) {
            return res.status(400).json({ error: "SKU may contain letters, numbers, periods, underscores, and hyphens only, up to 60 characters." });
        }

        const activeCategory = await Category.findOne({
            _id: category,
            isActive: true
        }).select("_id");

        if (!activeCategory) {
            return res.status(400).json({
                error: "Invalid or inactive category"
            });
        }

        const normalizedAudience = audience === undefined ? "unisex" : String(audience).toLowerCase().trim();
        const normalizedGarmentType = garmentType === undefined ? "auto" : String(garmentType).toLowerCase().trim();
        if (!["men", "women", "unisex"].includes(normalizedAudience)) {
            return res.status(400).json({ error: "Audience must be men, women, or unisex" });
        }
        if (!["auto", "tops", "bottoms", "one-pieces", "accessories"].includes(normalizedGarmentType)) {
            return res.status(400).json({ error: "Garment type is invalid" });
        }
        const parsedVariants = parseProductVariants(req.body.variants);
        if (parsedVariants.error) return res.status(400).json({ error: parsedVariants.error });

        const product = await Product.create({
            name: name.trim(),
            price: numericPrice,
            desc: desc.trim(),
            stock: numericStock,
            variants: parsedVariants.variants || [],
            imgURL: uploadedImages[0].filename,
            images: uploadedImages.map(file => file.filename),
            sku: typeof sku === "string" && sku.trim() ? sku.trim().toUpperCase() : undefined,
            category: activeCategory._id,
            brand: brand === undefined ? "" : brand.trim(),
            audience: normalizedAudience,
            garmentType: normalizedGarmentType
        });
        req.productImagesCommitted = true;

        await productListCache.invalidate();

        const productData = await Product.findById(product._id)
            .populate("category", "name slug")
            .lean();

        return res.status(201).json({
            message: "Product created successfully",
            data: productData
        });

    } catch (err) {
        logger.logError("products.create.failed", err, {
            requestId: req.id,
            method: req.method
        });

        if (err.code === 11000) {
            return res.status(409).json({
                error: "A product with this slug already exists"
            });
        }

        if (err.name === "ValidationError" || err.name === "CastError") {
            return res.status(400).json({
                error: "Invalid product data"
            });
        }

        return res.status(500).json({
            error: "Error creating product"
        });
    }
};


// Update product
exports.updateProduct = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }
        const previousImageNames = getImageNames(product);

        const {
            name,
            price,
            desc,
            stock,
            category,
            brand,
            sku,
            audience,
            garmentType
        } = req.body;

        const uploadedImages = getUploadedProductImages(req);
        const skuValue = sku === undefined ? undefined : (typeof sku === "string" ? sku.trim().toUpperCase() : "");
        if (skuValue !== undefined && (skuValue.length > 60 || (skuValue && !/^[A-Z0-9._-]+$/.test(skuValue)))) {
            return res.status(400).json({ error: "SKU may contain letters, numbers, periods, underscores, and hyphens only, up to 60 characters." });
        }
        const parsedVariants = parseProductVariants(req.body.variants);
        if (parsedVariants.error) return res.status(400).json({ error: parsedVariants.error });
        if (parsedVariants.variants !== undefined) {
            const nextVariantIds = new Set(parsedVariants.variants.map(variant => variant._id ? String(variant._id) : "").filter(Boolean));
            const removedVariantIds = (product.variants || []).map(variant => String(variant._id)).filter(variantId => !nextVariantIds.has(variantId));
            if (removedVariantIds.length) {
                const referencedByOpenOrder = await Order.exists({
                    "items.variantId": { $in: removedVariantIds },
                    orderStatus: { $in: ["pending", "confirmed", "processing"] },
                    stockReleasedAt: null
                });
                if (referencedByOpenOrder) return res.status(409).json({ error: "A variant in an open order cannot be removed. Mark it unavailable with zero stock instead." });
            }
            product.variants = parsedVariants.variants;
        }
        if (skuValue !== undefined) product.sku = skuValue || undefined;
        if (uploadedImages.length) {
            product.imgURL = uploadedImages[0].filename;
            product.images = uploadedImages.map(file => file.filename);
        }

        // Validate and update name
        if (name !== undefined) {
            if (
                typeof name !== "string" ||
                !name.trim()
            ) {
                return res.status(400).json({
                    error: "Product name cannot be empty"
                });
            }

            product.name = name.trim();
        }

        // Validate and update price
        if (price !== undefined) {
            if (
                price === null ||
                price === ""
            ) {
                return res.status(400).json({
                    error: "Product price is invalid"
                });
            }

            const numericPrice = Number(price);

            if (
                !Number.isFinite(numericPrice) ||
                numericPrice < 0
            ) {
                return res.status(400).json({
                    error: "Product price must be a valid non-negative number"
                });
            }

            product.price = numericPrice;
        }

        // Validate and update description
        if (desc !== undefined) {
            if (
                typeof desc !== "string" ||
                !desc.trim()
            ) {
                return res.status(400).json({
                    error: "Product description cannot be empty"
                });
            }

            product.desc = desc.trim();
        }

        // Validate and update stock
        if (stock !== undefined) {
            if (
                stock === null ||
                stock === ""
            ) {
                return res.status(400).json({
                    error: "Product stock is invalid"
                });
            }

            const numericStock = Number(stock);

            if (
                !Number.isInteger(numericStock) ||
                numericStock < 0
            ) {
                return res.status(400).json({
                    error: "Product stock must be a non-negative integer"
                });
            }

            product.stock = numericStock;
        }

        // Validate and update category
        if (category !== undefined) {
            if (
                typeof category !== "string" ||
                !mongoose.Types.ObjectId.isValid(category)
            ) {
                return res.status(400).json({
                    error: "Invalid category ID"
                });
            }

            const activeCategory = await Category.findOne({
                _id: category,
                isActive: true
            }).select("_id");

            if (!activeCategory) {
                return res.status(400).json({
                    error: "Invalid or inactive category"
                });
            }

            product.category = activeCategory._id;
        }

        // Validate and update brand
        if (brand !== undefined) {
            if (typeof brand !== "string") {
                return res.status(400).json({
                    error: "Brand must be a string"
                });
            }

            product.brand = brand.trim();
        }

        if (audience !== undefined) {
            const normalizedAudience = String(audience).toLowerCase().trim();
            if (!["men", "women", "unisex"].includes(normalizedAudience)) {
                return res.status(400).json({ error: "Audience must be men, women, or unisex" });
            }
            product.audience = normalizedAudience;
        }

        if (garmentType !== undefined) {
            const normalizedGarmentType = String(garmentType).toLowerCase().trim();
            if (!["auto", "tops", "bottoms", "one-pieces", "accessories"].includes(normalizedGarmentType)) {
                return res.status(400).json({ error: "Garment type is invalid" });
            }
            product.garmentType = normalizedGarmentType;
        }

        // Keep the existing slug stable after creation.
        // The model should not regenerate it when the name changes.

        const updatedProduct = await product.save();
        req.productImagesCommitted = true;

        await productListCache.invalidate();

        const productData = await Product.findById(updatedProduct._id)
            .populate("category", "name slug")
            .lean();

        if (uploadedImages.length) {
            const currentImageNames = new Set(getImageNames(updatedProduct));
            await deleteUnreferencedProductImages(previousImageNames.filter(name => !currentImageNames.has(name)), updatedProduct._id);
        }

        return res.status(200).json({
            message: "Product updated successfully",
            data: productData
        });

    } catch (err) {
        logger.logError("products.update.failed", err, {
            requestId: req.id,
            method: req.method
        });

        if (err.code === 11000) {
            return res.status(409).json({
                error: "A product with this slug already exists"
            });
        }

        if (err.name === "ValidationError" || err.name === "CastError") {
            return res.status(400).json({
                error: "Invalid product data"
            });
        }

        return res.status(500).json({
            error: "Error updating product"
        });
    }
};


// Soft delete product
exports.deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                error: "Invalid product ID"
            });
        }

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                error: "Product not found"
            });
        }

        if (!product.isActive) {
            return res.status(200).json({
                message: "Product already deleted"
            });
        }

        product.isActive = false;

        await product.save();

        await productListCache.invalidate();

        return res.status(200).json({
            message: "Product deactivated successfully"
        });

    } catch (err) {
        logger.logError("products.delete.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Error deleting product"
        });
    }
};
