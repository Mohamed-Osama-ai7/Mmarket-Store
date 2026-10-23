const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { authorize } = require("../middlewares/role.middleware");
const controller = require("../controller/siteContent.controller");

const router = express.Router();
const requireAdmin = [authenticate, authorize("admin")];

router.get("/public", controller.getPublicSiteContent);
router.get("/public/pages/:slug", controller.getPublicPage);
router.get("/admin", ...requireAdmin, controller.getAdminSiteContent);
router.put("/admin", ...requireAdmin, controller.updateAdminSiteContent);
router.post("/admin/pages", ...requireAdmin, controller.createAdminPage);
router.put("/admin/pages/:id", ...requireAdmin, controller.updateAdminPage);
router.delete("/admin/pages/:id", ...requireAdmin, controller.archiveAdminPage);

module.exports = router;
