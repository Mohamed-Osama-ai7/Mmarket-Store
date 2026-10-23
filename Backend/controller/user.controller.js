const User = require("../model/user.model");
const logger = require("../utilities/logger");


// Get all users
exports.getUsers = async (req, res) => {
    try {
        const myUsers = await User.find()
            .select("-password")
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            message: "Users retrieved successfully",
            data: myUsers
        });

    } catch (err) {
        logger.logError("users.list.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Failed to retrieve users"
        });
    }
};


// Get user by email
exports.getUserByEmail = async (req, res) => {
    try {
        const email = req.params.email;

        if (
            typeof email !== "string" ||
            !email.trim()
        ) {
            return res.status(400).json({
                error: "Email is required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        const myUser = await User.findOne({
            email: normalizedEmail
        })
            .select("-password")
            .lean();

        if (!myUser) {
            return res.status(404).json({
                error: "User not found",
                data: null
            });
        }

        return res.status(200).json({
            message: "User retrieved successfully",
            data: myUser
        });

    } catch (err) {
        logger.logError("users.get_by_email.failed", err, {
            requestId: req.id,
            method: req.method
        });

        return res.status(500).json({
            error: "Failed to retrieve user"
        });
    }
};



// Get the authenticated user's own profile.
exports.getMyProfile = async (req, res, next) => {
    try {
        const myUser = await User.findById(req.user.id).select("-password").lean();

        if (!myUser || myUser.isActive !== true) {
            return res.status(404).json({ error: "User not found" });
        }

        return res.status(200).json({
            message: "Profile retrieved successfully",
            data: myUser
        });
    } catch (err) {
        return next(err);
    }
};

// Add user
// Use addUser("user") for public registration.
// Use addUser("admin") only on a protected admin route.
exports.addUser = (role = "user") => {
    return async (req, res) => {
        try {
            const { name, email, password } = req.body || {};

            // Validate name
            if (
                typeof name !== "string" ||
                name.trim().length < 2 ||
                name.trim().length > 100
            ) {
                return res.status(400).json({
                    error: "Name must be between 2 and 100 characters"
                });
            }

            // Validate email
            if (
                typeof email !== "string" ||
                !email.trim() ||
                email.trim().length > 254 ||
                !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
            ) {
                return res.status(400).json({
                    error: "Please provide a valid email address"
                });
            }

            // Validate password
            if (
                typeof password !== "string" ||
                password.length < 8 ||
                Buffer.byteLength(password, "utf8") > 72
            ) {
                return res.status(400).json({
                    error: "Password must have a JavaScript string length of at least 8 and be no more than 72 bytes when encoded as UTF-8"
                });
            }

            // Validate the role configured for this route
            if (!["user", "admin"].includes(role)) {
                return res.status(500).json({
                    error: "Invalid user role configuration"
                });
            }

            const cleanName = name.trim();
            const cleanEmail = email.trim().toLowerCase();

            const existingUser = await User.findOne({
                email: cleanEmail
            }).select("_id");

            if (existingUser) {
                return res.status(409).json({
                    error: "Email already exists"
                });
            }

            const myUser = await User.create({
                name: cleanName,
                email: cleanEmail,
                password,
                role
            });

            const userData = myUser.toObject();

            // Keep credentials and internal workflow fields out of public API responses.
            delete userData.password;
            delete userData.resetPasswordTokenHash;
            delete userData.resetPasswordExpires;
            delete userData.mergedGuestCartKeys;

            return res.status(201).json({
                message: "User created successfully",
                data: userData
            });

        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).json({
                    error: "Email already exists"
                });
            }

            if (err.name === "ValidationError") {
                return res.status(400).json({
                    error: "Invalid user data"
                });
            }

            logger.logError("users.create.failed", err, {
                requestId: req.id,
                method: req.method
            });

            return res.status(500).json({
                error: "Failed to create user"
            });
        }
    };
};


// Update only the authenticated user's public profile fields.
exports.updateMyProfile = async (req, res, next) => {
    try {
        const { name, email, phone, address } = req.body || {};
        if (name !== undefined) {
            if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
                return res.status(400).json({ error: "Name must be between 2 and 100 characters" });
            }
            req.user.name = name.trim();
        }
        if (email !== undefined) {
            if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                return res.status(400).json({ error: "Please provide a valid email address" });
            }
            req.user.email = email.trim().toLowerCase();
        }
        if (phone !== undefined) {
            if (typeof phone !== "string" || phone.trim().length > 24 || (phone.trim() && !/^[+()0-9 .-]{7,24}$/.test(phone.trim()))) {
                return res.status(400).json({ error: "Please provide a valid phone number" });
            }
            req.user.phone = phone.trim();
        }
        if (address !== undefined) {
            if (typeof address !== "string" || address.trim().length > 300) {
                return res.status(400).json({ error: "Address cannot exceed 300 characters" });
            }
            req.user.address = address.trim();
        }
        if (name === undefined && email === undefined && phone === undefined && address === undefined) {
            return res.status(400).json({ error: "Provide profile details to update" });
        }
        await req.user.save();
        const userData = req.user.toObject();
        delete userData.password;
        return res.status(200).json({ message: "Profile updated successfully", data: userData });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ error: "Email already exists" });
        if (err.name === "ValidationError") return res.status(400).json({ error: "Invalid profile details" });
        return next(err);
    }
};

// Verify the existing password and revoke all earlier tokens after changing it.
exports.changeMyPassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (typeof currentPassword !== "string" || !currentPassword || typeof newPassword !== "string") {
            return res.status(400).json({ error: "Current password and new password are required" });
        }
        if (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
            return res.status(400).json({ error: "New password must be at least 8 characters and no more than 72 UTF-8 bytes" });
        }
        const matches = await req.user.isCorrectPassword(currentPassword);
        if (!matches) return res.status(400).json({ error: "Current password is incorrect" });
        req.user.password = newPassword;
        req.user.tokenVersion = Number(req.user.tokenVersion || 0) + 1;
        await req.user.save();
        return res.status(200).json({ message: "Password changed. Please sign in again." });
    } catch (err) {
        if (err.name === "ValidationError") return res.status(400).json({ error: "New password does not meet the requirements" });
        return next(err);
    }
};


// Toggle user active status (Admin only)
exports.toggleUserStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const targetUser = await User.findById(id);
        if (!targetUser) {
            return res.status(404).json({ error: "User not found" });
        }

        // Prevent self-lockout
        if (targetUser._id.toString() === req.user.id.toString()) {
            return res.status(400).json({ error: "You cannot deactivate your own account" });
        }

        // Prevent deactivating the last active administrator
        if (targetUser.role === "admin" && targetUser.isActive) {
            const adminCount = await User.countDocuments({ role: "admin", isActive: true });
            if (adminCount <= 1) {
                return res.status(400).json({ error: "Cannot deactivate the only active administrator" });
            }
        }

        targetUser.isActive = !targetUser.isActive;
        if (!targetUser.isActive) {
            targetUser.tokenVersion = Number(targetUser.tokenVersion || 0) + 1;
        }
        await targetUser.save();

        const userData = targetUser.toObject();
        delete userData.password;
        delete userData.resetPasswordTokenHash;
        delete userData.resetPasswordExpires;
        delete userData.mergedGuestCartKeys;

        return res.status(200).json({
            message: `User ${targetUser.isActive ? "activated" : "deactivated"} successfully`,
            data: userData
        });
    } catch (err) {
        return next(err);
    }
};