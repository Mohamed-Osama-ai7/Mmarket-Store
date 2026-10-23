const jwt = require("jsonwebtoken");

const mongoose = require("mongoose");

const User = require("../model/user.model");
const logger = require("../utilities/logger");

exports.authenticate = async (req, res, next) => {
    try {
        // 1. Get the token from the Authorization header
        const authHeader = req.headers.authorization;

        if (
            !authHeader ||
            !authHeader.startsWith("Bearer ")
        ) {
            return res.status(401).json({
                message: "Authentication required"
            });
        }

        const token = authHeader.slice(7).trim();

        if (!token) {
            return res.status(401).json({
                message: "Authentication required"
            });
        }

        // 2. Check JWT_SECRET configuration
        if (!process.env.JWT_SECRET) {
            logger.logSafely("error", "Authentication configuration is incomplete", {
                event: "auth.configuration.missing"
            });

            return res.status(500).json({
                message: "Authentication service is not configured"
            });
        }

        // 3. Verify the token
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // 4. Validate the user ID
        if (
            !decoded ||
            typeof decoded.id !== "string" ||
            !mongoose.isValidObjectId(decoded.id)
        ) {
            return res.status(401).json({
                message: "Invalid authentication token"
            });
        }

        // 5. Find the user in the database
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({
                message: "User not found"
            });
        }

        // Tokens issued before logout or password changes are no longer accepted.
        if (Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
            return res.status(401).json({
                message: "Session expired. Please sign in again."
            });
        }

        // 6. Reject inactive accounts
        if (user.isActive !== true) {
            return res.status(403).json({
                message: "User account is inactive"
            });
        }

        // 7. Attach the authenticated user to the request
        req.user = user;

        // 8. Continue to the next middleware or controller
        return next();

    } catch (error) {
        // Invalid, expired, or otherwise unverifiable token
        if (
            error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }

        // Unexpected database or server errors
        logger.logError("auth.authentication.failed", error, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            message: "Authentication failed"
        });
    }
};
