const express = require('express');
const router = express.Router();
const { authenticate } = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../middlewares/rateLimit.middleware');
const controller = require('../controller/tryon.controller');

// Virtual image generation incurs third-party usage cost. Require a valid account and strictly limit creation attempts.
const createLimiter = createRateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 3, message: 'You have reached the virtual try-on limit. Please try again later.' });
const statusLimiter = createRateLimit({ windowMs: 60 * 1000, maxRequests: 30, message: 'Too many virtual try-on status checks. Please wait a moment.' });

router.post('/:slug', authenticate, createLimiter, controller.create);
router.get('/jobs/:predictionId', authenticate, statusLimiter, controller.status);

module.exports = router;
