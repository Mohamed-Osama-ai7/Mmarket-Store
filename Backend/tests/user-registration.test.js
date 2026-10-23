const assert = require("node:assert/strict");
const { test } = require("node:test");
const User = require("../model/user.model");
const { addUser, toggleUserStatus } = require("../controller/user.controller");

const responseHarness = () => ({
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

const withUserStubs = async ({ existingUser = null, createError = null } = {}, callback) => {
    const originalFindOne = User.findOne;
    const originalCreate = User.create;
    let persistedPayload = null;
    let createCalls = 0;

    User.findOne = () => ({ select: async () => existingUser ? { _id: "existing-user" } : null });
    User.create = async payload => {
        createCalls += 1;
        persistedPayload = { ...payload };
        if (createError) throw createError;
        return {
            toObject: () => ({
                _id: "saved-user-id",
                name: payload.name,
                email: payload.email,
                role: payload.role,
                password: "hashed-password-must-not-leak",
                resetPasswordTokenHash: null,
                resetPasswordExpires: null,
                mergedGuestCartKeys: ["internal-guest-cart-key"]
            })
        };
    };

    try {
        await callback({ get persistedPayload() { return persistedPayload; }, get createCalls() { return createCalls; } });
    } finally {
        User.findOne = originalFindOne;
        User.create = originalCreate;
    }
};

test("registration normalizes identity, awaits User.create, and never returns a password", async () => {
    await withUserStubs({}, async state => {
        const response = responseHarness();
        await addUser("user")({ body: {
            name: "  Mohamed Osama  ",
            email: "  MMARKET.TEST@EXAMPLE.COM ",
            password: "Strong-demo-password-123"
        } }, response);

        assert.equal(response.statusCode, 201);
        assert.equal(state.createCalls, 1);
        assert.equal(state.persistedPayload.name, "Mohamed Osama");
        assert.equal(state.persistedPayload.email, "mmarket.test@example.com");
        assert.equal(state.persistedPayload.role, "user");
        assert.equal(response.body.data._id, "saved-user-id");
        assert.equal("password" in response.body.data, false);
        assert.equal("resetPasswordTokenHash" in response.body.data, false);
        assert.equal("resetPasswordExpires" in response.body.data, false);
        assert.equal("mergedGuestCartKeys" in response.body.data, false);
        assert.equal(JSON.stringify(response.body).includes("hashed-password-must-not-leak"), false);
        assert.equal(JSON.stringify(response.body).includes("internal-guest-cart-key"), false);
    });
});

test("registration rejects an existing email without creating another account", async () => {
    await withUserStubs({ existingUser: true }, async state => {
        const response = responseHarness();
        await addUser("user")({ body: {
            name: "Duplicate User",
            email: "existing@example.com",
            password: "Strong-demo-password-123"
        } }, response);

        assert.equal(response.statusCode, 409);
        assert.equal(response.body.error, "Email already exists");
        assert.equal(state.createCalls, 0);
    });
});


test("toggleUserStatus prevents administrator from deactivating self", async () => {
    const originalFindById = User.findById;
    try {
        User.findById = async (id) => ({
            _id: { toString: () => "admin-1" },
            role: "admin",
            isActive: true
        });

        const req = { params: { id: "admin-1" }, user: { id: "admin-1" } };
        const res = responseHarness();
        await toggleUserStatus(req, res, () => {});

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, "You cannot deactivate your own account");
    } finally {
        User.findById = originalFindById;
    }
});

test("toggleUserStatus prevents deactivating the only active administrator", async () => {
    const originalFindById = User.findById;
    const originalCountDocuments = User.countDocuments;
    try {
        User.findById = async (id) => ({
            _id: { toString: () => "admin-2" },
            role: "admin",
            isActive: true
        });
        User.countDocuments = async () => 1;

        const req = { params: { id: "admin-2" }, user: { id: "admin-1" } };
        const res = responseHarness();
        await toggleUserStatus(req, res, () => {});

        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, "Cannot deactivate the only active administrator");
    } finally {
        User.findById = originalFindById;
        User.countDocuments = originalCountDocuments;
    }
});

test("toggleUserStatus successfully deactivates a user and increments tokenVersion", async () => {
    const originalFindById = User.findById;
    try {
        let saved = false;
        User.findById = async (id) => ({
            _id: { toString: () => "cust-1" },
            role: "user",
            isActive: true,
            tokenVersion: 2,
            save: async function() { saved = true; },
            toObject: function() {
                return {
                    _id: "cust-1",
                    role: this.role,
                    isActive: this.isActive,
                    tokenVersion: this.tokenVersion,
                    password: "secret"
                };
            }
        });

        const req = { params: { id: "cust-1" }, user: { id: "admin-1" } };
        const res = responseHarness();
        await toggleUserStatus(req, res, () => {});

        assert.equal(res.statusCode, 200);
        assert.equal(saved, true);
        assert.equal(res.body.data.isActive, false);
        assert.equal(res.body.data.tokenVersion, 3);
        assert.equal("password" in res.body.data, false);
    } finally {
        User.findById = originalFindById;
    }
});