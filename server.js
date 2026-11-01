'use strict';

const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const { resolveApiUser } = require('./src/session');
const registerAuthRoutes = require('./src/routes/auth');
const registerAccountLinkRoutes = require('./src/routes/account-links');
const registerInvitationRoutes = require('./src/routes/invitations');
const registerPlanRoutes = require('./src/routes/plans');
const registerPlannerRoutes = require('./src/routes/planner');
const registerRsvpRoutes = require('./src/routes/rsvp');

const app = express();
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'https://*.googleusercontent.com'],
      },
    },
  }),
);
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', resolveApiUser);

registerAuthRoutes(app);
registerAccountLinkRoutes(app);
registerPlanRoutes(app);
registerInvitationRoutes(app);
registerPlannerRoutes(app);
registerRsvpRoutes(app);

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.name || 'Error');
  const status =
    Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ errors: ['Something went wrong. Try again.'] });
});

if (require.main === module) app.listen(process.env.PORT || 3000);

module.exports = app;
