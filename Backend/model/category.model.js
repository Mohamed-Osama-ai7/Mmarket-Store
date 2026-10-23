const mongoose = require("mongoose");

const slugify = require("slugify");

const categorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
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

        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

categorySchema.pre("validate", function () {
    if (this.isNew && typeof this.name === "string") {
        this.slug = slugify(this.name, {
            lower: true,
            strict: true
        });
    }
});

const Category = mongoose.model(
    "Category",
    categorySchema
);

module.exports = Category;