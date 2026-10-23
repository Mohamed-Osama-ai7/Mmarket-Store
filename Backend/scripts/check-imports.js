const fs = require("node:fs");
const path = require("node:path");

const backendRoot = path.resolve(__dirname, "..");
const sourceExtensions = new Set([".js", ".cjs", ".mjs"]);
const requiredLayers = ["config", "controller", "middlewares", "model", "route", "service", "utilities"];
const failures = [];
let checked = 0;

function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === "node_modules" || ["uploads", "logs", "backups"].includes(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) result.push(...walk(fullPath));
        else if (sourceExtensions.has(path.extname(entry.name))) result.push(fullPath);
    }
    return result;
}

function candidatesFor(target) {
    return [
        target,
        `${target}.js`,
        `${target}.cjs`,
        `${target}.mjs`,
        `${target}.json`,
        path.join(target, "index.js")
    ];
}

for (const layer of requiredLayers) {
    if (!fs.statSync(path.join(backendRoot, layer), { throwIfNoEntry: false })?.isDirectory()) {
        failures.push(`Missing MVC layer directory: ${layer}/`);
    }
}

const legacyModulesDirectory = path.join(backendRoot, "modules");
if (fs.existsSync(legacyModulesDirectory)) {
    failures.push("Legacy Backend/modules/ tree remains; use the layer-first MVC folders.");
}

const requirePattern = /require\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;
for (const file of walk(backendRoot)) {
    const source = fs.readFileSync(file, "utf8");
    requirePattern.lastIndex = 0;
    for (const match of source.matchAll(requirePattern)) {
        const specifier = match[2];
        // These source strings are executed by child Node processes with cwd=Backend,
        // so their paths intentionally differ from the test file's own location.
        if (path.basename(file) === "product-caching.test.js") {
            const firstInlineScript = source.indexOf("const script = [");
            const secondInlineScript = source.indexOf("const script = `");
            const firstBoundary = firstInlineScript < 0 ? source.length : firstInlineScript;
            const secondBoundary = secondInlineScript < 0 ? source.length : secondInlineScript;
            const inlineStart = Math.min(firstBoundary, secondBoundary);
            if (match.index >= inlineStart) continue;
        }
        const target = path.resolve(path.dirname(file), specifier);
        const resolved = candidatesFor(target).some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!resolved) {
            failures.push(`Unresolved local import: ${path.relative(backendRoot, file)} -> ${specifier}`);
        }
        checked += 1;
    }
}

if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error(`Local import validation failed: ${failures.length} issue(s), ${checked} import(s) checked.`);
    process.exitCode = 1;
} else {
    console.log(`Local import validation passed: ${checked} relative require path(s) resolved; layer-first MVC structure is present.`);
}
