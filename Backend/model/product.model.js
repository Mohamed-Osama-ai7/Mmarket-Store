const mongoose = require("mongoose");
const slugify = require("slugify");

const productVariantSchema = new mongoose.Schema(
    {
        size: { type: String, trim: true, maxlength: 32, default: "" },
        color: { type: String, trim: true, maxlength: 50, default: "" },
        sku: { type: String, trim: true, uppercase: true, maxlength: 60, default: "" },
        price: { type: Number, min: 0, validate: { validator: value => value === undefined || value === null || Number.isFinite(value), message: "Variant price must be a valid number" } },
        stock: { type: Number, required: true, min: 0, default: 0, validate: { validator: Number.isInteger, message: "Variant stock must be an integer" } },
        isActive: { type: Boolean, default: true }
    },
    { _id: true }
);

const productSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            minlength: 1
        },

        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },

        sku: {
            type: String,
            trim: true,
            uppercase: true,
            maxlength: 60
        },

        price: {
            type: Number,
            required: true,
            min: 0,
            validate: {
                validator: Number.isFinite,
                message: "Price must be a valid number"
            }
        },

        desc: {
            type: String,
            required: true,
            trim: true,
            minlength: 1
        },

        stock: {
            type: Number,
            required: true,
            min: 0,
            default: 0,
            validate: {
                validator: Number.isInteger,
                message: "Stock must be an integer"
            }
        },

        imgURL: {
            type: String,
            required: true,
            trim: true
        },

        // Primary image remains available as imgURL for compatibility with course APIs.
        images: {
            type: [{ type: String, trim: true }],
            default: []
        },

        // Optional SKU-level inventory. Legacy products with no variants keep their original stock behavior.
        variants: {
            type: [productVariantSchema],
            default: [],
            validate: { validator: variants => Array.isArray(variants) && variants.length <= 100, message: "A product can have no more than 100 variants" }
        },

        category: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Category",
            required: true
        },

        brand: {
            type: String,
            trim: true,
            default: ""
        },

        // Catalogue metadata used by the virtual fitting-room experience.
        audience: {
            type: String,
            enum: ["men", "women", "unisex"],
            default: "unisex",
            lowercase: true,
            trim: true
        },

        garmentType: {
            type: String,
            enum: ["auto", "tops", "bottoms", "one-pieces", "accessories"],
            default: "auto",
            lowercase: true,
            trim: true
        },

        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

// Generate a Product slug only once so existing URLs remain stable.
productSchema.pre("validate", function () {
    if (this.isNew) {
        const generatedSlug = slugify(this.name || "", {
            lower: true,
            strict: true
        });

        if (generatedSlug) {
            this.slug = generatedSlug;
        }
        if (!this.sku) this.sku = `SKU-${String(this._id).slice(-8).toUpperCase()}`;
    }
    if (typeof this.sku === "string") this.sku = this.sku.trim().toUpperCase();
    if (!Array.isArray(this.images)) this.images = [];
    if (this.imgURL && !this.images.includes(this.imgURL)) this.images.unshift(this.imgURL);
    this.images = [...new Set(this.images.filter(Boolean))].slice(0, 5);

    if (Array.isArray(this.variants) && this.variants.length) {
        const combinations = new Set();
        let aggregateStock = 0;
        for (const variant of this.variants) {
            variant.size = String(variant.size || "").trim();
            variant.color = String(variant.color || "").trim();
            variant.sku = String(variant.sku || "").trim().toUpperCase();
            const combination = `${variant.size.toLocaleLowerCase()}::${variant.color.toLocaleLowerCase()}`;
            if (combinations.has(combination)) this.invalidate("variants", "Each size/color variant combination must be unique");
            combinations.add(combination);
            aggregateStock += variant.isActive !== false && Number.isInteger(variant.stock) && variant.stock >= 0 ? variant.stock : 0;
            if (!variant.sku) {
                // Use the immutable subdocument identifier for a stable, collision-resistant SKU.
                const baseSku = String(this.sku || "SKU").slice(0, 30);
                const uniqueSuffix = String(variant._id || "OPTION").slice(-8).toUpperCase();
                variant.sku = `${baseSku}-${uniqueSuffix}`.slice(0, 60);
            }
        }
        // Product.stock remains a compatibility aggregate for old clients and catalogue filters.
        this.stock = aggregateStock;
    }
});

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ isActive: 1, price: 1 });
productSchema.index({ isActive: 1, brand: 1 });
productSchema.index({ isActive: 1, "variants.size": 1, "variants.color": 1 });
productSchema.index({ sku: 1 }, { unique: true, sparse: true });

const Product = mongoose.model("Product", productSchema);

Product.variantSchema = productVariantSchema;

module.exports = Product;