class AppError extends Error {
    constructor(message, statusCode) {
        if (typeof message !== "string" || !message.trim()) {
            throw new TypeError("AppError requires a non-empty message");
        }

        if (
            !Number.isInteger(statusCode) ||
            statusCode < 400 ||
            statusCode > 599
        ) {
            throw new RangeError(
                "AppError statusCode must be an integer between 400 and 599"
            );
        }

        super(message);

        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.status = statusCode < 500 ? "fail" : "error";
        this.isOperational = true;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

module.exports = AppError;