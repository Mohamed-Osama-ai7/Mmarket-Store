const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.PUBLIC_SITE_URL = "https://shop.example.test/";
const app = require("../app");

function listen() {
    return new Promise(resolve => {
        const server = app.listen(0, () => resolve(server));
    });
}

test("robots.txt uses PUBLIC_SITE_URL and hides private pages", async () => {
    const server = await listen();
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/robots.txt`);
        const body = await res.text();
        assert.equal(res.status, 200);
        assert.match(body, /Disallow: \/checkout/);
        assert.match(body, /Sitemap: https:\/\/shop\.example\.test\/sitemap\.xml/);
    } finally { server.close(); }
});

test("product images are cacheable and embeddable by a separate storefront origin", async () => {
    const uploads = path.resolve(__dirname, "..", "uploads");
    const existed = fs.existsSync(uploads);
    fs.mkdirSync(uploads, { recursive: true });
    const file = path.join(uploads, "media-test-only.png");
    fs.writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
    const server = await listen();
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/media/products/media-test-only.png`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("cross-origin-resource-policy"), "cross-origin");
        assert.match(res.headers.get("cache-control"), /public, max-age=86400/);
        const api = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/health`);
        assert.equal(api.headers.get("cache-control"), "no-store");
    } finally {
        server.close();
        fs.rmSync(file, { force: true });
        if (!existed) { try { fs.rmdirSync(uploads); } catch { /* not empty */ } }
    }
});
