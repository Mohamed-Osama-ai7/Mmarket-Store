const express = require("express");

const router = express.Router();

const {
    addUser,
    getMyProfile,
    updateMyProfile,
    changeMyPassword,
    getUsers,
    getUserByEmail,
    toggleUserStatus
} = require("../controller/user.controller");

const {
    authenticate
} = require("../middlewares/auth.middleware");

const {
    authorize
} = require("../middlewares/role.middleware");
const { createRateLimit } = require("../middlewares/rateLimit.middleware");

const registrationLimiter = createRateLimit({
    windowMs: 60 * 60 * 1000,
    maxRequests: 8,
    message: "Too many registration attempts. Please try again later."
});


// Register a new regular user
router.post("/", registrationLimiter, addUser("user"));


// Get the current authenticated user's profile.
router.get(
    "/me",
    authenticate,
    getMyProfile
);

router.patch(
    "/me",
    authenticate,
    updateMyProfile
);

router.post(
    "/me/password",
    authenticate,
    changeMyPassword
);


// Get all users (Admin only)
router.get(
    "/",
    authenticate,
    authorize("admin"),
    getUsers
);


// Get a user by email (Admin only)
router.get(
    "/email/:email",
    authenticate,
    authorize("admin"),
    getUserByEmail
);


// Create a new admin (Admin only)
router.post(
    "/addAdmin",
    authenticate,
    authorize("admin"),
    addUser("admin")
);



// Toggle user active status (Admin only)
router.patch(
    "/:id/status",
    authenticate,
    authorize("admin"),
    toggleUserStatus
);

module.exports = router;