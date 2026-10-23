const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimit } = require("../middlewares/rateLimit.middleware");

const makeResponse = () => {
    const headers = {};
    return {
        headers,
        statusCode: 200,
        body: undefined,
        setHeader(name, value) { headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
};

const makeRequest = (path, ip = "192.0.2.10") => ({
    baseUrl: "/api/v1/auth",
    path,
    ip,
    socket: { remoteAddress: ip }
});

test("rate limiter allows requests within the configured limit", () => {
    const limit = createRateLimit({ windowMs: 60_000, maxRequests: 2 });
    const first = makeResponse();
    const second = makeResponse();
    let nextCount = 0;
    limit(makeRequest("/test"), first, () => nextCount++);
    limit(makeRequest("/test"), second, () => nextCount++);
    assert.equal(nextCount, 2);
    assert.equal(second.headers["RateLimit-Remaining"], "0");
});

test("rate limiter returns 429 and Retry-After after the request limit", () => {
    const limit = createRateLimit({ windowMs: 60_000, maxRequests: 1, message: "Slow down" });
    const first = makeResponse();
    const blocked = makeResponse();
    let nextCount = 0;
    limit(makeRequest("/rate-test"), first, () => nextCount++);
    limit(makeRequest("/rate-test"), blocked, () => nextCount++);
    assert.equal(nextCount, 1);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body.error, "Slow down");
    assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
});

test("rate limits are scoped by endpoint and client IP", () => {
    const limit = createRateLimit({ windowMs: 60_000, maxRequests: 1 });
    const responses = [makeResponse(), makeResponse(), makeResponse()];
    let nextCount = 0;
    limit(makeRequest("/one", "192.0.2.11"), responses[0], () => nextCount++);
    limit(makeRequest("/two", "192.0.2.11"), responses[1], () => nextCount++);
    limit(makeRequest("/one", "192.0.2.12"), responses[2], () => nextCount++);
    assert.equal(nextCount, 3);
    assert.ok(responses.every((response) => response.statusCode === 200));
});
