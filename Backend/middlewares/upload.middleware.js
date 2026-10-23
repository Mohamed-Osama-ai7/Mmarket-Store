const multer = require("multer");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const AppError = require("../utilities/appError");
const validateUploadedImages = async (req, res, next) => {
    const files = req.files ? Object.values(req.files).flat() : (req.file ? [req.file] : []);
    if (!files.length) return next();
    try {
        for (const file of files) {
            const handle = await fs.promises.open(file.path, "r");
            let signature;
            try { const buffer = Buffer.alloc(8); const result = await handle.read(buffer, 0, 8, 0); signature = buffer.subarray(0, result.bytesRead); }
            finally { await handle.close(); }
            const png = signature.length === 8 && signature.equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
            const jpeg = signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
            const extension = path.extname(file.originalname).toLowerCase();
            if (!(png && extension === ".png") && !(jpeg && [".jpg", ".jpeg"].includes(extension))) {
                await Promise.all(files.map(item => fs.promises.unlink(item.path).catch(() => undefined)));
                return res.status(400).json({ error: "The uploaded file content does not match a supported PNG or JPEG image." });
            }
        }
        return next();
    } catch (error) {
        await Promise.all(files.map(item => fs.promises.unlink(item.path).catch(() => undefined)));
        return next(error);
    }
};

const uploadDirectory = path.resolve(__dirname, "..", "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedFiles = [
    ".png",
    ".jpg",
    ".jpeg"
];

const allowedMimeTypes = [
    "image/png",
    "image/jpeg"
];

const fileFilter = (req, file, cb) => {
    const ext = path
        .extname(file.originalname)
        .toLowerCase();

    const mimeType = file.mimetype;

    if (
        !allowedFiles.includes(ext) ||
        !allowedMimeTypes.includes(mimeType)
    ) {
        return cb(
            new AppError("Only PNG and JPEG images are allowed", 400),
            false
        );
    }

    cb(null, true);
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDirectory);
    },

    filename: (req, file, cb) => {
        const ext = path
            .extname(file.originalname)
            .toLowerCase();

        const uniqueName = `${randomUUID()}${ext}`;

        cb(null, uniqueName);
    }
});

const MB = 1024 * 1024;

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 2 * MB,
        files: 5
    }
});


const uploadProductImages = (req, res, next) => {
    const parseFiles = upload.fields([
        { name: "img", maxCount: 1 },
        { name: "images", maxCount: 5 }
    ]);
    parseFiles(req, res, async error => {
        if (error) {
            const files = req.files ? Object.values(req.files).flat() : (req.file ? [req.file] : []);
            await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => undefined)));
            return next(error);
        }
        const files = req.files ? Object.values(req.files).flat() : (req.file ? [req.file] : []);
        if (files.length > 5) {
            await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => undefined)));
            return res.status(400).json({ error: "A product can have no more than five images." });
        }
        if (files.length) {
            // Controllers set this flag once the database record safely references the uploads.
            // If validation or persistence fails, remove the temporary files after the response.
            res.once("finish", () => {
                if (!req.productImagesCommitted) {
                    Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => undefined))).catch(() => undefined);
                }
            });
        }
        return next();
    });
};

module.exports = {
    upload,
    uploadProductImages,
    validateUploadedImages
};