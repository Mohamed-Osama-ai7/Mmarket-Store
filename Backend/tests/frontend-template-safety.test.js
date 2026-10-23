const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repositoryRoot = path.resolve(__dirname, "../..");
const templatesRoot = path.join(repositoryRoot, "Frontend/src");

function collectTemplates(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectTemplates(fullPath);
        return entry.isFile() && entry.name.endsWith(".html") ? [fullPath] : [];
    });
}

test("Angular event/action bindings do not evaluate pipes", () => {
    const templates = collectTemplates(templatesRoot);
    assert.ok(templates.length > 0, "Angular templates should be present");
    const violations = [];
    const eventAttribute = /\(([\w:-]+)\)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

    for (const templatePath of templates) {
        const source = fs.readFileSync(templatePath, "utf8");
        for (const match of source.matchAll(eventAttribute)) {
            const expression = match[2] ?? match[3] ?? "";
            if (/(^|[^|])\|(?!\|)/.test(expression)) {
                violations.push(`${path.relative(repositoryRoot, templatePath)}: (${match[1]})="${expression}"`);
            }
        }
    }

    assert.deepEqual(violations, [], `Pipes are not valid in Angular action expressions:\n${violations.join("\n")}`);
});

test("product wishlist templates reuse async values inside event handlers", () => {
    const productTemplate = fs.readFileSync(path.join(templatesRoot, "app/layout/productslist/product/product.html"), "utf8");
    const detailsTemplate = fs.readFileSync(path.join(templatesRoot, "app/layout/productslist/product-details/product-details.html"), "utf8");

    assert.match(productTemplate, /@let savedIds = wishlist\.savedIds\$ \| async;/);
    assert.match(productTemplate, /toggleWishlist\(savedIds\?\.has\(myProduct\._id\) \|\| false\)/);
    assert.match(detailsTemplate, /@let savedIds = wishlistService\.savedIds\$ \| async;/);
    assert.match(detailsTemplate, /toggleWishlist\(savedIds\?\.has\(product\._id\) \|\| false\)/);
});
