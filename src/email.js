'use strict';

const nodemailer = require('nodemailer');

let testTransport = null;
let smtpTransport = null;
let smtpTransportKey = '';

function getConfig() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, EMAIL_FROM, APP_URL } =
    process.env;
  const port = Number(SMTP_PORT);
  if (
    !SMTP_HOST ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !SMTP_USER ||
    !SMTP_PASS ||
    !EMAIL_FROM
  )
    return null;
  let appUrl;
  try {
    appUrl = new URL(APP_URL);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(appUrl.protocol) || appUrl.username || appUrl.password)
    return null;
  appUrl.search = '';
  appUrl.hash = '';
  return {
    host: SMTP_HOST,
    port,
    secure: SMTP_SECURE === 'true' || port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    from: EMAIL_FROM,
    appUrl: appUrl.toString().replace(/\/$/, ''),
  };
}

/** @returns {boolean} Whether SMTP and the application URL are configured. */
function isConfigured() {
  return Boolean(getConfig());
}

/**
 * Sends a transactional email using the configured SMTP transport.
 * @param {{to: string, subject: string, text: string, html: string}} message Email content.
 * @returns {Promise<object>} Nodemailer delivery result.
 */
async function sendAccountEmail({ to, subject, text, html }) {
  const config = getConfig();
  if (!config) throw new Error('Email delivery is not configured.');
  const key = JSON.stringify(config);
  if (!smtpTransport || smtpTransportKey !== key) {
    smtpTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    smtpTransportKey = key;
  }
  const transport = testTransport || smtpTransport;
  return transport.sendMail({ from: config.from, to, subject, text, html });
}

/**
 * Builds a verification or password-reset link.
 * @param {'verify'|'reset'} flow Account email flow.
 * @param {string} token One-time token.
 * @returns {string} Absolute account link.
 */
function accountLink(flow, token) {
  const config = getConfig();
  if (!config) throw new Error('Email delivery is not configured.');
  if (!['verify', 'reset'].includes(flow)) throw new Error('Unknown account email flow.');
  const url = new URL('/', `${config.appUrl}/`);
  url.searchParams.set(flow, token);
  return url.toString();
}

/**
 * Builds the public invitation URL for an event.
 * @param {string} inviteId RSVP event identifier.
 * @returns {string} Absolute RSVP link.
 */
function invitationLink(inviteId) {
  const config = getConfig();
  if (!config) throw new Error('Email delivery is not configured.');
  if (typeof inviteId !== 'string' || !/^[a-f0-9]{36}$/.test(inviteId))
    throw new Error('Invalid invitation ID.');
  const url = new URL('/', `${config.appUrl}/`);
  url.searchParams.set('rsvp', inviteId);
  return url.toString();
}

/**
 * Replaces the SMTP transport for tests.
 * @param {object|null} transport Nodemailer-compatible test transport.
 * @returns {void}
 */
function setTestTransport(transport) {
  testTransport = transport;
  smtpTransport = null;
  smtpTransportKey = '';
}

module.exports = { accountLink, invitationLink, isConfigured, sendAccountEmail, setTestTransport };
