'use strict';

const rateLimit = require('express-rate-limit');
const database = require('../database');
const { statements } = database;
const rsvp = require('../rsvp');
const emailService = require('../email');
const { clean } = require('../planner');
const { savedPlanEvent } = require('../plan-utils');
const { asyncHandler, requireAuth } = require('../session');

/**
 * Registers saved-plan email invitation endpoints.
 * @param {import('express').Application} app Express application.
 * @returns {void}
 */
function registerInvitationRoutes(app) {
  app.post(
    '/api/plans/:id/invites',
    requireAuth,
    rateLimit({
      windowMs: 10 * 60_000,
      limit: 5,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const saved = statements.getPlan.get(req.params.id, req.user.id);
      if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
      if (!emailService.isConfigured())
        return res
          .status(503)
          .json({ error: 'Email invitations are not configured. Copy the RSVP link instead.' });
      const guestName = clean(req.body?.name, 80);
      const guestEmail =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (
        !guestName ||
        guestEmail.length > 254 ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(guestEmail)
      ) {
        return res.status(400).json({ error: 'Enter a valid guest name and email address.' });
      }
      const progressRow = statements.getPlanProgress.get(req.params.id);
      const guestIsListed =
        progressRow &&
        JSON.parse(progressRow.guests).some(
          (guest) => guest.name === guestName && guest.email === guestEmail,
        );
      if (!guestIsListed)
        return res.status(400).json({
          error: 'Add this guest and email to your host list before sending an invitation.',
        });
      const event = rsvp.getPublicEvent(savedPlanEvent(saved));
      if (!event) return res.status(404).json({ error: 'RSVP event not found.' });
      const link = emailService.invitationLink(savedPlanEvent(saved));
      const escapeHtml = (value) =>
        String(value).replace(
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
      const safeName = escapeHtml(guestName);
      const safeTitle = escapeHtml(event.title);
      const eventDetails = [event.date && ` on ${event.date}`, event.city && ` in ${event.city}`]
        .filter(Boolean)
        .join('');
      const safeEventDetails = escapeHtml(eventDetails);
      const safeLink = link
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      try {
        await emailService.sendAccountEmail({
          to: guestEmail,
          subject: `You're invited: ${event.title}`,
          text: `Hi ${guestName},\n\nYou're invited to ${event.title}${eventDetails}.\n\nView the invitation and RSVP here: ${link}\n`,
          html: `<p>Hi ${safeName},</p><p>You're invited to <strong>${safeTitle}</strong>${safeEventDetails}.</p><p><a href="${safeLink}">View invitation and RSVP</a></p>`,
        });
      } catch (error) {
        console.error('Invitation email delivery failed:', error.name || 'Error');
        return res.status(503).json({
          error: 'Could not send the invitation. Check your email settings and try again.',
        });
      }
      res.json({ ok: true, message: 'Invitation sent.' });
    }),
  );
}

module.exports = registerInvitationRoutes;
