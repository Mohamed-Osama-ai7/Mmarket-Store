const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("site-content public reads and admin writes are separated by server-side authorization", () => {
    const routes = read("Backend/route/siteContent.route.js");
    assert.match(routes, /router\.get\("\/public",\s*controller\.getPublicSiteContent\)/);
    assert.match(routes, /router\.get\("\/public\/pages\/:slug",\s*controller\.getPublicPage\)/);
    assert.match(routes, /const requireAdmin = \[authenticate, authorize\("admin"\)\]/);
    for (const route of [
        /router\.get\("\/admin", \.\.\.requireAdmin/,
        /router\.put\("\/admin", \.\.\.requireAdmin/,
        /router\.post\("\/admin\/pages", \.\.\.requireAdmin/,
        /router\.put\("\/admin\/pages\/:id", \.\.\.requireAdmin/,
        /router\.delete\("\/admin\/pages\/:id", \.\.\.requireAdmin/
    ]) assert.match(routes, route);
});

test("CMS content has bounded schemas, publication states, safe paths, and plain-text output", () => {
    const schema = read("Backend/model/siteContent.model.js");
    const controller = read("Backend/controller/siteContent.controller.js");
    assert.match(schema, /enum: \["draft", "published", "archived"\]/);
    assert.match(schema, /maxlength: 50000/);
    assert.match(controller, /sanitizeHtml\(value, \{ allowedTags: \[\], allowedAttributes: \{\} \}\)/);
    assert.match(controller, /href\.startsWith\("\/\/"\)/);
    assert.match(controller, /parsed\.protocol === "https:"/);
    assert.match(controller, /page\.status === "published"/);
    assert.match(controller, /content\.pages\.length >= 100/);
});

test("admin dashboard and public storefront are connected to the CMS API", () => {
    const app = read("Backend/app.js");
    const routes = read("Frontend/src/app/app.routes.ts");
    const sidebar = read("Frontend/src/app/dashboard/dashboard.html");
    const home = read("Frontend/src/app/layout/home/home.ts");
    const homeTemplate = read("Frontend/src/app/layout/home/home.html");
    const contentPage = read("Frontend/src/app/layout/information/content-page/content-page.ts");
    assert.match(app, /route\/siteContent\.route/);
    assert.match(routes, /path: 'content',[\s\S]*?AdminContent/);
    assert.match(routes, /path: 'pages\/:slug',[\s\S]*?ContentPage/);
    assert.match(sidebar, /routerLink="\/dashboard\/content"/);
    assert.match(home, /getPublicContent\(\)/);
    assert.match(homeTemplate, /siteContent\?\.homepage\?\.heroTitle/);
    assert.match(contentPage, /getPublicPage\(/);
});


test("policy template keeps Angular control-flow blocks well formed", () => {
    const policyTemplate = read("Frontend/src/app/layout/information/policy/policy.html");
    assert.match(policyTemplate, /@if \(cmsPage\) \{/);
    assert.match(policyTemplate, /\} @else if \(content\) \{/);
    assert.match(policyTemplate, /\} @else \{/);
    assert.doesNotMatch(policyTemplate, /@else if\s*\(content\)\s*\{\s*\{\s*</);
    assert.match(policyTemplate, /@for \(section of content\.sections; track section\.heading\)/);
});
