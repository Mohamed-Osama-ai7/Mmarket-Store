const express = require("express");

const router = express.Router();

const {
    getCategories,
    getCategoryBySlug,
    addCategory,
    updateCategory,
    deleteCategory
} = require("../controller/category.controller");

const { authenticate } = require("../middlewares/auth.middleware");
const { authorize } = require("../middlewares/role.middleware");


router.get("/", getCategories);


router.get("/:slug", getCategoryBySlug);


router.post(
    "/",
    authenticate,
    authorize("admin"),
    addCategory
);


router.put(
    "/:id",
    authenticate,
    authorize("admin"),
    updateCategory
);


router.delete(
    "/:id",
    authenticate,
    authorize("admin"),
    deleteCategory
);


module.exports = router;