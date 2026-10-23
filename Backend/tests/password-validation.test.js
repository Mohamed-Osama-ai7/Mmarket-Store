const assert = require("node:assert/strict");
const { test } = require("node:test");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../model/user.model");
const { addUser } = require("../controller/user.controller");
const { login } = require("../controller/auth.controller");

const createResponse = () => ({
    statusCode: undefined,
    body: undefined,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    }
});

const createRegistrationRequest = password => ({
    body: {
        name: "Test User",
        email: "password-test@example.com",
        password
    }
});

const createLoginRequest = password => ({
    body: {
        email: "password-test@example.com",
        password
    }
});

const withRegistrationStubs = async (password, callback) => {
    const originalFindOne = User.findOne;
    const originalCreate = User.create;
    let savedPassword;

    User.findOne = () => ({
        select: async () => null
    });
    User.create = async userData => {
        savedPassword = userData.password;
        return {
            toObject: () => ({
                _id: "test-user",
                name: userData.name,
                email: userData.email,
                password: "hashed-password",
                role: userData.role
            })
        };
    };

    try {
        const response = createResponse();
        await addUser("user")(createRegistrationRequest(password), response);
        await callback(response, savedPassword);
    } finally {
        User.findOne = originalFindOne;
        User.create = originalCreate;
    }
};

const withLoginStubs = async (password, callback) => {
    const originalFindOne = User.findOne;
    const originalCompare = bcrypt.compare;
    const originalSign = jwt.sign;
    const previousEnvironment = {
        JWT_SECRET: process.env.JWT_SECRET,
        JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
        DUMMY_PASSWORD_HASH: process.env.DUMMY_PASSWORD_HASH
    };

    User.findOne = async () => ({
        _id: {
            toString: () => "test-user"
        },
        isActive: true,
        password: "hashed-password",
        toObject: () => ({
            _id: "test-user",
            email: "password-test@example.com",
            password: "hashed-password"
        })
    });
    bcrypt.compare = async () => true;
    jwt.sign = () => "test-token";
    process.env.JWT_SECRET = "test-only-secret";
    process.env.JWT_EXPIRES_IN = "1h";
    process.env.DUMMY_PASSWORD_HASH = "test-only-hash";

    try {
        const response = createResponse();
        await login(createLoginRequest(password), response);
        await callback(response);
    } finally {
        User.findOne = originalFindOne;
        bcrypt.compare = originalCompare;
        jwt.sign = originalSign;

        for (const [name, value] of Object.entries(previousEnvironment)) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
    }
};

test("ASCII password at the minimum boundary is accepted by registration and login", async () => {
    const password = "12345678";

    await withRegistrationStubs(password, response => {
        assert.equal(response.statusCode, 201);
    });
    await withLoginStubs(password, response => {
        assert.equal(response.statusCode, 200);
    });
});

test("a normal ASCII password is accepted by registration and login", async () => {
    const password = "correct-horse-battery";

    await withRegistrationStubs(password, response => {
        assert.equal(response.statusCode, 201);
    });
    await withLoginStubs(password, response => {
        assert.equal(response.statusCode, 200);
    });
});

test("ASCII password at the 72-byte maximum is accepted by registration and login", async () => {
    const password = "a".repeat(72);

    await withRegistrationStubs(password, response => {
        assert.equal(response.statusCode, 201);
    });
    await withLoginStubs(password, response => {
        assert.equal(response.statusCode, 200);
    });
});

test("Unicode and emoji passwords use UTF-8 byte limits consistently", async () => {
    const unicodePasswordAtMaximum = "😀".repeat(18);
    assert.equal(Buffer.byteLength(unicodePasswordAtMaximum, "utf8"), 72);

    await withRegistrationStubs(unicodePasswordAtMaximum, response => {
        assert.equal(response.statusCode, 201);
    });
    await withLoginStubs(unicodePasswordAtMaximum, response => {
        assert.equal(response.statusCode, 200);
    });

    const unicodePasswordOverMaximum = "😀".repeat(19);
    assert.equal(Buffer.byteLength(unicodePasswordOverMaximum, "utf8"), 76);

    await withRegistrationStubs(unicodePasswordOverMaximum, response => {
        assert.equal(response.statusCode, 400);
        assert.equal(
            response.body.error,
            "Password must have a JavaScript string length of at least 8 and be no more than 72 bytes when encoded as UTF-8"
        );
    });
    await withLoginStubs(unicodePasswordOverMaximum, response => {
        assert.equal(response.statusCode, 401);
        assert.deepEqual(response.body, {
            error: "Invalid email or password"
        });
    });
});

test("registration rejects a missing password", async () => {
    const request = createRegistrationRequest(undefined);
    delete request.body.password;
    const response = createResponse();
    await addUser("user")(request, response);
    assert.equal(response.statusCode, 400);
    assert.equal(
        response.body.error,
        "Password must have a JavaScript string length of at least 8 and be no more than 72 bytes when encoded as UTF-8"
    );
});

test("registration rejects empty, non-string, and under-minimum passwords", async () => {
    for (const password of ["", 123, "1234567"]) {
        await withRegistrationStubs(password, response => {
            assert.equal(response.statusCode, 400);
            assert.equal(
                response.body.error,
                "Password must have a JavaScript string length of at least 8 and be no more than 72 bytes when encoded as UTF-8"
            );
        });
    }
});

test("the minimum is measured in JavaScript string-length units", async () => {
    const passwordAtMinimum = "😀".repeat(4);
    assert.equal(passwordAtMinimum.length, 8);
    assert.equal(Buffer.byteLength(passwordAtMinimum, "utf8"), 16);

    await withRegistrationStubs(passwordAtMinimum, response => {
        assert.equal(response.statusCode, 201);
    });

    const passwordBelowMinimum = "😀".repeat(3) + "a";
    assert.equal(passwordBelowMinimum.length, 7);

    await withRegistrationStubs(passwordBelowMinimum, response => {
        assert.equal(response.statusCode, 400);
    });
});

test("the User model enforces the 72-byte maximum without a database", async () => {
    const validUser = new User({
        name: "Test User",
        email: "password-test@example.com",
        password: "a".repeat(72)
    });
    await assert.doesNotReject(validUser.validate());

    const validUnicodeUser = new User({
        name: "Test User",
        email: "unicode-password-test@example.com",
        password: "😀".repeat(18)
    });
    await assert.doesNotReject(validUnicodeUser.validate());

    const invalidUser = new User({
        name: "Test User",
        email: "password-test@example.com",
        password: "a".repeat(73)
    });
    await assert.rejects(invalidUser.validate(), error => {
        assert.equal(error.name, "ValidationError");
        assert.equal(error.errors.password.message, "Password must be no more than 72 bytes when encoded as UTF-8");
        return true;
    });

    const invalidUnicodeUser = new User({
        name: "Test User",
        email: "unicode-password-test@example.com",
        password: "😀".repeat(19)
    });
    await assert.rejects(invalidUnicodeUser.validate(), error => {
        assert.equal(error.name, "ValidationError");
        assert.equal(error.errors.password.message, "Password must be no more than 72 bytes when encoded as UTF-8");
        return true;
    });
});

test("the User model hashes a valid password and the hash accepts it without saving", async () => {
    const password = "😀".repeat(4);
    const user = new User({
        name: "Test User",
        email: "password-test@example.com",
        password
    });

    await user.validate();
    await User.schema.s.hooks.execPre("save", user);

    assert.notEqual(user.password, password);
    assert.equal(await bcrypt.compare(password, user.password), true);
});

test("login preserves the missing password response", async () => {
    const request = createLoginRequest(undefined);
    delete request.body.password;
    const response = createResponse();
    await login(request, response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
        error: "Email and password are required"
    });
});

test("login preserves empty and non-string password responses", async () => {
    for (const password of ["", 123]) {
        await withLoginStubs(password, response => {
            assert.equal(response.statusCode, 400);
            assert.deepEqual(response.body, {
                error: "Email and password are required"
            });
        });
    }
});
