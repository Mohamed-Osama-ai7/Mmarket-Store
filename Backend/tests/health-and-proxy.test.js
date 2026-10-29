const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

process.env.ALLOWED_ORIGINS = "https://mmarket-store.vercel.app";

const listen = app => new Promise(resolve => { const server = http.createServer(app).listen(0, "127.0.0.1", () => resolve(server)); });

const request = (server, path, headers = {}) => new Promise((resolve, reject) => {
    const { port } = server.address();
    http.get({ host: "127.0.0.1", port, path, headers }, res => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
});

test("liveness answers and readiness is 503 while MongoDB is not connected", async () => {
    process.env.TRUST_PROXY = "2";
    const app = require("../app");
    assert.equal(app.get("trust proxy"), 2);
    const server = await listen(app);
    try {
        const live = await request(server, "/health/live");
        assert.equal(live.status, 200);
        assert.deepEqual(JSON.parse(live.body), { status: "ok" });
        const ready = await request(server, "/health/ready");
        assert.equal(ready.status, 503);
        assert.deepEqual(JSON.parse(ready.body), { status: "not-ready" });
    } finally { server.close(); }
});

test("API paths never fall back to HTML and CORS rejects unknown origins", async () => {
    const app = require("../app");
    const server = await listen(app);
    try {
        const missing = await request(server, "/api/v1/does-not-exist");
        assert.equal(missing.status, 404);
        assert.match(missing.headers["content-type"], /application\/json/);
        const blocked = await request(server, "/api/v1/health", { Origin: "https://evil.example" });
        assert.equal(blocked.status, 403);
        assert.equal(blocked.headers["access-control-allow-origin"], undefined);
    } finally { server.close(); }
});
