# Jashn: Celebration & Event Planner

Challenge 5 submission. Jashn is a GenAI planning assistant for **weddings, birthdays and community events**. Tell it the occasion, date, guest count, budget and vibe, and it returns a budget breakdown, a dated timeline, a vendor checklist, personalised ideas, a guest list with a shareable RSVP link, and live venue recommendations when Places is configured. Choose English or Hinglish for the planning voice.

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
3. The frontend renders the plan, a locally saved guest list, and a shareable RSVP link. Guest replies are recorded by the server and are visible to the plan creator through a separate private management token.
4. "Save as PDF" uses the print stylesheet.

## Run it
```bash
npm install
cp .env.example .env   # add your free key from https://aistudio.google.com/apikey
npm start              # http://localhost:3000
npm test
```
Needs Node 22 or newer. Works without a key too (fallback ideas).

For live venue recommendations and venue photos, enable the **Places API (New)** for a Google Maps Platform project, set `GOOGLE_MAPS_API_KEY` in `.env`, and ensure billing/API restrictions are configured in Google Cloud. Without it, Jashn shows an honest setup note and a direct Google Maps search for current local listings rather than fabricated venue data.

## Evaluation focus
- **Code quality:** small modules, pure functions, no framework lock in.
- **Security:** `helmet` with a strict CSP, 5kb body limit, rate limit of 12 requests a minute per IP, strict validation, control characters and angle brackets stripped, user text passed to the model as delimited untrusted data, AI output re-validated and length capped, UI built with `textContent` (no `innerHTML`), API key only on the server and never logged.
- **Efficiency:** one AI call per plan, in-memory cache for repeat requests, 20s timeout, no frontend dependencies.
- **Testing:** `npm test` runs 8 tests for validation, budget maths, timeline edge cases, tone handling, AI parsing and the API end to end.
- **Accessibility:** semantic fieldsets and labels, keyboard friendly wizard, visible focus, skip link, live regions for progress and errors, dark mode, and `prefers-reduced-motion` turns off all animation.
- **Problem alignment:** budgets, timelines, vendor checklists and personalised ideas for the three named event types.

## Assumptions
- Budget is in INR and the budget split percentages are sensible averages, not quotes from real vendors.
- Dates must be today up to 3 years ahead. If the event is closer than the ideal lead time, the timeline is compressed so nothing is dated in the past.
- No user accounts or database. RSVP event details and replies are the only plan data held on the server, and they are stored in memory.
- The demo stores RSVP responses in memory, so they are cleared when the server restarts. The host's guest list is kept in that browser's local storage; back it up before clearing browser data.
- Venue results and photos are fetched live from Google Places. Google-provided photo attributions are shown when supplied; availability and prices must be confirmed with the venue.
- The free Gemini tier has rate limits, which is why there is caching and a fallback.
