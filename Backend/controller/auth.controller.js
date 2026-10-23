const User = require("../model/user.model");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { sendPasswordResetEmail } = require("../utilities/emailService");
const logger = require("../utilities/logger");

const MIN_LOGIN_TIME = 150;


// Generate JWT
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user._id.toString(),
            tokenVersion: Number(user.tokenVersion || 0)
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN
        }
    );
};


// Keep login response time above a minimum threshold
const waitForMinimumResponseTime = async (startTime) => {
    const elapsedTime = Date.now() - startTime;
    const remainingTime = MIN_LOGIN_TIME - elapsedTime;

    if (remainingTime > 0) {
        await new Promise((resolve) => {
            setTimeout(resolve, remainingTime);
        });
    }
};


// Login
exports.login = async (req, res) => {
    const startTime = Date.now();

    try {
        const { email, password } = req.body || {};

        const normalizedEmail =
            typeof email === "string"
                ? email.trim().toLowerCase()
                : "";

        const userPassword =
            typeof password === "string"
                ? password
                : "";

        // Validate input
        if (!normalizedEmail || !userPassword) {
            await waitForMinimumResponseTime(startTime);

            return res.status(400).json({
                error: "Email and password are required"
            });
        }

        // Reject oversized password input
        if (Buffer.byteLength(userPassword, "utf8") > 72) {
            await waitForMinimumResponseTime(startTime);

            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        // Check environment configuration
        if (
            !process.env.JWT_SECRET ||
            !process.env.JWT_EXPIRES_IN ||
            !process.env.DUMMY_PASSWORD_HASH
        ) {
            logger.logSafely("error", "Authentication environment variables are missing", {
                event: "auth.configuration.missing"
            });

            await waitForMinimumResponseTime(startTime);

            return res.status(500).json({
                error: "Authentication service is not configured"
            });
        }

        const myUser = await User.findOne({
            email: normalizedEmail
        });

        const passwordHash = myUser
            ? myUser.password
            : process.env.DUMMY_PASSWORD_HASH;

        // Compare the password in both cases
        const isCorrectPassword = await bcrypt.compare(
            userPassword,
            passwordHash
        );

        // Use the same response for invalid credentials
        if (
            !myUser ||
            myUser.isActive !== true ||
            !isCorrectPassword
        ) {
            await waitForMinimumResponseTime(startTime);

            return res.status(401).json({
                error: "Invalid email or password"
            });
        }

        const token = generateToken(myUser);

        const userData = myUser.toObject();

        delete userData.password;

        await waitForMinimumResponseTime(startTime);

        return res.status(200).json({
            message: "Login successful",
            token,
            data: userData
        });

    } catch (err) {
        logger.logError("auth.login.failed", err, {
            requestId: req.id,
            method: req.method
        });

        await waitForMinimumResponseTime(startTime);

        return res.status(500).json({
            error: "Internal server error"
        });
    }
};

// Revoke all current access tokens for this account by incrementing tokenVersion.
exports.logout = async (req, res, next) => {
    try {
        req.user.tokenVersion = Number(req.user.tokenVersion || 0) + 1;
        await req.user.save();
        return res.status(200).json({ message: "Logged out successfully" });
    } catch (err) {
        return next(err);
    }
};


// Always return the same public response, whether or not the email is registered.
exports.requestPasswordReset = async (req, res) => {
    const normalizedEmail = typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
    const genericResponse = {
        message: "If an active account matches that email, a password reset link will be sent shortly."
    };

    if (!normalizedEmail || normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(200).json(genericResponse);
    }

    try {
        const user = await User.findOne({ email: normalizedEmail, isActive: true }).select("+resetPasswordTokenHash +resetPasswordExpires name email");
        if (user) {
            const rawToken = crypto.randomBytes(32).toString("base64url");
            user.resetPasswordTokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            user.resetPasswordExpires = new Date(Date.now() + 20 * 60 * 1000);
            await user.save();
            const baseUrl = (process.env.APP_URL || "http://localhost:4200").replace(/\/$/, "");
            const resetUrl = new URL("/reset-password", baseUrl);
            resetUrl.searchParams.set("token", rawToken);
            await sendPasswordResetEmail(user, resetUrl.toString());
        }
    } catch (error) {
        // Never include the reset token, user existence, or provider response in the API result.
        logger.logError("auth.password_reset_request.failed", error, { event: "auth.password_reset_request.failed" });
    }

    return res.status(200).json(genericResponse);
};

exports.resetPassword = async (req, res, next) => {
    try {
        const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
        const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
        if (!token || token.length > 200) {
            return res.status(400).json({ error: "The password reset link is invalid or expired." });
        }
        if (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
            return res.status(400).json({ error: "Password must contain at least 8 characters and be no more than 72 UTF-8 bytes." });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const user = await User.findOne({
            resetPasswordTokenHash: tokenHash,
            resetPasswordExpires: { $gt: new Date() },
            isActive: true
        }).select("+resetPasswordTokenHash +resetPasswordExpires password tokenVersion isActive");

        if (!user) {
            return res.status(400).json({ error: "The password reset link is invalid or expired." });
        }

        user.password = newPassword;
        user.tokenVersion = Number(user.tokenVersion || 0) + 1;
        user.resetPasswordTokenHash = null;
        user.resetPasswordExpires = null;
        await user.save();

        return res.status(200).json({ message: "Password changed successfully. Please sign in again." });
    } catch (error) {
        return next(error);
    }
};
