const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AppError = require("../utilities/appError");

const testLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-error-suite-"));
const previousLogDir = process.env.MEAN_L2_LOG_DIR;
process.env.MEAN_L2_LOG_DIR = testLogDir;
const logger = require("../utilities/logger");
const errorHandler = require("../middlewares/errorHandler");
const app = require("../app");
if (previousLogDir === undefined) {
    delete process.env.MEAN_L2_LOG_DIR;
} else {
    process.env.MEAN_L2_LOG_DIR = previousLogDir;
}

const closeLogger = async log => {
    const transports = [...log.transports];

    await new Promise(resolve => {
        log.once("finish", resolve);
        log.end();
    });

    await Promise.all(transports.map(transport =>
        new Promise(resolve => {
            if (!transport.logStream || transport.logStream.writableFinished) {
                resolve();
                return;
            }

            transport.once("finish", resolve);
            transport.close();
        })
    ));
};

after(async () => {
    await closeLogger(logger);
    fs.rmSync(testLogDir, { recursive: true, force: true });
});

const listen = serverApp => new Promise(resolve => {
    const server = serverApp.listen(0, "127.0.0.1", () => {
        resolve(server);
    });
});

const request = (server, {
    method = "GET",
    path = "/",
    body,
    headers = {}
} = {}) => new Promise((resolve, reject) => {
    const requestBody = body === undefined
        ? undefined
        : Buffer.from(body);
    const req = http.request({
        host: "127.0.0.1",
        port: server.address().port,
        method,
        path,
        headers: {
            ...(requestBody
                ? { "Content-Length": requestBody.length }
                : {}),
            ...headers
        }
    }, res => {
        const chunks = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => {
            const responseBody = Buffer.concat(chunks).toString();
            resolve({
                statusCode: res.statusCode,
                body: responseBody
            });
        });
    });
    req.on("error", reject);

    if (requestBody) {
        req.write(requestBody);
    }

    req.end();
});

const withServer = async (serverApp, callback) => {
    const server = await listen(serverApp);
    try {
        await callback(server);
    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections();
        });
    }
};

const createErrorTestApp = (route, handler = errorHandler) => {
    const testApp = express();
    route(testApp);
    testApp.use(handler);
    return testApp;
};

const assertErrorResponse = async (
    serverApp,
    expectedStatus,
    expectedMessage,
    options
) => withServer(serverApp, async server => {
    const response = await request(server, options);
    assert.equal(response.statusCode, expectedStatus);
    assert.deepEqual(JSON.parse(response.body), {
        status: expectedStatus < 500 ? "fail" : "error",
        message: expectedMessage
    });
});

test("AppError sets operational status and captures a stack", () => {
    const clientError = new AppError("Product not found", 404);
    const serverError = new AppError("Service unavailable", 503);

    assert.equal(clientError.statusCode, 404);
    assert.equal(clientError.status, "fail");
    assert.equal(clientError.isOperational, true);
    assert.match(clientError.stack, /AppError/);
    assert.equal(serverError.status, "error");
});

test("AppError rejects empty messages and invalid HTTP status codes", () => {
    assert.throws(() => new AppError("", 400), TypeError);
    for (const statusCode of [200, 399, 600, 400.5, "400"]) {
        assert.throws(() => new AppError("Invalid", statusCode), RangeError);
    }
});

test("unknown endpoint keeps its existing HTTP 404 response contract", async () => {
    await withServer(app, async server => {
        const response = await request(server, {
            path: "/not-a-real-endpoint"
        });
        assert.equal(response.statusCode, 404);
        assert.deepEqual(JSON.parse(response.body), {
            error: "Route not found"
        });
    });
});

test("malformed JSON is handled by the global error middleware", async () => {
    await withServer(app, async server => {
        const response = await request(server, {
            method: "POST",
            path: "/api/v1/auth/login",
            body: "{",
            headers: { "Content-Type": "application/json" }
        });
        assert.equal(response.statusCode, 400);
        assert.deepEqual(JSON.parse(response.body), {
            status: "fail",
            message: "Invalid JSON request body"
        });
    });
});

test("operational AppError is returned with its status and message", async () => {
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => {
            next(new AppError("Product not found", 404));
        });
    });

    await assertErrorResponse(testApp, 404, "Product not found");
});

test("server-side AppError messages are hidden from HTTP clients", async () => {
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => {
            next(new AppError("Internal provider secret", 503));
        });
    });

    await assertErrorResponse(testApp, 503, "Internal server error");
});

test("Mongoose CastError is normalized to HTTP 400", async () => {
    const error = new mongoose.Error.CastError(
        "ObjectId",
        "secret input",
        "_id"
    );
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => next(error));
    });

    await assertErrorResponse(testApp, 400, "Invalid data provided");
});

test("Mongoose ValidationError is normalized to HTTP 400", async () => {
    const error = new mongoose.Error.ValidationError();
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => next(error));
    });

    await assertErrorResponse(testApp, 400, "Invalid data provided");
});

test("MongoDB duplicate-key errors become safe HTTP 409 responses", async () => {
    const error = new Error("private_index_name: secret@example.com");
    error.code = 11000;
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => next(error));
    });

    await assertErrorResponse(
        testApp,
        409,
        "A resource with these details already exists"
    );
});

test("Multer errors are normalized without exposing upload internals", async () => {
    const error = new Error("private disk path");
    error.name = "MulterError";
    error.code = "LIMIT_FILE_SIZE";
    const testApp = createErrorTestApp(testApp => {
        testApp.all("/", (req, res, next) => next(error));
    });

    await assertErrorResponse(testApp, 413, "Uploaded file is too large");
});

test("invalid JWT errors become HTTP 401 without exposing token details", async () => {
    const error = new jwt.JsonWebTokenError("private token details");
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => next(error));
    });

    await assertErrorResponse(testApp, 401, "Invalid or expired token");
});

test("expired JWT errors become HTTP 401", async () => {
    const error = new jwt.TokenExpiredError(
        "private token details",
        new Date()
    );
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", (req, res, next) => next(error));
    });

    await assertErrorResponse(testApp, 401, "Invalid or expired token");
});

test("unknown production errors return a generic response without details", async t => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    t.after(() => {
        if (previousNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = previousNodeEnv;
        }
    });

    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", () => {
            throw new Error("private stack, mongodb://user:pass@host/db");
        });
    });

    await assertErrorResponse(testApp, 500, "Internal server error");
});

test("Express 5 forwards rejected asynchronous route handlers", async () => {
    const testApp = createErrorTestApp(testApp => {
        testApp.get("/", async () => {
            throw new AppError("Async failure", 422);
        });
    });

    await assertErrorResponse(testApp, 422, "Async failure");
});

test("errors after headers are sent are delegated without a second response", () => {
    const error = new Error("Already started response");
    let forwardedError;
    const response = { headersSent: true };

    errorHandler(error, {}, response, nextError => {
        forwardedError = nextError;
    });

    assert.equal(forwardedError, error);
});
