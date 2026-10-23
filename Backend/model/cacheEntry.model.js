const mongoose = require('mongoose');

const cacheEntrySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 512 },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  version: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true, minimize: false });

cacheEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('SharedCacheEntry', cacheEntrySchema);
