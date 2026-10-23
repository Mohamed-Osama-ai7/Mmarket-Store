const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, afterEach, before, test } = require("node:test");
const { gzipSync } = require("node:zlib");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const Product = require("../model/product.model");
const {
    createBackupService,
    parseBackupTarget,
    verifyBackupArtifact
} = require("../service/backup.service");

const LOOPBACK = "127.0.0.1";
const REPLICA_SET_NAME = "mean-l2-backup-test-rs";
const DATABASE_PREFIX = "mean_l2_backup_it_";
const RUN_ID = `backup-test-${Date.now()}-${process.pid}`;

let replicaSet;
let connection;
let databaseName;
let mongoUri;
let sandbox;
let uploadsDirectory;
let backupRoot;
let ProductInTestDatabase;

const assertTestDatabaseIsActive = async () => {
    assert.match(databaseName, /^mean_l2_backup_it_[a-f0-9]{16}$/);
    assert.ok(replicaSet, "test-managed Replica Set must be initialized");
    assert.ok(connection, "test connection must be initialized");

    const info = replicaSet.servers[0].instanceInfo;
    assert.ok(info, "test-managed MongoDB instance must be running");
    assert.equal(info.ip, LOOPBACK);
    assert.equal(connection.readyState, 1);
    assert.equal(connection.host, LOOPBACK);
    assert.equal(connection.port, info.port);
    assert.equal(connection.name, databaseName);
    assert.equal(connection.db.databaseName, databaseName);

    const topology = connection.client.topology;
    assert.equal(topology.description.setName, REPLICA_SET_NAME);
    assert.deepEqual(
        [...topology.description.servers.keys()],
        [`${LOOPBACK}:${info.port}`]
    );
    const hello = await connection.db.admin().command({ hello: 1 });
    assert.equal(hello.setName, REPLICA_SET_NAME);
    assert.equal(hello.me, `${LOOPBACK}:${info.port}`);

    const parsedUri = new URL(mongoUri);
    assert.equal(parsedUri.protocol, "mongodb:");
    assert.equal(parsedUri.hostname, LOOPBACK);
    assert.equal(
        decodeURIComponent(parsedUri.pathname.slice(1)),
        databaseName
    );
    assert.equal(
        Number(parsedUri.port),
        info.port
    );
    assert.equal(
        parsedUri.searchParams.get("replicaSet"),
        REPLICA_SET_NAME
    );
};

const createHarness = ({
    spawnProcess,
    mongodumpPath,
    log = () => {}
} = {}) => createBackupService({
    backupRoot,
    projectRoot: path.resolve(__dirname, ".."),
    uploadsDirectory,
    publicDirectories: [
        path.resolve(__dirname, "..", "public"),
        path.resolve(__dirname, "..", "static")
    ],
    mongodumpPath: mongodumpPath ||
        path.join(sandbox, "mongodump.exe"),
    spawnProcess: spawnProcess || createSuccessfulSpawn(),
    log
});

const createSuccessfulSpawn = ({ failDump = false, waitForVersion } = {}) => {
    const calls = [];
    const spawnProcess = (executable, args, options) => {
        calls.push({ executable, args, options });
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.kill = () => {};
        process.nextTick(async () => {
            if (args[0] === "--version") {
                if (waitForVersion) {
                    await waitForVersion();
                }
                child.stdout.once("end", () => child.emit("close", 0));
                child.stdout.end("mongodump version: 100.19.1\n");
                return;
            }

            if (failDump) {
                child.emit("close", 1);
                return;
            }
            const configArgument = args.find(argument =>
                argument.startsWith("--config="));
            assert.ok(configArgument);
            const configContents = await fs.readFile(
                configArgument.slice("--config=".length),
                "utf8"
            );
            calls[calls.length - 1].configContents = configContents;
            const archiveArgument = args.find(argument =>
                argument.startsWith("--archive="));
            assert.ok(archiveArgument);
            await fs.writeFile(
                archiveArgument.slice("--archive=".length),
                gzipSync("mocked MongoDB archive")
            );
            child.emit("close", 0);
        });
        return child;
    };
    spawnProcess.calls = calls;
    return spawnProcess;
};

const createProduct = async ({ name, imgURL, isActive }) => {
    await assertTestDatabaseIsActive();
    return ProductInTestDatabase.create({
        name: `${RUN_ID} ${name} ${randomBytes(4).toString("hex")}`,
        price: 10,
        desc: "Backup integration fixture",
        stock: 1,
        imgURL,
        category: new mongoose.Types.ObjectId(),
        isActive
    });
};

const createImage = async (filename, contents = `image:${filename}`) => {
    await fs.writeFile(path.join(uploadsDirectory, filename), contents);
};

const runBackup = async (service, target = mongoUri) => {
    await assertTestDatabaseIsActive();
    return service({ targetUri: target });
};

before(async () => {
    sandbox = await fs.mkdtemp(
        path.join(os.tmpdir(), "mean-l2-backup-test-")
    );
    uploadsDirectory = path.join(sandbox, "uploads");
    backupRoot = path.join(sandbox, "private-backups");
    await fs.mkdir(uploadsDirectory);
    await fs.writeFile(path.join(sandbox, "mongodump.exe"), "mock executable");

    databaseName =
        `${DATABASE_PREFIX}${randomBytes(8).toString("hex")}`;
    replicaSet = await MongoMemoryReplSet.create({
        binary: { version: "8.2.6" },
        replSet: {
            count: 1,
            ip: LOOPBACK,
            name: REPLICA_SET_NAME,
            storageEngine: "wiredTiger"
        },
        instanceOpts: [{ ip: LOOPBACK }]
    });

    mongoUri = replicaSet.getUri(databaseName);
    const parsedUri = new URL(mongoUri);
    const instanceInfo = replicaSet.servers[0].instanceInfo;
    assert.ok(instanceInfo, "test-managed MongoDB instance must be running");
    assert.equal(instanceInfo.ip, LOOPBACK);
    assert.equal(parsedUri.protocol, "mongodb:");
    assert.equal(parsedUri.hostname, LOOPBACK);
    assert.equal(Number(parsedUri.port), instanceInfo.port);
    assert.equal(
        decodeURIComponent(parsedUri.pathname.slice(1)),
        databaseName
    );
    assert.equal(
        parsedUri.searchParams.get("replicaSet"),
        REPLICA_SET_NAME
    );

    connection = mongoose.createConnection(mongoUri, {
        serverSelectionTimeoutMS: 5000
    });
    await connection.asPromise();
    await assertTestDatabaseIsActive();
    ProductInTestDatabase = connection.model(
        Product.modelName,
        Product.schema
    );
});

afterEach(async () => {
    if (connection && connection.readyState === 1) {
        await assertTestDatabaseIsActive();
        await ProductInTestDatabase.deleteMany({});
    }

    if (backupRoot && path.dirname(backupRoot) === sandbox) {
        const rootStat = await fs.lstat(backupRoot).catch(() => null);
        if (rootStat) {
            assert.ok(rootStat.isDirectory());
            assert.equal(rootStat.isSymbolicLink(), false);
            await fs.rm(backupRoot, { recursive: true });
        }
    }
    if (uploadsDirectory && path.dirname(uploadsDirectory) === sandbox) {
        const uploadStat = await fs.lstat(uploadsDirectory).catch(() => null);
        if (uploadStat) {
            assert.ok(uploadStat.isDirectory());
            assert.equal(uploadStat.isSymbolicLink(), false);
            await fs.rm(uploadsDirectory, { recursive: true });
        }
        await fs.mkdir(uploadsDirectory);
    }
});

after(async () => {
    try {
        if (connection) {
            await connection.close();
        }
    } finally {
        try {
            if (replicaSet) {
                await replicaSet.stop();
            }
        } finally {
            if (
                sandbox &&
                path.dirname(sandbox) === os.tmpdir() &&
                /^mean-l2-backup-test-/.test(path.basename(sandbox))
            ) {
                await fs.rm(sandbox, {
                    recursive: true,
                    force: true
                });
            }
        }
    }
});

test("requires one explicit MongoDB target with a database name", () => {
    assert.throws(
        () => parseBackupTarget(),
        error => error.code === "BACKUP_TARGET_REQUIRED"
    );
    assert.throws(
        () => parseBackupTarget("https://example.test/db"),
        error => error.code === "BACKUP_TARGET_INVALID"
    );
    assert.throws(
        () => parseBackupTarget("mongodb://127.0.0.1:27017/"),
        error => error.code === "BACKUP_TARGET_DATABASE_REQUIRED"
    );
    assert.throws(
        () => parseBackupTarget("mongodb://127.0.0.1:27017/db/other"),
        error => error.code === "BACKUP_TARGET_DATABASE_REQUIRED"
    );
    assert.deepEqual(
        parseBackupTarget(mongoUri),
        { databaseName }
    );
});

test("rejects a backup root overlapping the project or upload directory", () => {
    assert.throws(
        () => createBackupService({
            backupRoot: path.resolve(__dirname, "..", "uploads", "backups"),
            projectRoot: path.resolve(__dirname, ".."),
            uploadsDirectory,
            publicDirectories: []
        }),
        error => error.code === "BACKUP_ROOT_UNSAFE"
    );
    assert.throws(
        () => createBackupService({
            backupRoot: uploadsDirectory,
            projectRoot: path.resolve(__dirname, ".."),
            uploadsDirectory,
            publicDirectories: []
        }),
        error => error.code === "BACKUP_ROOT_UNSAFE"
    );
});

test("backs up referenced active and inactive product images with safe arguments", async () => {
    const activeImage = "active-image_01.jpg";
    const inactiveImage = "inactive-image_02.png";
    await createProduct({
        name: "Active",
        imgURL: activeImage,
        isActive: true
    });
    await createProduct({
        name: "Inactive",
        imgURL: inactiveImage,
        isActive: false
    });
    await createImage(activeImage, "active image bytes");
    await createImage(inactiveImage, "inactive image bytes");

    const spawnProcess = createSuccessfulSpawn();
    const result = await runBackup(createHarness({ spawnProcess }));
    const manifest = JSON.parse(await fs.readFile(
        path.join(result.artifactDirectory, "manifest.json"),
        "utf8"
    ));

    assert.equal(result.fileCount, 3);
    assert.equal(manifest.backupId, result.backupId);
    assert.match(manifest.createdAt, /^\d{4}-.*Z$/);
    assert.deepEqual(manifest.tool, {
        name: "mongodump",
        version: "100.19.1"
    });
    assert.equal(manifest.format, "mongodb-archive-gzip");
    assert.deepEqual(
        manifest.files.map(file => file.path).sort(),
        [
            "database.archive.gz",
            `images/${activeImage}`,
            `images/${inactiveImage}`
        ]
    );
    for (const file of manifest.files) {
        const contents = await fs.readFile(
            path.join(result.artifactDirectory, ...file.path.split("/"))
        );
        assert.equal(file.sizeBytes, contents.length);
        assert.equal(
            file.sha256,
            createHash("sha256").update(contents).digest("hex")
        );
    }
    assert.equal(await verifyBackupArtifact(result.artifactDirectory), true);

    const dumpCall = spawnProcess.calls.find(call =>
        call.args.some(argument => argument.startsWith("--archive=")));
    assert.ok(dumpCall);
    assert.ok(Array.isArray(dumpCall.args));
    assert.equal(dumpCall.options.shell, false);
    assert.equal(dumpCall.options.windowsHide, true);
    assert.ok(dumpCall.args.some(argument =>
        argument.startsWith("--config=")));
    assert.equal(
        dumpCall.args.some(argument => argument.includes(mongoUri)),
        false
    );
    assert.deepEqual(JSON.parse(dumpCall.configContents), {
        uri: mongoUri
    });
    assert.ok(dumpCall.args.includes(`--db=${databaseName}`));
    assert.ok(dumpCall.args.includes("--gzip"));
    assert.equal(
        dumpCall.args.some(argument => argument.includes("&&")),
        false
    );
    await assert.rejects(
        fs.access(
            dumpCall.args
                .find(argument => argument.startsWith("--config="))
                .slice("--config=".length)
        ),
        error => error.code === "ENOENT"
    );
});

test("detects archive or image corruption after publishing", async () => {
    const imageName = "integrity-image.jpg";
    await createProduct({
        name: "Integrity",
        imgURL: imageName,
        isActive: true
    });
    await createImage(imageName);
    const result = await runBackup(createHarness());
    await fs.appendFile(
        path.join(result.artifactDirectory, "database.archive.gz"),
        "tampered"
    );

    await assert.rejects(
        verifyBackupArtifact(result.artifactDirectory),
        error => error.code === "BACKUP_ARTIFACT_INVALID"
    );
});

test("fails and publishes no artifact when a referenced image is missing", async () => {
    const imageName = "missing-image.jpg";
    await createProduct({
        name: "Missing image",
        imgURL: imageName,
        isActive: false
    });
    const spawnProcess = createSuccessfulSpawn();

    await assert.rejects(
        runBackup(createHarness({ spawnProcess })),
        error => error.code === "BACKUP_IMAGE_MISSING"
    );
    assert.equal(
        spawnProcess.calls.some(call =>
            call.args.some(argument =>
                argument.startsWith("--archive="))),
        false
    );
    assert.deepEqual(await fs.readdir(backupRoot), []);
});

test("rejects traversal references without accessing files outside uploads", async () => {
    await createProduct({
        name: "Traversal",
        imgURL: "../outside.jpg",
        isActive: true
    });
    const outsidePath = path.join(sandbox, "outside.jpg");
    await fs.writeFile(outsidePath, "must remain untouched");

    await assert.rejects(
        runBackup(createHarness()),
        error => error.code === "BACKUP_IMAGE_PATH_INVALID"
    );
    assert.equal(await fs.readFile(outsidePath, "utf8"), "must remain untouched");
    assert.deepEqual(await fs.readdir(backupRoot), []);
});

test("removes only the current temporary directory after a tool failure", async () => {
    const imageName = "tool-failure.jpg";
    await createProduct({
        name: "Tool failure",
        imgURL: imageName,
        isActive: true
    });
    await createImage(imageName);
    await fs.mkdir(backupRoot);
    const sentinelPath = path.join(backupRoot, "keep-me.txt");
    await fs.writeFile(sentinelPath, "do not delete");
    const spawnProcess = createSuccessfulSpawn({ failDump: true });

    await assert.rejects(
        runBackup(createHarness({ spawnProcess })),
        error => error.code === "BACKUP_TOOL_FAILED"
    );
    assert.equal(await fs.readFile(sentinelPath, "utf8"), "do not delete");
    assert.deepEqual((await fs.readdir(backupRoot)).sort(), ["keep-me.txt"]);
});

test("rejects concurrent backup attempts within one service instance", async () => {
    const imageName = "concurrency.jpg";
    await createProduct({
        name: "Concurrency",
        imgURL: imageName,
        isActive: true
    });
    await createImage(imageName);

    let releaseVersion;
    let versionStartedResolve;
    const versionStarted = new Promise(resolve => {
        versionStartedResolve = resolve;
    });
    const waitForVersion = () => {
        versionStartedResolve();
        return new Promise(resolve => {
            releaseVersion = resolve;
        });
    };
    const spawnProcess = createSuccessfulSpawn({ waitForVersion });
    const service = createHarness({ spawnProcess });
    const firstBackup = runBackup(service);
    await versionStarted;

    await assert.rejects(
        service({ targetUri: mongoUri }),
        error => error.code === "BACKUP_IN_PROGRESS"
    );
    releaseVersion();
    const result = await firstBackup;
    assert.equal(await verifyBackupArtifact(result.artifactDirectory), true);
});

test("reports unavailable tools without connecting or exposing target credentials", async () => {
    const secret = "backup-test-secret-value";
    const targetWithCredentials =
        `mongodb://user:${secret}@127.0.0.1:27017/${databaseName}`;
    let connectionAttempts = 0;
    const events = [];
    const service = createBackupService({
        backupRoot,
        projectRoot: path.resolve(__dirname, ".."),
        uploadsDirectory,
        publicDirectories: [],
        mongodumpPath: path.join(sandbox, "missing", "mongodump.exe"),
        createConnection: () => {
            connectionAttempts += 1;
            throw new Error("Must not connect");
        },
        log: (level, message, metadata) =>
            events.push({ level, message, metadata })
    });

    await assert.rejects(
        service({ targetUri: targetWithCredentials }),
        error => error.code === "BACKUP_TOOL_UNAVAILABLE" &&
            !error.message.includes(secret)
    );
    assert.equal(connectionAttempts, 0);
    assert.equal(JSON.stringify(events).includes(secret), false);
});

test("does not publish an artifact when the dump process exits unsuccessfully", async () => {
    const imageName = "failed-dump.jpg";
    await createProduct({
        name: "Failed dump",
        imgURL: imageName,
        isActive: true
    });
    await createImage(imageName);
    const events = [];
    const service = createHarness({
        spawnProcess: createSuccessfulSpawn({ failDump: true }),
        log: (level, message, metadata) =>
            events.push({ level, message, metadata })
    });

    await assert.rejects(
        runBackup(service),
        error => !error.message.includes(mongoUri) &&
            !error.message.includes("password")
    );
    assert.deepEqual(await fs.readdir(backupRoot), []);
    assert.equal(JSON.stringify(events).includes(mongoUri), false);
});
