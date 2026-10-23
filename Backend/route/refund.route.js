const express = require("express");

const router = express.Router();

const {
    createRefundRequest,
    getMyRefunds,
    getMyRefundById,
    getAllRefunds,
    reviewRefund,
    startRefundProcessing,
    completeRefund,
    failRefund
} = require("../controller/refund.controller");

const {
    authenticate
} = require("../middlewares/auth.middleware");

const {
    authorize
} = require("../middlewares/role.middleware");


// All routes require authentication.
router.use(authenticate);


// User: create a refund request.
router.post(
    "/",
    createRefundRequest
);


// User: retrieve their refund history.
router.get(
    "/",
    getMyRefunds
);


// Admin: retrieve all refund requests.
router.get(
    "/admin",
    authorize("admin"),
    getAllRefunds
);


// Admin: approve or reject a request.
router.patch(
    "/:id/review",
    authorize("admin"),
    reviewRefund
);


// Admin: start processing an approved refund.
router.patch(
    "/:id/process",
    authorize("admin"),
    startRefundProcessing
);


// Admin: record a confirmed refund.
router.patch(
    "/:id/complete",
    authorize("admin"),
    completeRefund
);


// Admin: record a failed refund attempt.
router.patch(
    "/:id/fail",
    authorize("admin"),
    failRefund
);


// User: retrieve a specific refund.
router.get(
    "/:id",
    getMyRefundById
);


module.exports = router;