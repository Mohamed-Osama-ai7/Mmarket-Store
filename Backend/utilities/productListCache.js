const cache = require('./cache');
const SHARED_CACHE = process.env.CACHE_STORE === 'mongo';
const CacheEntry = SHARED_CACHE ? require('../model/cacheEntry.model') : null;
const PRODUCT_LIST_PREFIX = 'products:list:';
const GENERATION_KEY = 'products:list:__generation';
let cacheGeneration = Symbol('product-list-cache-generation');
const ttlSeconds = Number(process.env.PRODUCT_LIST_CACHE_TTL_SECONDS || 60);

const getBaseKey = (page, pageSize, filterKey = '') => `${PRODUCT_LIST_PREFIX}page:${page}:pageSize:${pageSize}:filters:${filterKey}`;
const getSharedGeneration = async () => {
  if (!SHARED_CACHE) return cacheGeneration;
  const record = await CacheEntry.findOne({ key: GENERATION_KEY }).select('version').lean();
  return Number(record?.version || 0);
};
const getKey = (page, pageSize, filterKey, version) => `${getBaseKey(page, pageSize, filterKey)}:v:${version}`;

const invalidate = () => {
  const productListKeys = cache.keys().filter(key => key.startsWith(PRODUCT_LIST_PREFIX));
  if (productListKeys.length > 0) cache.del(productListKeys);
  cacheGeneration = Symbol('product-list-cache-generation');
  if (!SHARED_CACHE) return;
  // Bumping the generation makes in-flight requests from other app instances
  // unable to repopulate the active namespace with stale responses.
  return CacheEntry.findOneAndUpdate(
    { key: GENERATION_KEY },
    { $inc: { version: 1 }, $set: { expiresAt: new Date(Date.now() + 3650 * 86400 * 1000) }, $setOnInsert: { value: 'generation' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).then(() => undefined);
};

module.exports = {
  getGeneration() { return cacheGeneration; },
  async getVersion() { return getSharedGeneration(); },
  get(page, pageSize, filterKey = '', version) {
    if (!SHARED_CACHE) return cache.get(getBaseKey(page, pageSize, filterKey));
    const read = async () => {
      const currentVersion = version === undefined ? await getSharedGeneration() : version;
      const key = getKey(page, pageSize, filterKey, currentVersion);
      const local = cache.get(key);
      if (local !== undefined) return local;
      const record = await CacheEntry.findOne({ key, expiresAt: { $gt: new Date() } }).select('value').lean();
      if (!record) return undefined;
      cache.set(key, record.value, ttlSeconds);
      return record.value;
    };
    return read();
  },
  set(page, pageSize, value, generation = cacheGeneration, filterKey = '') {
    if (generation === cacheGeneration) {
      if (!SHARED_CACHE) return cache.set(getBaseKey(page, pageSize, filterKey), value);
    } else if (!SHARED_CACHE) {
      return false;
    }
    if (!SHARED_CACHE) return false;
    const write = async () => {
      const version = typeof generation === 'number' ? generation : await getSharedGeneration();
      const key = getKey(page, pageSize, filterKey, version);
      cache.set(key, value, ttlSeconds);
      await CacheEntry.updateOne({ key }, {
        $set: { value, version, expiresAt: new Date(Date.now() + ttlSeconds * 1000) }
      }, { upsert: true });
      return true;
    };
    return write();
  },
  invalidate
};
