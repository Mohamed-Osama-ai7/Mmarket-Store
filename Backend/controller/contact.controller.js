const ContactMessage = require('../model/contactMessage.model');
const logger = require('../utilities/logger');
const { notifyAdministrators } = require('../utilities/notificationPublisher');

const cleanText = (value) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  : '';

exports.createContactMessage = async (req, res, next) => {
  try {
    const name = cleanText(req.body?.name);
    const email = cleanText(req.body?.email).toLowerCase();
    const subject = cleanText(req.body?.subject);
    const message = cleanText(req.body?.message);
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Name must be between 2 and 100 characters.' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (subject.length < 3 || subject.length > 120) return res.status(400).json({ error: 'Subject must be between 3 and 120 characters.' });
    if (message.length < 10 || message.length > 3000) return res.status(400).json({ error: 'Message must be between 10 and 3000 characters.' });

    const saved = await ContactMessage.create({ name, email, subject, message });
    await notifyAdministrators({
      type: 'contact_message',
      title: 'New contact message',
      message: `A new message was received from ${name}.`,
      link: '/dashboard/contact'
    });
    return res.status(201).json({ message: 'Your message has been received.', data: { id: saved._id, status: saved.status } });
  } catch (error) {
    logger.logError('contact.create.failed', error, { requestId: req.id, method: req.method });
    return next(error);
  }
};

exports.getContactMessages = async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const pageSize = Math.max(1, Math.min(50, Number.parseInt(req.query.pageSize, 10) || 20));
    const allowedStatuses = ['open', 'in_progress', 'resolved'];
    const filter = {};
    if (req.query.status && req.query.status !== 'all') {
      if (!allowedStatuses.includes(req.query.status)) return res.status(400).json({ error: 'Invalid contact message status.' });
      filter.status = req.query.status;
    }
    const [messages, totalItems] = await Promise.all([
      ContactMessage.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      ContactMessage.countDocuments(filter)
    ]);
    return res.status(200).json({ data: messages, pagination: { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize) } });
  } catch (error) {
    logger.logError('contact.admin_list.failed', error, { requestId: req.id, method: req.method });
    return next(error);
  }
};

exports.updateContactStatus = async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!['open', 'in_progress', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid contact message status.' });
    const message = await ContactMessage.findByIdAndUpdate(req.params.id, {
      $set: { status, resolvedAt: status === 'resolved' ? new Date() : null }
    }, { new: true, runValidators: true });
    if (!message) return res.status(404).json({ error: 'Contact message not found.' });
    return res.status(200).json({ message: 'Contact message updated.', data: message });
  } catch (error) {
    logger.logError('contact.status_update.failed', error, { requestId: req.id, method: req.method });
    return next(error);
  }
};
