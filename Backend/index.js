require("dotenv").config();

const http = require("node:http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const app = require("./app");
const dbConfig = require("./config/db.config");
const { assertEnv } = require("./config/env.validation");
const User = require("./model/user.model");
const logger = require("./utilities/logger");
const { setIO } = require("./utilities/socket");

const port = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1000;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

const io = new Server(server, {
    serveClient: true,
    cors: {
        origin(origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error("Origin is not allowed"));
        },
        methods: ["GET", "POST"]
    },
    connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: false }
});

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string" || !token.trim() || !process.env.JWT_SECRET) {
            return next(new Error("Authentication required"));
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (typeof decoded.id !== "string") return next(new Error("Invalid session"));
        const user = await User.findById(decoded.id).select("role isActive tokenVersion").lean();
        if (!user || user.isActive !== true) return next(new Error("Account unavailable"));
        if (Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
            return next(new Error("Session expired"));
        }
        socket.data.user = { id: String(user._id), role: user.role };
        return next();
    } catch {
        return next(new Error("Invalid or expired session"));
    }
});

io.on("connection", socket => {
    const { id, role } = socket.data.user;
    socket.join(`user:${id}`);
    if (role === "admin") socket.join("admins");
});

setIO(io);

let shuttingDown = false;
const shutdown = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.logSafely("info", "Server shutdown requested", { event: "server.shutdown", signal });
    const forceTimer = setTimeout(() => process.exit(1), 10_000);
    forceTimer.unref?.();
    io.close(() => {
        server.close(async () => {
            try { await require("mongoose").disconnect(); } catch (error) {
                logger.logError("server.shutdown.mongo.failed", error);
            }
            clearTimeout(forceTimer);
            logger.end();
            process.exit(0);
        });
    });
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

// Listen first so the platform sees an open port and /health/live answers while MongoDB is
// still connecting; /health/ready stays 503 until the database is reachable. A failed connection
// is retried with backoff instead of killing the process, so a temporary Atlas/network problem
// self-heals and the logs show the real reason.
const connectWithRetry = async (attempt = 1) => {
    try {
        await dbConfig();
    } catch (error) {
        const delay = Math.min(30_000, 2_000 * attempt);
        logger.logError("database.connect.failed", error);
        logger.logSafely("warn", "Retrying MongoDB connection", { event: "database.connect.retry", attempt, delayMs: delay });
        if (shuttingDown) return;
        setTimeout(() => connectWithRetry(attempt + 1), delay);
    }
};

const startServer = () => {
    try {
        assertEnv();
    } catch (error) {
        logger.logError("server.start.failed", error);
        process.exitCode = 1;
        logger.end();
        return;
    }
    server.listen(port, "0.0.0.0", () => {
        logger.logSafely("info", "Server started", { event: "server.started", port });
    });
    connectWithRetry();
};

startServer();
