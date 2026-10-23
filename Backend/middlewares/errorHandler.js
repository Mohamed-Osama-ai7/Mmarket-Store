const AppError = require("../utilities/appError");
const logger = require("../utilities/logger");

const getErrorResponse = err => {
    if (err instanceof AppError) {
        return {
            statusCode: err.statusCode,
            message: err.statusCode < 500
                ? err.message
                : "Internal server error"
        };
    }

    if (err.name === "CastError") {
        return {
            statusCode: 400,
            message: "Invalid data provided"
        };
    }

    if (err.name === "ValidationError") {
        return {
            statusCode: 400,
            message: "Invalid data provided"
        };
    }

    if (err.code === 11000) {
        return {
            statusCode: 409,
            message: "A resource with these details already exists"
        };
    }

    if (
        err.name === "JsonWebTokenError" ||
        err.name === "TokenExpiredError" ||
        err.name === "NotBeforeError"
    ) {
        return {
            statusCode: 401,
            message: "Invalid or expired token"
        };
    }

    if (err.type === "entity.parse.failed") {
        return {
            statusCode: 400,
            message: "Invalid JSON request body"
        };
    }

    if (err.type === "entity.too.large") {
        return {
            statusCode: 413,
            message: "Request body is too large"
        };
    }

    if (err.name === "MulterError") {
        if (err.code === "LIMIT_FILE_SIZE") {
            return {
                statusCode: 413,
                message: "Uploaded file is too large"
            };
        }

        return {
            statusCode: 400,
            message: "Invalid file upload"
        };
    }

    if (err instanceof Error && err.isOperational === true) {
        const statusCode = Number.isInteger(err.statusCode) &&
            err.statusCode >= 400 &&
            err.statusCode <= 599
            ? err.statusCode
            : 500;

        return {
            statusCode,
            message: statusCode < 500
                ? err.message
                : "Internal server error"
        };
    }

    return {
        statusCode: 500,
        message: "Internal server error"
    };
};

const errorHandler = (err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    const response = getErrorResponse(err);

    if (response.statusCode >= 500) {
        logger.logError("http.unhandled_error", err, {
            requestId: req.id,
            method: req.method
        });
    }

    return res.status(response.statusCode).json({
        status: response.statusCode < 500 ? "fail" : "error",
        message: response.message
    });
};

module.exports = errorHandler;