const mongoose = require('mongoose');

const tryOnJobSchema = new mongoose.Schema({
  predictionId: { type: String, required: true, unique: true, trim: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  productSlug: { type: String, required: true, trim: true, maxlength: 181 },
  expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 60 * 60 * 1000) },
}, { timestamps: true });

tryOnJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
tryOnJobSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.TryOnJob || mongoose.model('TryOnJob', tryOnJobSchema);
