const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { createGunzip } = require("node:zlib");
const mongoose = require("mongoose");
const Product = require("../model/product.model");
const logger = require("../utilities/logger");

const BACKUP_TOOL_VERSION_PATTERN =
    /^\s*mongodump version:\s*([0-9][A-Za-z0-9.+-]*)\s*$/m;
const MAX_VERSION_OUTPUT_BYTES = 4096;
const IMAGE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BACKUP_ID_PATTERN = /^backup-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$/;

class BackupError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "BackupError";
        this.code = code;
    }
}

const backupError = (code, message) => new BackupError(code, message);

const lstatIfExists = async filePath => {
    try {
        return await fs.lstat(filePath);
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw backupError(
            "BACKUP_STORAGE_UNAVAILABLE",
            "Backup storage could not be accessed."
        );
    }
};

const parseBackupTarget = targetUri => {
    if (typeof targetUri !== "string" || !targetUri.trim()) {
        throw backupError(
            "BACKUP_TARGET_REQUIRED",
            "An explicit MongoDB backup target is required."
        );
    }

    let parsed;
    try {
        parsed = new URL(targetUri);
    } catch {
        throw backupError(
            "BACKUP_TARGET_INVALID",
            "The MongoDB backup target is invalid."
        );
    }

    if (
        !["mongodb:", "mongodb+srv:"].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.hash ||
        parsed.search.length > 4096
    ) {
        throw backupError(
            "BACKUP_TARGET_INVALID",
            "The MongoDB backup target is invalid."
        );
    }

    let databaseName;
    try {
        databaseName = decodeURIComponent(parsed.pathname.slice(1));
    } catch {
        throw backupError(
            "BACKUP_TARGET_INVALID",
            "The MongoDB backup target is invalid."
        );
    }

    if (
        !databaseName ||
        parsed.pathname.slice(1).includes("/") ||
        !/^[A-Za-z0-9_-]+$/.test(databaseName)
    ) {
        throw backupError(
            "BACKUP_TARGET_DATABASE_REQUIRED",
            "The MongoDB backup target must name one database."
        );
    }

    return { databaseName };
};

const validateImageFilename = filename => {
    if (
        typeof filename !== "string" ||
        !filename ||
        filename === "." ||
        filename === ".." ||
        path.isAbsolute(filename) ||
        path.basename(filename) !== filename ||
        /[\\/:\0]/.test(filename) ||
        !IMAGE_FILENAME_PATTERN.test(filename) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)
    ) {
        throw backupError(
            "BACKUP_IMAGE_PATH_INVALID",
            "A referenced product image has an unsafe filename."
        );
    }

    return filename;
};

const isWithin = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative));
};

const pathsOverlap = (first, second) =>
    isWithin(first, second) || isWithin(second, first);

const defaultBackupRoot = () => process.platform === "win32"
    ? path.join(
        os.homedir(),
        "AppData",
        "Local",
        "MEAN-L2",
        "Backups"
    )
    : path.join(os.homedir(), ".local", "share", "mean-l2", "backups");

const defaultMongodumpPath = () => process.platform === "win32"
    ? path.join(
        os.homedir(),
        "AppData",
        "Local",
        "MongoDB",
        "DatabaseTools",
        "100.19.1",
        "bin",
        "mongodump.exe"
    )
    : "";

const validateBackupRoot = ({
    backupRoot,
    projectRoot,
    uploadsDirectory,
    publicDirectories
}) => {
    const resolvedRoot = path.resolve(backupRoot);
    const forbiddenDirectories = [
        projectRoot,
        uploadsDirectory,
        ...publicDirectories
    ].map(directory => path.resolve(directory));

    if (
        forbiddenDirectories.some(directory =>
            pathsOverlap(resolvedRoot, directory))
    ) {
        throw backupError(
            "BACKUP_ROOT_UNSAFE",
            "The backup root must be separate from project and public data."
        );
    }

    return resolvedRoot;
};

const runExternalProcess = (
    spawnProcess,
    executable,
    args,
    { captureStdout = false } = {}
) => new Promise((resolve, reject) => {
    let child;
    let stdout = "";
    let settled = false;

    const fail = () => {
        if (!settled) {
            settled = true;
            reject(backupError(
                "BACKUP_TOOL_FAILED",
                "The database backup tool failed."
            ));
        }
    };

    try {
        child = spawnProcess(executable, args, {
            shell: false,
            windowsHide: true,
            stdio: captureStdout
                ? ["ignore", "pipe", "ignore"]
                : "ignore"
        });
    } catch {
        fail();
        return;
    }

    if (captureStdout && child.stdout) {
        child.stdout.on("data", chunk => {
            if (Buffer.byteLength(stdout) + chunk.length > MAX_VERSION_OUTPUT_BYTES) {
                fail();
                child.kill();
                return;
            }
            stdout += chunk.toString("utf8");
        });
    }

    child.once("error", fail);
    child.once("close", code => {
        if (settled) {
            return;
        }
        settled = true;
        if (code !== 0) {
            reject(backupError(
                "BACKUP_TOOL_FAILED",
                "The database backup tool failed."
            ));
            return;
        }
        resolve(stdout);
    });
});

const sha256File = async filePath => {
    const hash = createHash("sha256");
    let sizeBytes = 0;
    for await (const chunk of createReadStream(filePath)) {
        sizeBytes += chunk.length;
        hash.update(chunk);
    }
    return {
        sizeBytes,
        sha256: hash.digest("hex")
    };
};

const validateGzipFile = async filePath => {
    try {
        await pipeline(
            createReadStream(filePath),
            createGunzip(),
            new Writable({
                write(chunk, encoding, callback) {
                    callback();
                }
            })
        );
    } catch {
        throw backupError(
            "BACKUP_ARCHIVE_INVALID",
            "The database backup archive is incomplete or invalid."
        );
    }
};

const resolveManifestFile = async (artifactDirectory, relativePath) => {
    if (
        typeof relativePath !== "string" ||
        path.isAbsolute(relativePath) ||
        relativePath.includes("\\") ||
        relativePath.split("/").some(part =>
            !part || part === "." || part === "..")
    ) {
        throw backupError(
            "BACKUP_ARTIFACT_INVALID",
            "The backup artifact failed validation."
        );
    }

    const absolutePath = path.resolve(artifactDirectory, ...relativePath.split("/"));
    if (!isWithin(path.resolve(artifactDirectory), absolutePath)) {
        throw backupError(
            "BACKUP_ARTIFACT_INVALID",
            "The backup artifact failed validation."
        );
    }

    const stat = await fs.lstat(absolutePath).catch(() => null);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
        throw backupError(
            "BACKUP_ARTIFACT_INVALID",
            "The backup artifact failed validation."
        );
    }

    return absolutePath;
};

const verifyBackupArtifact = async artifactDirectory => {
    try {
        const manifestPath = path.join(artifactDirectory, "manifest.json");
        const manifestStat = await fs.lstat(manifestPath);
        if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
            throw new Error("Invalid manifest file");
        }

        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        if (
            !manifest ||
            !BACKUP_ID_PATTERN.test(manifest.backupId) ||
            Number.isNaN(Date.parse(manifest.createdAt)) ||
            !manifest.createdAt.endsWith("Z") ||
            manifest.tool?.name !== "mongodump" ||
            typeof manifest.tool.version !== "string" ||
            manifest.format !== "mongodb-archive-gzip" ||
            !Array.isArray(manifest.files) ||
            !manifest.files.some(file =>
                file.path === "database.archive.gz")
        ) {
            throw new Error("Invalid manifest metadata");
        }

        const seenPaths = new Set();
        for (const file of manifest.files) {
            if (
                !file ||
                typeof file.sha256 !== "string" ||
                !/^[a-f0-9]{64}$/.test(file.sha256) ||
                !Number.isSafeInteger(file.sizeBytes) ||
                file.sizeBytes < 0 ||
                seenPaths.has(file.path)
            ) {
                throw new Error("Invalid manifest file entry");
            }
            if (
                file.path !== "database.archive.gz" &&
                !file.path.startsWith("images/")
            ) {
                throw new Error("Unexpected manifest path");
            }
            if (file.path.startsWith("images/")) {
                validateImageFilename(file.path.slice("images/".length));
            }

            seenPaths.add(file.path);
            const absolutePath = await resolveManifestFile(
                artifactDirectory,
                file.path
            );
            const actual = await sha256File(absolutePath);
            if (
                actual.sha256 !== file.sha256 ||
                actual.sizeBytes !== file.sizeBytes
            ) {
                throw new Error("Checksum mismatch");
            }
        }
    } catch (error) {
        if (error instanceof BackupError &&
            error.code === "BACKUP_ARTIFACT_INVALID") {
            throw error;
        }
        throw backupError(
            "BACKUP_ARTIFACT_INVALID",
            "The backup artifact failed validation."
        );
    }

    return true;
};

const createBackupService = ({
    backupRoot = defaultBackupRoot(),
    projectRoot = process.cwd(),
    uploadsDirectory = path.resolve(process.cwd(), "uploads"),
    publicDirectories = [
        path.resolve(process.cwd(), "public"),
        path.resolve(process.cwd(), "static")
    ],
    mongodumpPath = defaultMongodumpPath(),
    spawnProcess = spawn,
    createConnection = (uri, options) =>
        mongoose.createConnection(uri, options),
    log = logger.logSafely
} = {}) => {
    const resolvedBackupRoot = validateBackupRoot({
        backupRoot,
        projectRoot,
        uploadsDirectory,
        publicDirectories
    });
    const resolvedUploadsDirectory = path.resolve(uploadsDirectory);
    let backupInProgress = false;

    return async ({ targetUri } = {}) => {
        if (backupInProgress) {
            throw backupError(
                "BACKUP_IN_PROGRESS",
                "A database backup is already in progress."
            );
        }

        backupInProgress = true;
        const backupId =
            `backup-${new Date().toISOString().replace(/[-:]/g, "")
                .replace(/\.\d{3}Z$/, "Z")}-${randomUUID().replace(/-/g, "")}`;
        const temporaryDirectory =
            path.join(resolvedBackupRoot, `.tmp-${backupId}`);
        let connection;
        let published = false;
        let operationError;

        try {
            const { databaseName } = parseBackupTarget(targetUri);
            if (
                typeof mongodumpPath !== "string" ||
                !path.isAbsolute(mongodumpPath) ||
                !/^mongodump(?:\.exe)?$/i.test(path.basename(mongodumpPath))
            ) {
                throw backupError(
                    "BACKUP_TOOL_UNAVAILABLE",
                    "The configured database backup tool is unavailable."
                );
            }

            let toolStat;
            try {
                toolStat = await fs.stat(mongodumpPath);
            } catch (error) {
                if (error.code !== "ENOENT") {
                    throw backupError(
                        "BACKUP_TOOL_UNAVAILABLE",
                        "The configured database backup tool is unavailable."
                    );
                }
                toolStat = null;
            }
            if (!toolStat?.isFile()) {
                throw backupError(
                    "BACKUP_TOOL_UNAVAILABLE",
                    "The configured database backup tool is unavailable."
                );
            }

            const versionOutput = await runExternalProcess(
                spawnProcess,
                mongodumpPath,
                ["--version"],
                { captureStdout: true }
            );
            const version = BACKUP_TOOL_VERSION_PATTERN.exec(versionOutput)?.[1];
            if (!version) {
                throw backupError(
                    "BACKUP_TOOL_VERSION_INVALID",
                    "The configured database backup tool has an invalid version."
                );
            }

            connection = createConnection(targetUri, {
                serverSelectionTimeoutMS: 10000
            });
            await connection.asPromise();
            if (
                connection.name !== databaseName ||
                !connection.db ||
                connection.db.databaseName !== databaseName
            ) {
                throw backupError(
                    "BACKUP_TARGET_MISMATCH",
                    "The connected database does not match the requested backup target."
                );
            }

            await fs.mkdir(resolvedBackupRoot, {
                recursive: true,
                mode: 0o700
            });
            const rootStat = await fs.lstat(resolvedBackupRoot);
            if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
                throw backupError(
                    "BACKUP_ROOT_UNSAFE",
                    "The backup root must be a private directory."
                );
            }

            await fs.mkdir(temporaryDirectory, {
                recursive: false,
                mode: 0o700
            });
            if (process.platform !== "win32") {
                await fs.chmod(temporaryDirectory, 0o700);
            }
            const imagesDirectory = path.join(temporaryDirectory, "images");
            await fs.mkdir(imagesDirectory, {
                recursive: false,
                mode: 0o700
            });

            const TargetProduct = connection.model(
                Product.modelName,
                Product.schema
            );
            const imageNames = new Set();
            const productCursor = TargetProduct.find({})
                .select("imgURL -_id")
                .lean()
                .cursor();

            try {
                for await (const product of productCursor) {
                    imageNames.add(validateImageFilename(product.imgURL));
                }
            } finally {
                await productCursor.close();
            }

            if (imageNames.size > 0) {
                const uploadsStat =
                    await lstatIfExists(resolvedUploadsDirectory);
                if (
                    !uploadsStat ||
                    !uploadsStat.isDirectory() ||
                    uploadsStat.isSymbolicLink()
                ) {
                    throw backupError(
                        "BACKUP_IMAGE_MISSING",
                        "The product image directory is missing or unsafe."
                    );
                }
            }

            const copiedImagePaths = [];
            for (const imageName of imageNames) {
                const sourcePath = path.join(
                    resolvedUploadsDirectory,
                    imageName
                );
                const sourceStat = await lstatIfExists(sourcePath);
                if (
                    !sourceStat ||
                    !sourceStat.isFile() ||
                    sourceStat.isSymbolicLink()
                ) {
                    throw backupError(
                        "BACKUP_IMAGE_MISSING",
                        "A referenced product image is missing or unsafe."
                    );
                }

                const destinationPath = path.join(imagesDirectory, imageName);
                await fs.copyFile(
                    sourcePath,
                    destinationPath
                );
                copiedImagePaths.push({
                    path: `images/${imageName}`,
                    absolutePath: destinationPath
                });
            }

            const archivePath = path.join(
                temporaryDirectory,
                "database.archive.gz"
            );
            const toolConfigPath = path.join(
                temporaryDirectory,
                "mongodump-config.json"
            );
            await fs.writeFile(
                toolConfigPath,
                `${JSON.stringify({ uri: targetUri })}\n`,
                { flag: "wx", mode: 0o600 }
            );
            await runExternalProcess(
                spawnProcess,
                mongodumpPath,
                [
                    `--config=${toolConfigPath}`,
                    `--db=${databaseName}`,
                    `--archive=${archivePath}`,
                    "--gzip"
                ]
            );
            await fs.unlink(toolConfigPath);

            const archiveStat = await lstatIfExists(archivePath);
            if (
                !archiveStat ||
                !archiveStat.isFile() ||
                archiveStat.isSymbolicLink() ||
                archiveStat.size === 0
            ) {
                throw backupError(
                    "BACKUP_ARCHIVE_INVALID",
                    "The database backup archive is incomplete."
                );
            }
            await validateGzipFile(archivePath);

            const files = [];
            for (const file of [
                { path: "database.archive.gz", absolutePath: archivePath },
                ...copiedImagePaths
            ]) {
                files.push({
                    path: file.path,
                    ...(await sha256File(file.absolutePath))
                });
            }

            const manifest = {
                backupId,
                createdAt: new Date().toISOString(),
                tool: {
                    name: "mongodump",
                    version
                },
                format: "mongodb-archive-gzip",
                files
            };
            await fs.writeFile(
                path.join(temporaryDirectory, "manifest.json"),
                `${JSON.stringify(manifest, null, 2)}\n`,
                { flag: "wx", mode: 0o600 }
            );
            await verifyBackupArtifact(temporaryDirectory);

            const artifactDirectory = path.join(
                resolvedBackupRoot,
                backupId
            );
            await fs.rename(temporaryDirectory, artifactDirectory);
            published = true;

            log("info", "Database backup completed", {
                event: "database.backup.completed",
                backupId
            });

            return {
                backupId,
                createdAt: manifest.createdAt,
                artifactDirectory,
                fileCount: files.length
            };
        } catch (error) {
            operationError = error;
            const safeError = error instanceof BackupError
                ? error
                : backupError(
                    "BACKUP_FAILED",
                    "Database backup failed; no complete artifact was published."
                );
            log("error", "Database backup failed", {
                event: "database.backup.failed",
                backupId,
                code: safeError.code
            });
            throw safeError;
        } finally {
            try {
                if (connection) {
                    await connection.close();
                }
            } catch {
                log("error", "Database backup connection cleanup failed", {
                    event: "database.backup.connection_cleanup.failed",
                    backupId
                });
                if (!operationError && published) {
                    log("warn", "Database backup completed with cleanup error", {
                        event: "database.backup.cleanup.warning",
                        backupId
                    });
                }
            } finally {
                try {
                    if (!published) {
                        const temporaryStat =
                            await lstatIfExists(temporaryDirectory);
                        if (temporaryStat) {
                            if (
                                !temporaryStat.isDirectory() ||
                                temporaryStat.isSymbolicLink() ||
                                path.dirname(temporaryDirectory) !==
                                    resolvedBackupRoot ||
                                !path.basename(temporaryDirectory)
                                    .startsWith(".tmp-backup-")
                            ) {
                                throw backupError(
                                    "BACKUP_CLEANUP_UNSAFE",
                                    "The temporary backup directory could not be safely removed."
                                );
                            }
                            await fs.rm(temporaryDirectory, {
                                recursive: true,
                                force: false
                            });
                        }
                    }
                } catch {
                    log("error", "Database backup temporary cleanup failed", {
                        event: "database.backup.temporary_cleanup.failed",
                        backupId
                    });
                    if (!operationError) {
                        throw backupError(
                            "BACKUP_CLEANUP_FAILED",
                            "The temporary backup data could not be safely removed."
                        );
                    }
                } finally {
                    backupInProgress = false;
                }
            }
        }
    };
};

const createBackup = createBackupService();

module.exports = {
    BackupError,
    createBackup,
    createBackupService,
    parseBackupTarget,
    validateImageFilename,
    verifyBackupArtifact
};
