const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const seedPath = path.join(__dirname, "..", "scripts", "seed-catalog.js");
const seedSource = fs.readFileSync(seedPath, "utf8");

function slugify(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

test("catalog seed defines at least 100 unique, priced products", () => {
    const initialBlock = seedSource.split("// Original catalogue additions.")[0];
    const supplementalBlock = seedSource.split("const supplementalFamilies = [")[1]?.split("const supplementalImagePool")[0] || "";
    const initialProducts = [...initialBlock.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*?price:\s*(\d+)/gs)].map(match => ({ name: match[1], price: Number(match[2]) }));
    const supplementalProducts = [...supplementalBlock.matchAll(/\["([^"\n]+)",\s*(\d+)\]/g)].map(match => ({ name: match[1], price: Number(match[2]) }));
    const products = [...initialProducts, ...supplementalProducts];
    const slugs = products.map(product => slugify(product.name));

    assert.ok(products.length >= 100, `Expected at least 100 products, found ${products.length}`);
    assert.equal(new Set(products.map(product => product.name)).size, products.length, "Product names must be unique");
    assert.equal(new Set(slugs).size, products.length, "Product slugs must be unique");
    assert.ok(products.every(product => Number.isFinite(product.price) && product.price > 0), "Every product must have a positive EGP price");
    assert.equal(products.length, 110, "The curated demo catalogue should contain exactly 110 products");
});
