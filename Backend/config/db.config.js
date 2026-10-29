const mongoose = require("mongoose");
const logger = require("../utilities/logger");

const connectDB = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not configured");
    }

    // Bounded timeouts so a bad URI/allowlist fails fast and visibly instead of hanging requests.
    const conn = await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 20
    });

    logger.logSafely("info", "Connected to MongoDB", {
        event: "database.connected"
    });

    return conn;
};

module.exports = connectDB;