const { randomUUID } = require("node:crypto");
const logger = require("../utilities/logger");

const requestLogger = (log = logger) => (req, res, next) => {
    req.id = randomUUID();
    const startTime = process.hrtime.bigint();

    res.once("finish", () => {
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
        const routePath = typeof req.route?.path === "string"
            ? `${req.baseUrl}${req.route.path}`
            : "[unmatched]";
        const level = res.statusCode >= 400 ? "warn" : "http";

        try {
            log.log(level, "HTTP request completed", {
                event: "http.request",
                requestId: req.id,
                method: req.method,
                path: routePath,
                statusCode: res.statusCode,
                durationMs: Math.round(durationMs * 100) / 100
            });
        } catch {
            reportRequestLogFailure();
        }
    });

    return next();
};

const reportRequestLogFailure = () => {
    try {
        process.stderr.write("HTTP request logging failed.\n");
    } catch {
        // Logging fallback must not interrupt request handling.
    }
};

module.exports = requestLogger;
