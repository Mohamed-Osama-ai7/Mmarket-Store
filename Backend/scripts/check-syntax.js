const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([
    "node_modules",
    ".git",
    "uploads",
    "backups",
    "logs"
]);
const files = [];

function collectJavaScript(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                collectJavaScript(fullPath);
            }
            continue;
        }

        if (entry.isFile() && entry.name.endsWith(".js")) {
            files.push(fullPath);
        }
    }
}

collectJavaScript(root);
files.sort();

const failures = [];
for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8"
    });

    if (result.status !== 0) {
        failures.push({
            file: path.relative(root, file),
            output: (result.stderr || result.stdout || "Syntax check failed").trim()
        });
    }
}

if (failures.length) {
    console.error(`Syntax check failed for ${failures.length} of ${files.length} JavaScript files.`);
    for (const failure of failures) {
        console.error(`\n${failure.file}\n${failure.output}`);
    }
    process.exitCode = 1;
} else {
    console.log(`Syntax check passed for ${files.length} JavaScript files.`);
}
