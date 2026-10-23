const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Product = require("../model/product.model");

const createProduct = async () => {
    const product = new Product({
        name: "  Home & Garden!  ",
        price: 10,
        desc: "A product",
        stock: 2,
        imgURL: "product.jpg",
        category: new mongoose.Types.ObjectId()
    });

    await product.validate();
    return product;
};

test("Product generates a lowercase strict slug when created", async () => {
    const product = await createProduct();

    assert.equal(product.name, "Home & Garden!");
    assert.equal(product.slug, "home-and-garden");
});

test("renaming an existing Product preserves its slug", async () => {
    const createdProduct = await createProduct();
    const product = Product.hydrate(createdProduct.toObject());

    product.name = "Renamed Product";
    await product.validate();

    assert.equal(product.name, "Renamed Product");
    assert.equal(product.slug, "home-and-garden");
});

test("unrelated Product updates preserve its slug", async () => {
    const createdProduct = await createProduct();
    const product = Product.hydrate(createdProduct.toObject());

    product.price = 12;
    product.stock = 5;
    product.brand = "Example";
    await product.validate();

    assert.equal(product.price, 12);
    assert.equal(product.stock, 5);
    assert.equal(product.brand, "Example");
    assert.equal(product.slug, "home-and-garden");
});

test("Product validation still rejects invalid price and stock values", async () => {
    const product = await createProduct();

    product.price = -1;
    product.stock = 1.5;

    await assert.rejects(product.validate(), error => {
        assert.equal(error.name, "ValidationError");
        assert.ok(error.errors.price);
        assert.ok(error.errors.stock);
        return true;
    });
});


test("variant inventory keeps aggregate stock aligned with active options", async () => {
    const product = new Product({
        name: "Variant inventory",
        price: 100,
        desc: "A variant-enabled product",
        stock: 999,
        variants: [
            { size: "S", color: "Black", stock: 3 },
            { size: "M", color: "Black", stock: 4 },
            { size: "L", color: "Black", stock: 8, isActive: false }
        ],
        imgURL: "variant.jpg",
        category: new mongoose.Types.ObjectId()
    });
    await product.validate();
    assert.equal(product.stock, 7);
    assert.ok(product.variants.every(variant => variant.sku));
});

test("variant inventory rejects duplicate size/color combinations", async () => {
    const product = new Product({
        name: "Duplicate variant inventory",
        price: 100,
        desc: "A variant-enabled product",
        stock: 2,
        variants: [
            { size: "M", color: "Black", stock: 1 },
            { size: "m", color: "black", stock: 1 }
        ],
        imgURL: "variant.jpg",
        category: new mongoose.Types.ObjectId()
    });
    await assert.rejects(product.validate(), error => error.name === "ValidationError" && Boolean(error.errors.variants));
});
