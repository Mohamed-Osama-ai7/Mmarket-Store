const mongoose = require('mongoose');

const rateLimitCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, maxlength: 512 },
  count: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

rateLimitCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model('RateLimitCounter', rateLimitCounterSchema);
