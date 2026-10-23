const assert = require("node:assert/strict");
const { test } = require("node:test");
const Category = require("../model/category.model");

const validateCategory = async values => {
    const category = new Category(values);

    try {
        await category.validate();
    } catch (error) {
        return { category, error };
    }

    return { category };
};

for (const [label, values, expectedSlug] of [
    ["missing", {}, undefined],
    ["null", { name: null }, undefined],
    ["empty", { name: "" }, ""],
    ["whitespace-only", { name: "   " }, ""]
]) {
    test(`Category rejects a ${label} name with a Mongoose ValidationError`, async () => {
        const { category, error } = await validateCategory(values);

        assert.ok(error, "invalid Category should fail validation");
        assert.equal(error.name, "ValidationError");
        assert.ok(error.errors.name, "required name validation should fail");
        if (expectedSlug === "") {
            assert.ok(error.errors.slug, "required slug validation should fail");
        }
        assert.equal(category.slug, expectedSlug);
    });
}

test("Category rejects punctuation-only names when strict slug generation is empty", async () => {
    const { category, error } = await validateCategory({ name: "!!!" });

    assert.ok(error, "a Category with an empty generated slug should fail");
    assert.equal(error.name, "ValidationError");
    assert.ok(error.errors.slug, "required slug validation should fail");
    assert.equal(category.name, "!!!");
    assert.equal(category.slug, "");
});

test("Category trims names and generates lowercase strict slugs", async () => {
    const { category, error } = await validateCategory({
        name: "  Home & Garden!  "
    });

    assert.equal(error, undefined);
    assert.equal(category.name, "Home & Garden!");
    assert.equal(category.slug, "home-and-garden");
});

test("validating an existing Category after renaming preserves its slug", async () => {
    const { category: newCategory, error: creationError } =
        await validateCategory({ name: "Original Category" });

    assert.equal(creationError, undefined);
    assert.equal(newCategory.slug, "original-category");

    const existingCategory = Category.hydrate(newCategory.toObject());
    assert.equal(existingCategory.isNew, false);

    existingCategory.name = "Renamed Category";
    await existingCategory.validate();

    assert.equal(existingCategory.name, "Renamed Category");
    assert.equal(existingCategory.slug, "original-category");
});
