const crypto = require('node:crypto');
const { createRateLimit: createLocalRateLimit } = (() => {
  const buckets = new Map();
  let cleanupTimer;
  const getClientKey = req => String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
  const ensureCleanup = () => {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, record] of buckets) if (record.resetAt <= now) buckets.delete(key);
      if (buckets.size === 0 && cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = undefined; }
    }, 60_000);
    cleanupTimer.unref?.();
  };
  return { createRateLimit: ({ windowMs, maxRequests, message }) => {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(maxRequests) || maxRequests <= 0) throw new TypeError('A positive windowMs and maxRequests are required');
    return (req, res, next) => {
      const now = Date.now();
      const key = `${req.baseUrl || ''}:${req.path || ''}:${getClientKey(req)}`;
      let record = buckets.get(key);
      if (!record || record.resetAt <= now) { record = { count: 0, resetAt: now + windowMs }; buckets.set(key, record); }
      record.count += 1; ensureCleanup();
      const remaining = Math.max(0, maxRequests - record.count);
      res.setHeader('RateLimit-Limit', String(maxRequests));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(record.resetAt / 1000)));
      if (record.count > maxRequests) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((record.resetAt - now) / 1000))));
        return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
      }
      return next();
    };
  } };
})();

// For multi-instance deployments, use a MongoDB-backed atomic fixed-window counter.
// Local memory remains the simple instructor-friendly default in development.
function createRateLimit(options) {
  if (process.env.SHARED_RATE_LIMIT_STORE !== 'mongo') return createLocalRateLimit(options);
  const { windowMs, maxRequests, message } = options;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(maxRequests) || maxRequests <= 0) throw new TypeError('A positive windowMs and maxRequests are required');
  const RateLimitCounter = require('../model/rateLimitCounter.model');
  const logger = require('../utilities/logger');
  return async (req, res, next) => {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const scope = `${req.baseUrl || ''}:${req.path || ''}`;
    const clientHash = crypto.createHash('sha256')
      .update(`${process.env.RATE_LIMIT_SALT || process.env.JWT_SECRET || 'development-only'}:${req.ip || req.socket?.remoteAddress || 'unknown'}`)
      .digest('hex');
    const key = `${scope}:${clientHash}:${windowStart}`;
    const expiresAt = new Date(windowStart + windowMs + 60_000);
    let record;
    try {
      try {
        record = await RateLimitCounter.findOneAndUpdate(
          { key },
          { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
      } catch (error) {
        // Concurrent first requests can race on the unique key; increment the winner.
        if (error.code !== 11000) throw error;
        record = await RateLimitCounter.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }).lean();
      }
    } catch (error) {
      logger.logError('security.rate_limit_store.failed', error, { event: 'security.rate_limit_store.failed', route: scope });
      if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Security controls are temporarily unavailable. Please try again shortly.' });
      return next();
    }
    if (!record) return res.status(503).json({ error: 'Security controls are temporarily unavailable.' });
    const resetAt = windowStart + windowMs;
    const remaining = Math.max(0, maxRequests - record.count);
    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
    if (record.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
      return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

module.exports = { createRateLimit };
