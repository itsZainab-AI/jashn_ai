'use strict';

const emailService = require('./email');

/**
 * Creates the plain-text and HTML body for an account email.
 * @param {{name: string, link: string, purpose: string}} details Email details.
 * @returns {{subject: string, text: string, html: string}} Message fields.
 */
function emailMessage({ name, link, purpose }) {
  const verification = purpose === 'email_verification';
  const heading = verification ? 'Verify your Jashn email' : 'Reset your Jashn password';
  const action = verification ? 'Verify email address' : 'Reset password';
  const message = verification
    ? 'Please verify your email address to finish creating your Jashn account.'
    : 'We received a request to reset your Jashn password.';
  const expiresIn = verification ? '24 hours' : '1 hour';
  const text = `Hi ${name},\n\n${message}\n\n${action}: ${link}\n\nThis link expires in ${expiresIn}. If you did not request this, you can ignore this email.\n`;
  const safeName = name.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );
  const safeLink = link
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = `<p>Hi ${safeName},</p><p>${message}</p><p><a href="${safeLink}">${action}</a></p><p>This link expires in ${expiresIn}. If you did not request this, you can ignore this email.</p>`;
  return { subject: heading, text, html };
}

/**
 * Delivers an account verification or password-reset link.
 * @param {{email: string, name: string}} user Account owner.
 * @param {string} purpose Account token purpose.
 * @param {string} token Raw one-time token.
 * @returns {Promise<void>}
 */
async function sendAccountLink(user, purpose, token) {
  const flow = purpose === 'email_verification' ? 'verify' : 'reset';
  const link = emailService.accountLink(flow, token);
  await emailService.sendAccountEmail({
    to: user.email,
    ...emailMessage({ name: user.name, link, purpose }),
  });
}

module.exports = { emailMessage, sendAccountLink };
