const express = require("express");

const router = express.Router();

const {
    getProductBySlug,
    getProducts,
    getProductFilterOptions,
    addProduct,
    updateProduct,
    deleteProduct
} = require("../controller/product.controller");

const { uploadProductImages, validateUploadedImages } = require("../middlewares/upload.middleware");
const { authenticate } = require("../middlewares/auth.middleware");
const { authorize } = require("../middlewares/role.middleware");


// Public product endpoints

router.get("/filters", getProductFilterOptions);
router.get("/", getProducts);
router.get("/:slug", getProductBySlug);


// Admin product management

router.post(
    "/",
    authenticate,
    authorize("admin"),
    uploadProductImages,
    validateUploadedImages,
    addProduct
);

router.put(
    "/:id",
    authenticate,
    authorize("admin"),
    uploadProductImages,
    validateUploadedImages,
    updateProduct
);

router.delete(
    "/:id",
    authenticate,
    authorize("admin"),
    deleteProduct
);


module.exports = router;