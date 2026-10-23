const logger = require('./logger');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (apiKey && from) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.logSafely('error', 'Email provider rejected a message', {
        event: 'email.delivery.failed', status: response.status, responseBody: body.slice(0, 300)
      });
      throw new Error('Email delivery failed');
    }
    return;
  }

  // Local-only transport for a course project. Never log reset links in production.
  if (process.env.NODE_ENV !== 'production' && process.env.RESET_EMAIL_MODE === 'console') {
    process.stdout.write(`\n[LOCAL EMAIL PREVIEW]\nTo: ${to}\nSubject: ${subject}\n${text}\n[/LOCAL EMAIL PREVIEW]\n`);
    return;
  }

  throw new Error('Email provider is not configured');
}

async function sendPasswordResetEmail(user, resetUrl) {
  const safeName = escapeHtml(user.name || 'there');
  const safeUrl = escapeHtml(resetUrl);
  const subject = 'Reset your Market password';
  const text = `Hello ${user.name || 'there'},\n\nWe received a request to reset your Market password. Open this link within 20 minutes:\n${resetUrl}\n\nIf you did not request this, you can ignore this email. Your password will not change unless the link is used.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#213c2e;max-width:560px;margin:auto"><h1>Reset your password</h1><p>Hello ${safeName},</p><p>We received a request to reset your Market password.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#1e5948;color:#fff;text-decoration:none;border-radius:24px">Choose a new password</a></p><p>This link expires in 20 minutes. If you did not request this, ignore this email; your password will not change unless the link is used.</p></div>`;
  await sendEmail({ to: user.email, subject, html, text });
}

async function sendOrderUpdateEmail({ user, order, subject, message }) {
  if (!user?.email) return;
  const safeName = escapeHtml(user.name || 'there');
  const safeMessage = escapeHtml(message);
  const orderNumber = escapeHtml(String(order?._id || '').slice(-8).toUpperCase());
  const appUrl = (process.env.APP_URL || 'http://localhost:4200').replace(/\/$/, '');
  const orderUrl = order?.guestEmail && !order?.user ? `${appUrl}/guest-order/${encodeURIComponent(String(order._id || ''))}` : `${appUrl}/orders`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#213c2e;max-width:560px;margin:auto"><h1>${escapeHtml(subject)}</h1><p>Hello ${safeName},</p><p>${safeMessage}</p><p>Order reference: <strong>#${orderNumber}</strong></p><p><a href="${escapeHtml(orderUrl)}">View order status</a></p></div>`;
  const text = `Hello ${user.name || 'there'},\n\n${message}\nOrder reference: #${String(order?._id || '').slice(-8).toUpperCase()}\n${orderUrl}`;
  try { await sendEmail({ to: user.email, subject, html, text }); }
  catch (error) { logger.logError('email.order_update.failed', error, { event: 'email.order_update.failed' }); }
}

module.exports = { sendEmail, sendPasswordResetEmail, sendOrderUpdateEmail };
