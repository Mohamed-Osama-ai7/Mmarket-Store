// Bounded in-process cache for a fast local hot path. When CACHE_STORE=mongo,
// the product list cache uses the Mongo-backed shared store for cross-instance
// consistency. This keeps the instructor-level service API intact.
const NodeCache = require('node-cache');
const DEFAULT_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 86400;
const MAX_CACHE_ENTRIES = 1000;
const configuredTtl = process.env.PRODUCT_LIST_CACHE_TTL_SECONDS;
const ttlSeconds = configuredTtl === undefined ? DEFAULT_TTL_SECONDS : Number(configuredTtl);

if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS || (configuredTtl !== undefined && !/^[1-9]\d*$/.test(configuredTtl))) {
  throw new Error('PRODUCT_LIST_CACHE_TTL_SECONDS must be an integer between 1 and 86400');
}

module.exports = new NodeCache({ stdTTL: ttlSeconds, checkperiod: Math.min(ttlSeconds, 60), maxKeys: MAX_CACHE_ENTRIES, useClones: true });
