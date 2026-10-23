const mongoose = require("mongoose");
const logger = require("../utilities/logger");

const connectDB = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not configured");
    }

    const conn = await mongoose.connect(
        process.env.MONGO_URI
    );

    logger.logSafely("info", "Connected to MongoDB", {
        event: "database.connected"
    });

    return conn;
};

module.exports = connectDB;