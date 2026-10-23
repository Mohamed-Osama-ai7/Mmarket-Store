// Fail-fast configuration check. Returns a list of problems so it is easy to unit test.
const PLACEHOLDER_SECRETS = ["replace-with-a-random-secret-at-least-32-characters-long"];

const getEnvProblems = (env = process.env) => {
    const problems = [];
    const secret = env.JWT_SECRET || "";
    if (!secret) problems.push("JWT_SECRET is required");
    else if (secret.length < 32) problems.push("JWT_SECRET must be at least 32 characters");
    else if (PLACEHOLDER_SECRETS.includes(secret)) problems.push("JWT_SECRET still has the .env.example placeholder value");
    if (!env.JWT_EXPIRES_IN) problems.push("JWT_EXPIRES_IN is required");
    if (!env.DUMMY_PASSWORD_HASH) problems.push("DUMMY_PASSWORD_HASH is required");
    if (!env.MONGO_URI) problems.push("MONGO_URI is required");
    if (!String(env.ALLOWED_ORIGINS || "").trim()) problems.push("ALLOWED_ORIGINS is required so the browser frontend can call the API");
    return problems;
};

// Production stops on problems; development only warns so local setups and tests keep working.
const assertEnv = (env = process.env, logger = console) => {
    const problems = getEnvProblems(env);
    if (!problems.length) return;
    if (env.NODE_ENV === "production") {
        throw new Error(`Invalid environment configuration: ${problems.join("; ")}`);
    }
    (logger.warn || logger.log).call(logger, `Environment warnings (fatal in production): ${problems.join("; ")}`);
};

module.exports = { getEnvProblems, assertEnv };
