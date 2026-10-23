const express = require("express");

const router = express.Router();

const {
    login,
    logout,
    requestPasswordReset,
    resetPassword
} = require("../controller/auth.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { createRateLimit } = require("../middlewares/rateLimit.middleware");

const resetLimiter = createRateLimit({
    windowMs: 60 * 60 * 1000,
    maxRequests: 5,
    message: "Too many password reset attempts. Please try again later."
});

const loginLimiter = createRateLimit({
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    message: "Too many sign-in attempts. Please try again in 15 minutes."
});


// Login and one-time password reset flows.
router.post("/login", loginLimiter, login);
router.post("/forgot-password", resetLimiter, requestPasswordReset);
router.post("/reset-password", resetLimiter, resetPassword);

router.post("/logout", authenticate, logout);


module.exports = router;