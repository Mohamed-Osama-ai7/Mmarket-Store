const test = require("node:test");
const assert = require("node:assert/strict");
const { getEnvProblems, assertEnv } = require("../config/env.validation");

const good = {
    JWT_SECRET: "a-long-random-secret-for-tests-0123456789",
    JWT_EXPIRES_IN: "1d",
    DUMMY_PASSWORD_HASH: "$2b$12$abcdefghijklmnopqrstuv",
    MONGO_URI: "mongodb://localhost:27017/x",
    ALLOWED_ORIGINS: "https://shop.example.test"
};

test("accepts a complete configuration", () => {
    assert.deepEqual(getEnvProblems(good), []);
});

test("rejects missing, short and placeholder JWT secrets", () => {
    assert.match(getEnvProblems({ ...good, JWT_SECRET: "" })[0], /required/);
    assert.match(getEnvProblems({ ...good, JWT_SECRET: "short" })[0], /32 characters/);
    assert.match(getEnvProblems({ ...good, JWT_SECRET: "replace-with-a-random-secret-at-least-32-characters-long" })[0], /placeholder/);
});

test("production throws on problems; development only warns", () => {
    assert.throws(() => assertEnv({ ...good, NODE_ENV: "production", JWT_SECRET: "" }, { warn() {} }), /Invalid environment/);
    const warnings = [];
    assertEnv({ ...good, JWT_SECRET: "" }, { warn: message => warnings.push(message) });
    assert.equal(warnings.length, 1);
    assert.doesNotThrow(() => assertEnv({ ...good, NODE_ENV: "production" }));
});
