const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const express = require("express");

const suiteLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-logging-suite-"));
const previousLogDir = process.env.MEAN_L2_LOG_DIR;
process.env.MEAN_L2_LOG_DIR = suiteLogDir;
const logger = require("../utilities/logger");
const requestLogger = require("../middlewares/requestLogger");
const errorHandler = require("../middlewares/errorHandler");
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

const startServer = app => new Promise(resolve => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
});

const get = (server, requestPath) => new Promise((resolve, reject) => {
    http.get({
        host: "127.0.0.1",
        port: server.address().port,
        path: requestPath
    }, response => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
    }).on("error", reject);
});

const withServer = async (app, callback) => {
    const server = await startServer(app);
    try {
        await callback(server);
    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeAllConnections();
        });
    }
};

after(async () => {
    await closeLogger(logger);
    fs.rmSync(suiteLogDir, { recursive: true, force: true });
});

test("rotating JSON transports include configured levels and filter errors", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-logs-"));
    const log = logger.createLogger({
        logDir,
        environment: "production",
        consoleTransport: false
    });
    let closed = false;

    try {
        assert.equal(log.transports[0].options.maxFiles, "14d");
        assert.equal(log.transports[0].options.maxSize, "20m");
        assert.equal(log.transports[0].options.zippedArchive, true);
        assert.equal(log.transports[0].options.frequency, "daily");
        assert.equal(log.transports[0].options.datePattern, "YYYY-MM-DD");
        assert.equal(log.transports[1].options.level, "error");
        log.error("error event", { event: "test.error" });
        log.warn("warning event", { event: "test.warning" });
        log.info("info event", { event: "test.info" });
        log.log("http", "http event", { event: "test.http" });
        log.verbose("verbose event", { event: "test.verbose" });
        log.debug("debug event", { event: "test.debug" });
        log.silly("silly event", { event: "test.silly" });
        await closeLogger(log);
        closed = true;

        const files = fs.readdirSync(logDir);
        const combinedName = files.find(name => /^combined\.log\.\d{4}-\d{2}-\d{2}$/.test(name));
        const errorName = files.find(name => /^error\.log\.\d{4}-\d{2}-\d{2}$/.test(name));
        assert.ok(combinedName, "expected the combined rotating log");
        assert.ok(errorName, "expected the error-only rotating log");

        const readRecords = name => fs.readFileSync(
            path.join(logDir, name),
            "utf8"
        )
            .trim()
            .split(/\r?\n/)
            .map(line => JSON.parse(line));
        const combined = readRecords(combinedName);
        const errors = readRecords(errorName);

        assert.deepEqual(
            combined.map(record => record.level),
            ["error", "warn", "info", "http", "verbose", "debug", "silly"]
        );
        assert.deepEqual(errors.map(record => record.level), ["error"]);
        assert.equal(combined[0].event, "test.error");
        assert.equal(typeof combined[0].timestamp, "string");
        assert.ok(Number.isNaN(Date.parse(combined[0].timestamp)) === false);
    } finally {
        if (!closed) {
            await closeLogger(log);
        }
        fs.rmSync(logDir, { recursive: true, force: true });
    }
});

test("size rollover compresses the archived segment", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-rollover-"));
    const log = logger.createLogger({
        logDir,
        environment: "production",
        consoleTransport: false,
        maxSize: "1k"
    });
    let closed = false;

    try {
        const archivedFile = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Timed out waiting for a compressed log archive"));
            }, 5000);
            log.transports[0].once("archive", file => {
                clearTimeout(timeout);
                resolve(file);
            });
        });

        for (let index = 0; index < 2; index += 1) {
            log.info("rollover fixture", { padding: "x".repeat(1200) });
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        const archivePath = await archivedFile;
        await closeLogger(log);
        closed = true;
        assert.ok(fs.existsSync(archivePath), "expected the rotated gzip archive");
        assert.match(path.basename(archivePath), /^combined\.log\.\d{4}-\d{2}-\d{2}(?:\.\d+)?\.gz$/);
    } finally {
        if (!closed) {
            await closeLogger(log);
        }
        fs.rmSync(logDir, { recursive: true, force: true });
    }
});

test("console verbosity is lower in production", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-console-"));
    const development = logger.createLogger({
        logDir: path.join(logDir, "development"),
        environment: "development"
    });
    const production = logger.createLogger({
        logDir: path.join(logDir, "production"),
        environment: "production"
    });

    try {
        const developmentConsole = development.transports.find(
            transport => transport.constructor.name === "Console"
        );
        const productionConsole = production.transports.find(
            transport => transport.constructor.name === "Console"
        );
        assert.equal(developmentConsole.level, "http");
        assert.equal(productionConsole.level, "warn");
        await Promise.all([
            closeLogger(development),
            closeLogger(production)
        ]);
    } finally {
        fs.rmSync(logDir, { recursive: true, force: true });
    }
});

test("all transports redact sensitive metadata, credentials, and error causes", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-redaction-"));
    const log = logger.createLogger({
        logDir,
        environment: "development"
    });
    let consoleOutput = "";
    let closed = false;

    try {
        const consoleTransport = log.transports.find(
            transport => transport.constructor.name === "Console"
        );
        consoleTransport.forceConsole = true;
        consoleTransport._consoleLog = message => {
            consoleOutput += `${message}\n`;
        };
        log.info("request processed Bearer bearer-fixture", {
            password: "do-not-log",
            token: "token-fixture",
            access_token: "access-fixture",
            authorization: "auth-fixture",
            cookie: "cookie-fixture",
            mongoUri: "connection-fixture",
            detail: "mongodb://user:password@db.example/app Bearer bearer-fixture access_token=text-fixture",
            url: "https://user:password@example.test/path?token=query-fixture"
        });
        const nested = new Error("nested secret=error-fixture");
        const error = new Error("outer failure", { cause: nested });
        log.logError("test.error", error);
        await closeLogger(log);
        closed = true;

        const combinedName = fs.readdirSync(logDir)
            .find(name => /^combined\.log\.\d{4}-\d{2}-\d{2}$/.test(name));
        const contents = fs.readFileSync(
            path.join(logDir, combinedName),
            "utf8"
        );
        assert.doesNotMatch(
            contents,
            /do-not-log|token-fixture|access-fixture|text-fixture|auth-fixture|cookie-fixture|connection-fixture|password@|bearer-fixture|query-fixture|error-fixture/
        );
        assert.match(contents, /\[REDACTED\]/);
        assert.match(contents, /"cause":/);
        assert.doesNotMatch(
            consoleOutput,
            /do-not-log|token-fixture|access-fixture|text-fixture|auth-fixture|cookie-fixture|connection-fixture|password@|bearer-fixture|query-fixture|error-fixture/
        );
        assert.match(consoleOutput, /\*{6}/);
    } finally {
        if (!closed) {
            await closeLogger(log);
        }
        fs.rmSync(logDir, { recursive: true, force: true });
    }
});

test("circular, deep, and accessor metadata is bounded and safe", async () => {
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mean-l2-shapes-"));
    const log = logger.createLogger({
        logDir,
        environment: "production",
        consoleTransport: false
    });
    let closed = false;

    try {
        const circular = { detail: "visible" };
        circular.self = circular;
        const deep = {};
        let cursor = deep;
        for (let index = 0; index < 12; index += 1) {
            cursor.child = {};
            cursor = cursor.child;
        }
        Object.defineProperty(circular, "untrustedGetter", {
            enumerable: true,
            get() {
                throw new Error("getter should not be invoked");
            }
        });

        assert.doesNotThrow(() => {
            log.info("safe metadata", { circular, deep });
        });
        await closeLogger(log);
        closed = true;

        const combinedName = fs.readdirSync(logDir)
            .find(name => /^combined\.log\.\d{4}-\d{2}-\d{2}$/.test(name));
        const contents = fs.readFileSync(path.join(logDir, combinedName), "utf8");
        assert.match(contents, /\[Circular\]/);
        assert.match(contents, /\[MaxDepth\]/);
        assert.match(contents, /\[Accessor\]/);
        assert.doesNotMatch(contents, /getter should not be invoked/);
    } finally {
        if (!closed) {
            await closeLogger(log);
        }
        fs.rmSync(logDir, { recursive: true, force: true });
    }
});

test("request IDs reach downstream handlers and request logs omit query values", async () => {
    const records = [];
    const captureLogger = {
        log(level, message, metadata) {
            records.push({ level, message, ...metadata });
        }
    };
    const app = express();
    let downstreamRequestId;
    app.use(requestLogger(captureLogger));
    app.get("/records/:recordId", (req, res) => {
        downstreamRequestId = req.id;
        return res.status(201).end();
    });

    await withServer(app, async server => {
        assert.equal(
            await get(server, "/records/123?token=private-value"),
            201
        );
    });

    assert.match(downstreamRequestId, /^[0-9a-f-]{36}$/);
    assert.equal(records.length, 1);
    assert.equal(records[0].event, "http.request");
    assert.equal(records[0].requestId, downstreamRequestId);
    assert.equal(records[0].method, "GET");
    assert.equal(records[0].path, "/records/:recordId");
    assert.equal(records[0].statusCode, 201);
    assert.equal(typeof records[0].durationMs, "number");
    assert.doesNotMatch(JSON.stringify(records[0]), /private-value|token=/);
});

test("a failed request log does not change the HTTP response", async () => {
    const app = express();
    app.use(requestLogger({
        log() {
            throw new Error("transport unavailable");
        }
    }));
    app.get("/", (req, res) => res.status(204).end());

    const originalWrite = process.stderr.write;
    process.stderr.write = () => true;
    try {
        await withServer(app, async server => {
            assert.equal(await get(server, "/"), 204);
        });
    } finally {
        process.stderr.write = originalWrite;
    }
});

test("unexpected errors are logged once without changing the error response", async () => {
    const originalLogError = logger.logError;
    const logged = [];
    logger.logError = (...args) => logged.push(args);
    const app = express();
    const requestRecords = [];
    app.use(requestLogger({
        log(level, message, metadata) {
            requestRecords.push({ level, message, ...metadata });
        }
    }));
    app.get("/", (req, res, next) => {
        next(new Error("private internal detail"));
    });
    app.use(errorHandler);

    try {
        await withServer(app, async server => {
            assert.equal(await get(server, "/"), 500);
        });
    } finally {
        logger.logError = originalLogError;
    }

    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "http.unhandled_error");
    assert.equal(
        logged[0][2].requestId,
        requestRecords[0].requestId
    );
    assert.equal(requestRecords[0].level, "warn");
});

test("a logger failure cannot prevent an unexpected error response", () => {
    const originalError = logger.error;
    const originalWrite = process.stderr.write;
    const response = {
        statusCode: undefined,
        body: undefined,
        status(statusCode) {
            this.statusCode = statusCode;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };

    logger.error = () => {
        throw new Error("file transport unavailable");
    };
    process.stderr.write = () => true;

    try {
        errorHandler(
            new Error("internal failure"),
            { id: "request-id", method: "GET" },
            response,
            error => {
                throw error;
            }
        );
    } finally {
        logger.error = originalError;
        process.stderr.write = originalWrite;
    }

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
        status: "error",
        message: "Internal server error"
    });
});
