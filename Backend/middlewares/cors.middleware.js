const cors = require("cors");
const AppError = require("../utilities/appError");

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
    : [];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests without an Origin header
        if (!origin) {
            return callback(null, true);
        }

        // Allow only configured origins
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(
            new AppError("Origin is not allowed by CORS", 403)
        );
    },

    // This API authenticates with Bearer tokens, not cross-origin cookies.
    credentials: false,

    methods: [
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "OPTIONS"
    ],

    allowedHeaders: [
        "Content-Type",
        "Authorization",
        "Idempotency-Key",
        "X-Guest-Order-Token"
    ],

    optionsSuccessStatus: 204
};

module.exports = cors(corsOptions);
