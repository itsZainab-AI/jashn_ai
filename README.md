# Jashn: Celebration & Event Planner

Challenge 5 submission. Jashn is a GenAI planning assistant for **weddings, birthdays and community events**. Tell it the occasion, date, guest count, budget and vibe, and it returns a budget breakdown, a dated timeline, a vendor checklist, personalised ideas, a guest list with a shareable RSVP link, and live venue recommendations when Places is configured. Choose English or Hinglish for the planning voice.

Jashn includes a persistent SQLite database, account registration and login, and a private dashboard for saved celebration plans. You can still use the planner without an account, but those plans won't appear in your dashboard.

## Chosen vertical
Celebration and event planning, with three event types: wedding, birthday and community event. Currency is INR, because the defaults (vendors, rituals, budget splits) are written for Indian celebrations.

## Approach and logic
The app splits the work on purpose:

- **Deterministic code** (`src/planner.js`) does everything that must be correct: input validation, budget split that always sums exactly to the total, timeline dates, vendor checklists. No AI needed, so this part is fast, free and fully testable.
- **Gemini** (`src/gemini.js`) does the creative part only: theme, tagline, 6 budget-aware ideas and a toast. One call per plan.
- If the key is missing, the quota runs out or Gemini returns junk, the app falls back to built-in ideas. The user always gets a complete plan.

## How it works
1. The browser sends `POST /api/plan` with `type, date, guests, budget, city, vibe, tone`.
2. The server validates and cleans the input, builds budget, timeline and checklist, asks Gemini for ideas, and (when configured) searches Google Places for actual nearby venues and venue photos.
3. Signed-in users' plans, checked vendor items, host-maintained guest lists, and RSVP links are saved in SQLite. Hosts can edit/remove invitees, send or resend email invitations when SMTP is configured, and edit/delete RSVP replies. RSVP replies are stored persistently; the host can view them through their account, while guest-mode plans use a private management token.
4. "Save as PDF" uses the print stylesheet.

## Run it
```bash
npm install
cp .env.example .env   # add your free key from https://aistudio.google.com/apikey
npm start              # http://localhost:3000
npm test
```
Needs Node 22 or newer. The SQLite database is created automatically at `data/jashn.sqlite` (override with `DATABASE_PATH`). It is ignored by Git. Works without an AI key too (fallback ideas).

Email verification and password reset require valid SMTP settings in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`) and `APP_URL` set to the app's public root URL. The verification link expires after 24 hours; password-reset links expire after 1 hour, are one-use, and invalidate existing sessions when used. Without SMTP configuration, registration clearly reports that email delivery is unavailable.
Accounts created before email verification was enabled must verify their address before they can log in; use the resend-verification action on the login screen.

For deployment, use HTTPS and set `NODE_ENV=production` so session cookies are marked `Secure`. Back up the SQLite file securely. Account emails are verified, but email-change flows and stronger production email deliverability/monitoring are not included.

For live venue recommendations and venue photos, enable the **Places API (New)** for a Google Maps Platform project, set `GOOGLE_MAPS_API_KEY` in `.env`, and ensure billing/API restrictions are configured in Google Cloud. Without it, Jashn shows an honest setup note and a direct Google Maps search for current local listings rather than fabricated venue data.

## Evaluation focus
- **Code quality:** small modules, pure functions, no framework lock in.
- **Security:** `helmet` with a strict CSP, 20kb JSON body limit, rate limits on planning/auth/RSVP endpoints, parameterized SQLite queries, scrypt password hashes, hashed one-time verification/reset tokens, random server-side sessions stored as token hashes, HttpOnly/SameSite session cookies, protected user-owned plan routes, strict validation, user text passed to the model as delimited untrusted data, AI output re-validated and length capped, UI built with `textContent` (no `innerHTML`), API key only on the server and never logged.
- **Efficiency:** one AI call per plan, in-memory cache for repeat requests, 20s timeout, no frontend dependencies.
- **Testing:** `npm test` covers validation, budget maths, timeline edge cases, tone handling, AI parsing, email verification, password reset, account registration/login/logout, saved-plan ownership and progress, and RSVP behavior.
- **Accessibility:** semantic fieldsets and labels, keyboard friendly wizard, visible focus, skip link, live regions for progress and errors, dark mode, and `prefers-reduced-motion` turns off all animation.
- **Problem alignment:** budgets, timelines, vendor checklists and personalised ideas for the three named event types.

## Assumptions
- Budget is in INR and the budget split percentages are sensible averages, not quotes from real vendors.
- Dates must be today up to 3 years ahead. If the event is closer than the ideal lead time, the timeline is compressed so nothing is dated in the past.
- Plans, users, sessions, RSVP events and replies are stored in SQLite. Keep `data/jashn.sqlite` backed up and private; do not commit it.
- For signed-in users, the host-maintained guest list and checked vendor items are stored in SQLite per plan. Guest-mode planning keeps these items in browser local storage. Replies submitted through RSVP links are stored in SQLite.
- Saved-plan hosts can store an optional email per invitee and send or resend the shared RSVP link. This requires working SMTP settings; copying and sharing the link remains available without email delivery.
- A signed-in host guest list supports up to 40 manually added guests per plan.
- Users must verify their email before logging in. Email delivery depends on correct SMTP settings; configure provider-specific SPF/DKIM and delivery monitoring before public launch.
- Venue results and photos are fetched live from Google Places. Google-provided photo attributions are shown when supplied; availability and prices must be confirmed with the venue.
- The free Gemini tier has rate limits, which is why there is caching and a fallback.
