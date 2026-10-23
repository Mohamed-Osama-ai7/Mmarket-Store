const express = require('express');
const router = express.Router();
const { createContactMessage, getContactMessages, updateContactStatus } = require('../controller/contact.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const { authorize } = require('../middlewares/role.middleware');
const { createRateLimit } = require('../middlewares/rateLimit.middleware');

const contactLimiter = createRateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 5, message: 'Too many contact requests. Please try again later.' });
router.post('/', contactLimiter, createContactMessage);
router.get('/admin', authenticate, authorize('admin'), getContactMessages);
router.patch('/:id/status', authenticate, authorize('admin'), updateContactStatus);
module.exports = router;
