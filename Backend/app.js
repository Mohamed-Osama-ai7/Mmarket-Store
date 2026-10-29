const express = require("express");
const path = require("node:path");
const requestLogger = require("./middlewares/requestLogger");

const app = express();
app.disable("x-powered-by");
// Trust reverse proxies only when the deployment says so: "true" = one hop, or a number of hops.
// The hop count decides which X-Forwarded-For entry becomes req.ip (and therefore the rate-limit key),
// so set it to the real number of proxies in front of the API.
const parseTrustProxy = value => {
    if (value === "true") return 1;
    if (/^[1-9]\d?$/.test(String(value || ""))) return Number(value);
    return false;
};
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

// Low-cost default browser security headers; deployment should still terminate HTTPS.
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Origin-Agent-Cluster", "?1");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cache-Control", "no-store");
    if (process.env.NODE_ENV === "production") res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    next();
});

// CORS
app.use(require("./middlewares/cors.middleware"));

// Assign request IDs before body parsing so errors can be correlated.
app.use(requestLogger());

// Parse JSON request bodies
app.use(express.json({
    limit: "1mb"
}));

// Product Routes
app.use(
    "/api/v1/product",
    require("./route/product.route")
);

// Cost-sensitive virtual fitting-room endpoints. The provider key stays on the server.
app.use(
    "/api/v1/try-on",
    require("./route/tryon.route")
);

// User Routes
app.use(
    "/api/v1/user",
    require("./route/user.route")
);

// Authentication Routes
app.use(
    "/api/v1/auth",
    require("./route/auth.route")
);

// Category Routes
app.use(
    "/api/v1/category",
    require("./route/category.route")
);

// Cart Routes
app.use(
    "/api/v1/cart",
    require("./route/cart.route")
);

// Wishlist Routes
app.use(
    "/api/v1/wishlist",
    require("./route/wishlist.route")
);

// Review Routes
app.use(
    "/api/v1/review",
    require("./route/review.route")
);

// Order Routes
app.use(
    "/api/v1/order",
    require("./route/order.route")
);

// Payment Routes
app.use(
    "/api/v1/payment",
    require("./route/payment.route")
);

// Report Routes
app.use(
    "/api/v1/report",
    require("./route/report.route")
);

// Refund Routes
app.use(
    "/api/v1/refunds",
    require("./route/refund.route")
);

app.use(
    "/api/v1/notifications",
    require("./route/notification.route")
);

app.use(
    "/api/v1/contact",
    require("./route/contact.route")
);

// Public storefront content and role-protected CMS management.
app.use(
    "/api/v1/site-content",
    require("./route/siteContent.route")
);

// Public discovery endpoints; set PUBLIC_SITE_URL to the deployed storefront origin.
app.get("/robots.txt", (req, res) => {
    const siteUrl = (process.env.PUBLIC_SITE_URL || "http://localhost:4200").replace(/\/$/, "");
    res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /dashboard\nDisallow: /profile\nDisallow: /orders\nDisallow: /cart\nDisallow: /checkout\nSitemap: ${siteUrl}/sitemap.xml\n`);
});

app.get("/sitemap.xml", async (req, res, next) => {
    try {
        const Product = require("./model/product.model");
        const siteUrl = (process.env.PUBLIC_SITE_URL || "http://localhost:4200").replace(/\/$/, "");
        const products = await Product.find({ isActive: true }).select("slug updatedAt").sort({ updatedAt: -1 }).limit(5000).lean();
        const SiteContent = require("./model/siteContent.model");
        const siteContent = await SiteContent.findOne({ key: "main" }).select("pages").lean();
        const publishedPages = (siteContent?.pages || []).filter(page => page.status === "published" && typeof page.slug === "string");
        const urls = [
            `${siteUrl}/home`, `${siteUrl}/products`, `${siteUrl}/policies/privacy`,
            `${siteUrl}/policies/terms`, `${siteUrl}/policies/returns`, `${siteUrl}/contact`,
            ...products.map(product => `${siteUrl}/products/${encodeURIComponent(product.slug)}`),
            ...publishedPages.map(page => `${siteUrl}/pages/${encodeURIComponent(page.slug)}`)
        ];
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${String(url).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</loc></url>`).join("")}</urlset>`;
        res.type("application/xml").send(xml);
    } catch (error) { next(error); }
});

// Lightweight probes for local orchestration and deployment health checks.
app.get("/health/live", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/api/v1/health", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/health/ready", (req, res) => {
    const mongoose = require("mongoose");
    const ready = mongoose.connection.readyState === 1;
    return res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not-ready" });
});

// Serve product images using the filename stored by the product model.
// express.static normalizes paths and does not expose directory listings.
app.use(
    "/api/v1/media/products",
    (req, res, next) => {
        // Images are public and immutable-ish; override the API-wide no-store and same-site CORP so
        // a separately hosted storefront (Vercel) can display and cache them.
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        next();
    },
    express.static(path.resolve(__dirname, "uploads"), {
        dotfiles: "deny",
        index: false,
        fallthrough: true,
        maxAge: "1d"
    })
);

// Handle unknown routes
app.use((req, res) => {
    return res.status(404).json({
        error: "Route not found"
    });
});

app.use(require("./middlewares/errorHandler"));

module.exports = app;
