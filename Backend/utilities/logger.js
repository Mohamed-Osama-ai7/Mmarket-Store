const fs = require("node:fs");
const path = require("node:path");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
};

const sensitiveKeyPattern =
    /password|passwd|token|secret|authorization|cookie|api.?key|access.?key|credential|jwt|session|private.?key|connection.?string|database.?uri|mongo.?uri|db.?uri/i;
const MAX_STRING_LENGTH = 10000;
const MAX_COLLECTION_SIZE = 1000;
const MAX_OBJECT_DEPTH = 8;

const redactText = value => value
    .replace(
        /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/\S+/gi,
        "[REDACTED_DATABASE_URI]"
    )
    .replace(
        /\bhttps?:\/\/[^:/\s@]+:[^@\s/]+@[^\s"'<>]+/gi,
        "[REDACTED_URL_CREDENTIALS]"
    )
    .replace(/\bBearer\s+\S+/gi, "******")
    .replace(
        /\b((?:access|refresh)[_-]?(?:token|key)|client[_-]?secret|password|passwd|token|secret|authorization|cookie|api[_-]?key|credential|jwt|session[_-]?id|private[_-]?key|mongo[_-]?uri|database[_-]?uri|db[_-]?uri)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n,;]+)/gi,
        "$1$2[REDACTED]"
    )
    .replace(
        /([?&](?:access[_-]?(?:token|key)|refresh[_-]?token|client[_-]?secret|password|passwd|token|secret|api[_-]?key|credential|jwt|session[_-]?id)=)[^&#\s]*/gi,
        "$1[REDACTED]"
    )
    .replace(
        /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\b/g,
        "[REDACTED_JWT]"
    )
    .replace(
        /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
        "[REDACTED_CREDENTIAL]"
    )
    .slice(0, MAX_STRING_LENGTH);

const getSafeProperty = (value, key) => {
    try {
        for (let current = value; current; current = Object.getPrototypeOf(current)) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);
            if (descriptor) {
                return Object.prototype.hasOwnProperty.call(descriptor, "value")
                    ? descriptor.value
                    : "[Accessor]";
            }
        }
        return undefined;
    } catch {
        return "[Unavailable]";
    }
};

const sanitizeValue = (value, key = "", context = {
    active: new WeakSet(),
    depth: 0
}) => {
    if (sensitiveKeyPattern.test(key)) {
        return "[REDACTED]";
    }

    if (typeof value === "string") {
        return redactText(value);
    }

    if (
        value === null ||
        value === undefined ||
        typeof value === "boolean" ||
        typeof value === "number"
    ) {
        return value;
    }

    if (typeof value === "bigint") {
        return value.toString();
    }

    if (typeof value === "symbol") {
        return value.toString();
    }

    if (typeof value === "function") {
        return "[Function]";
    }

    if (context.depth >= MAX_OBJECT_DEPTH) {
        return "[MaxDepth]";
    }

    if (context.active.has(value)) {
        return "[Circular]";
    }

    context.active.add(value);
    context.depth += 1;

    try {
        let isError = false;
        try {
            isError = value instanceof Error;
        } catch {
            return "[Unserializable]";
        }

        if (isError) {
            const name = getSafeProperty(value, "name");
            const message = getSafeProperty(value, "message");
            const stack = getSafeProperty(value, "stack");
            const cause = getSafeProperty(value, "cause");

            return {
                name: sanitizeValue(name, "name", context),
                message: sanitizeValue(message, "message", context),
                ...(typeof stack === "string"
                    ? { stack: sanitizeValue(stack, "stack", context) }
                    : {}),
                ...(cause === undefined
                    ? {}
                    : { cause: sanitizeValue(cause, "cause", context) })
            };
        }

        if (Buffer.isBuffer(value)) {
            return `[Buffer ${value.length} bytes]`;
        }

        let isDate = false;
        try {
            isDate = value instanceof Date;
        } catch {
            return "[Unserializable]";
        }

        if (isDate) {
            try {
                return value.toISOString();
            } catch {
                return "[Invalid Date]";
            }
        }

        if (Array.isArray(value)) {
            let length;
            try {
                length = value.length;
            } catch {
                return "[Unserializable]";
            }
            const sanitized = [];
            for (let index = 0; index < Math.min(length, MAX_COLLECTION_SIZE); index += 1) {
                let descriptor;
                try {
                    descriptor = Object.getOwnPropertyDescriptor(value, String(index));
                } catch {
                    descriptor = undefined;
                }
                const item = descriptor &&
                    Object.prototype.hasOwnProperty.call(descriptor, "value")
                    ? descriptor.value
                    : descriptor
                        ? "[Accessor]"
                        : undefined;
                sanitized.push(sanitizeValue(item, "", context));
            }
            if (length > MAX_COLLECTION_SIZE) {
                sanitized.push("[Truncated]");
            }
            return sanitized;
        }

        let keys;
        try {
            keys = Object.keys(value);
        } catch {
            return "[Unserializable]";
        }

        const sanitized = {};
        for (const entryKey of keys.slice(0, MAX_COLLECTION_SIZE)) {
            let descriptor;
            try {
                descriptor = Object.getOwnPropertyDescriptor(value, entryKey);
            } catch {
                Object.defineProperty(sanitized, entryKey, {
                    value: "[Unavailable]",
                    enumerable: true,
                    configurable: true,
                    writable: true
                });
                continue;
            }
            const entryValue = descriptor &&
                Object.prototype.hasOwnProperty.call(descriptor, "value")
                ? sanitizeValue(descriptor.value, entryKey, context)
                : "[Accessor]";
            Object.defineProperty(sanitized, entryKey, {
                value: entryValue,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
        if (keys.length > MAX_COLLECTION_SIZE) {
            Object.defineProperty(sanitized, "[Truncated]", {
                value: keys.length - MAX_COLLECTION_SIZE,
                enumerable: true,
                configurable: true,
                writable: true
            });
        }
        return sanitized;
    } catch {
        return "[Unserializable]";
    } finally {
        context.depth -= 1;
        context.active.delete(value);
    }
};

const redactFormat = winston.format(info => {
    try {
        for (const key of Object.keys(info)) {
            info[key] = sanitizeValue(info[key], key);
        }
    } catch {
        info.message = "[Unserializable log record]";
    }
    return info;
});

const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

const reportTransportFailure = () => {
    try {
        process.stderr.write("Winston transport failure; application logging may be incomplete.\n");
    } catch {
        // Logging fallback must not interrupt request handling.
    }
};

const createLogger = ({
    logDir = process.env.MEAN_L2_LOG_DIR || path.join(__dirname, "..", "logs"),
    environment = process.env.NODE_ENV,
    consoleTransport = true,
    maxSize = "20m"
} = {}) => {
    fs.mkdirSync(logDir, { recursive: true });

    const combinedTransport = new DailyRotateFile({
        dirname: logDir,
        filename: "combined.log.%DATE%",
        frequency: "daily",
        datePattern: "YYYY-MM-DD",
        maxSize,
        maxFiles: "14d",
        zippedArchive: true,
        level: "silly",
        format: jsonFormat
    });
    const errorTransport = new DailyRotateFile({
        dirname: logDir,
        filename: "error.log.%DATE%",
        frequency: "daily",
        datePattern: "YYYY-MM-DD",
        maxSize,
        maxFiles: "14d",
        zippedArchive: true,
        level: "error",
        format: jsonFormat
    });

    combinedTransport.on("error", reportTransportFailure);
    errorTransport.on("error", reportTransportFailure);

    const transports = [combinedTransport, errorTransport];

    if (consoleTransport) {
        const consoleFormat = environment === "production"
            ? winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) =>
                    `${timestamp} ${level}: ${message}`)
            )
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) =>
                    `${timestamp} ${level}: ${message}`)
            );

        transports.push(new winston.transports.Console({
            level: environment === "production" ? "warn" : "http",
            format: consoleFormat
        }));
    }

    const logger = winston.createLogger({
        levels,
        level: "silly",
        format: winston.format.combine(
            winston.format.errors({ stack: true }),
            redactFormat()
        ),
        transports
    });
    logger.on("error", reportTransportFailure);

    logger.logSafely = (level, message, metadata = {}) => {
        try {
            logger.log(level, message, metadata);
        } catch {
            reportTransportFailure();
        }
    };

    logger.logError = (event, error, metadata = {}) => {
        try {
            logger.error(event, {
                ...metadata,
                event,
                error: sanitizeValue(error)
            });
        } catch {
            reportTransportFailure();
        }
    };

    return logger;
};

const logger = createLogger();
logger.createLogger = createLogger;
logger.sanitizeValue = sanitizeValue;

module.exports = logger;
