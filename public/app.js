'use strict';
const $ = (s) => document.querySelector(s);
const form = $('#wizard'), steps = [...form.querySelectorAll('.step')];
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let step = 0;
let currentUser = null;

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function showScreen(id) {
  ['splash-screen', 'hero', 'login-screen', 'register-screen', 'account-action-screen', 'dashboard-screen'].forEach((screenId) => {
    $(`#${screenId}`).hidden = screenId !== id;
  });
  form.hidden = true;
  $('#loading').hidden = true;
  $('#result').hidden = true;
  $('#rsvpView').hidden = true;
  $('#account-nav').hidden = id === 'splash-screen';
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

function setUser(user) {
  currentUser = user;
  $('#guest-nav').hidden = Boolean(user);
  $('#user-nav').hidden = !user;
  $('#user-greeting').textContent = user ? `Hi, ${user.name}` : '';
  $('#account-status').textContent = '';
}

$('#enter-app').onclick = () => showScreen('hero');
document.querySelectorAll('[data-screen]').forEach((button) => {
  button.addEventListener('click', () => showScreen(button.dataset.screen));
});
document.querySelectorAll('[data-auth-form]').forEach((authForm) => {
  authForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitAuth(authForm);
  });
});

async function submitAuth(authForm) {
  const status = authForm.querySelector('.auth-status');
  const submit = authForm.querySelector('[type="submit"]');
  const data = Object.fromEntries(new FormData(authForm));
  status.textContent = '';
  $('#resend-verification').hidden = true;
  submit.disabled = true;
  try {
    const response = await fetch(`/api/auth/${authForm.dataset.authForm}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.error || 'We couldn’t complete that request.');
      error.code = result.code;
      throw error;
    }
    authForm.reset();
    if (authForm.dataset.authForm === 'register') {
      showScreen('account-action-screen');
      showAccountPanel('verification-panel');
      $('#verification-message').textContent = result.message;
    } else {
      setUser(result.user);
      showScreen('hero');
    }
  } catch (error) {
    status.textContent = error.message;
    if (error.code === 'EMAIL_NOT_VERIFIED') $('#resend-verification').hidden = false;
  } finally {
    authForm.querySelector('[name="password"]').value = '';
    submit.disabled = false;
  }
}

function showAccountPanel(panelId) {
  ['verification-panel', 'reset-request-panel', 'reset-complete-panel'].forEach((id) => {
    $(`#${id}`).hidden = id !== panelId;
  });
  $('#account-action-status').textContent = '';
  showScreen('account-action-screen');
}

document.querySelectorAll('[data-account-action="password-reset"]').forEach((button) => {
  button.onclick = () => showAccountPanel('reset-request-panel');
});

$('#resend-verification').onclick = () => {
  const emailInput = $('#login-screen [name="email"]');
  showAccountPanel('verification-panel');
  $('#resend-form [name="email"]').value = emailInput.value;
  $('#verification-message').textContent = 'Enter the email address for your account and we’ll send a fresh link if verification is still needed.';
};

function handleAccountForm(formId, endpoint, onSuccess) {
  const accountForm = $(`#${formId}`);
  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = accountForm.querySelector('.auth-status');
    const submit = accountForm.querySelector('[type="submit"]');
    status.textContent = '';
    submit.disabled = true;
    try {
      const payload = Object.fromEntries(new FormData(accountForm));
      if (formId === 'reset-complete-form') payload.token = passwordResetToken;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'We couldn’t complete that request.');
      onSuccess(result, accountForm);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      const passwordInput = accountForm.querySelector('[name="password"]');
      if (passwordInput) passwordInput.value = '';
      submit.disabled = false;
    }
  });
}

handleAccountForm('resend-form', '/api/auth/verification/resend', (result, accountForm) => {
  accountForm.querySelector('.auth-status').textContent = result.message;
  accountForm.reset();
});

handleAccountForm('reset-request-form', '/api/auth/password-reset/request', (result, accountForm) => {
  accountForm.querySelector('.auth-status').textContent = result.message;
  accountForm.reset();
});

let passwordResetToken = '';
handleAccountForm('reset-complete-form', '/api/auth/password-reset/complete', (result, accountForm) => {
  accountForm.reset();
  passwordResetToken = '';
  $('#login-screen .auth-status').textContent = result.message;
  showScreen('login-screen');
});

$('#dashboard-link').onclick = loadDashboard;
$('#dashboard-plan').onclick = () => showScreen('hero');
$('#logout').onclick = async () => {
  const logout = $('#logout');
  logout.disabled = true;
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not log out. Please try again.');
    setUser(null);
    showScreen('hero');
  } catch (error) {
    $('#dashboard-status').textContent = error.message;
  } finally {
    logout.disabled = false;
  }
};

async function loadDashboard() {
  showScreen('dashboard-screen');
  const status = $('#dashboard-status');
  const cards = $('#saved-plans');
  status.textContent = 'Loading your plans…';
  cards.replaceChildren();
  try {
    const response = await fetch('/api/plans');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load your plans.');
    status.textContent = result.plans.length ? '' : 'Your saved celebrations will appear here.';
    if (!result.plans.length) {
      cards.append(el('p', 'empty-plans', 'No plans yet — your next big idea starts with one click.'));
      return;
    }
    result.plans.forEach((plan) => {
      const card = el('article', 'saved-plan');
      const title = `${plan.event_type[0].toUpperCase()}${plan.event_type.slice(1)} celebration`;
      const date = new Date(`${plan.event_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      card.append(el('h2', '', title), el('p', '', `${date}${plan.city ? ` · ${plan.city}` : ''}`));
      const open = el('button', 'btn', 'Open plan');
      open.type = 'button';
      open.onclick = () => openSavedPlan(plan.id);
      card.append(open);
      cards.append(card);
    });
  } catch (error) {
    status.textContent = error.message;
  }
}

async function openSavedPlan(id) {
  $('#dashboard-status').textContent = 'Opening your plan…';
  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(id)}`);
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || 'Could not open this plan.');
    await render(plan);
  } catch (error) {
    $('#dashboard-status').textContent = error.message;
  }
}

fetch('/api/auth/me')
  .then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not check your account session.');
    setUser(result.user);
  })
  .catch(() => {
    $('#account-status').textContent = 'Your account session could not be checked. You can still explore as a guest.';
  });

const accountLinkParams = new URLSearchParams(location.search);
const verificationToken = accountLinkParams.get('verify');
passwordResetToken = accountLinkParams.get('reset') || '';
if (verificationToken) {
  history.replaceState(null, '', location.pathname);
  showAccountPanel('verification-panel');
  $('#verification-message').textContent = 'Verifying your email address…';
  fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: verificationToken }),
  }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not verify your email.');
    setUser(result.user);
    showScreen('hero');
    $('#account-status').textContent = 'Email verified — you’re all set!';
  }).catch((error) => {
    $('#verification-message').textContent = error.message;
  });
} else if (passwordResetToken) {
  history.replaceState(null, '', location.pathname);
  showAccountPanel('reset-complete-panel');
}

// floating emojis in the background
if (!reduce) for (let i = 0; i < 12; i++) {
  const s = el('span', '', ['🎈', '✨', '🎉', '💖', '🌸'][i % 5]);
  s.style.cssText = `left:${Math.random() * 100}%;animation-duration:${14 + Math.random() * 14}s;animation-delay:${-Math.random() * 20}s`;
  $('#floaters').append(s);
}
$('#date').min = new Date().toISOString().slice(0, 10);

function burst() {
  if (reduce) return;
  const colors = ['#ff5fa2', '#b69bff', '#ffb48a', '#ffd86b'];
  for (let i = 0; i < 60; i++) {
    const c = el('i', 'confetti');
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 4]};--x:${(Math.random() - 0.5) * 300}px;animation-delay:${Math.random() * 0.6}s`;
    document.body.append(c); setTimeout(() => c.remove(), 3500);
  }
}

function show(n) {
  step = n;
  steps.forEach((s, k) => { s.hidden = k !== n; });
  $('#bar').style.width = `${((n + 1) / steps.length) * 100}%`;
  $('#stepLabel').textContent = `Step ${n + 1} of ${steps.length}`;
  $('#back').style.visibility = n ? 'visible' : 'hidden';
  $('#next').textContent = n === steps.length - 1 ? 'Make it happen 🎉' : 'Next';
  $('#error').textContent = '';
  steps[n].querySelector('input,textarea')?.focus({ preventScroll: true });
}

$('#start').onclick = () => {
  $('#hero').hidden = true;
  $('#account-nav').hidden = true;
  form.reset();
  form.hidden = false;
  show(0);
};
$('#back').onclick = () => show(step - 1);
$('#next').onclick = () => {
  const bad = [...steps[step].querySelectorAll('input,textarea')].find((i) => !i.checkValidity());
  if (step === 0 && !form.type.value) return void ($('#error').textContent = 'Pick one to continue, bestie.');
  if (bad && step > 0) { $('#error').textContent = bad.validationMessage || 'Please check this field.'; return bad.focus(); }
  step < steps.length - 1 ? show(step + 1) : submit();
};

async function submit() {
  form.hidden = true; $('#loading').hidden = false;
  const msgs = ['Warming up the confetti cannons...', 'Haggling with imaginary caterers...', 'Picking the perfect fairy lights...'];
  let m = 0; const t = setInterval(() => { $('#loadMsg').textContent = msgs[++m % msgs.length]; }, 1800);
  try {
    const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await res.json();
    if (!res.ok) throw new Error((data.errors || ['Something went wrong.']).join(' '));
    if (data.planId && !currentUser) {
      try {
        const sessionResponse = await fetch('/api/auth/me');
        const session = await sessionResponse.json();
        if (!sessionResponse.ok) throw new Error(session.error || 'Could not check account session.');
        if (session.user) setUser(session.user);
      } catch {
        $('#account-status').textContent = 'Your plan was saved, but the account session could not be checked. Reload before opening My celebrations.';
      }
    }
    await render(data);
  } catch (e) {
    $('#loading').hidden = true; form.hidden = false; show(1); $('#error').textContent = e.message;
  } finally { clearInterval(t); }
}

function section(title) { const s = el('section', 'reveal'); s.append(el('h2', '', title)); return s; }

async function render(d) {
  $('#splash-screen').hidden = true;
  $('#hero').hidden = true;
  $('#login-screen').hidden = true;
  $('#register-screen').hidden = true;
  $('#dashboard-screen').hidden = true;
  $('#account-nav').hidden = !currentUser;
  $('#loading').hidden = true;
  const out = $('#result'); out.replaceChildren(); out.hidden = false;

  let progress = { checkedChecklist: [], guests: [] };
  let progressReady = !d.planId;
  const progressStatus = el('p', 'progress-status', '');
  if (d.planId) {
    progressStatus.textContent = 'Loading saved checklist and guest list…';
    out.append(progressStatus);
    try {
      const response = await fetch(`/api/plans/${encodeURIComponent(d.planId)}/progress`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load saved progress.');
      progress = result.progress;
      progressReady = true;
      progressStatus.textContent = '';
    } catch (error) {
      progressStatus.dataset.unavailable = 'true';
      const retry = el('button', 'text-button', 'Retry');
      retry.type = 'button';
      retry.onclick = () => openSavedPlan(d.planId);
      progressStatus.replaceChildren(el('span', '', `${error.message} Your saved progress is protected until it loads.`), retry);
      out.append(progressStatus);
    }
  }

  if (d.planId) out.append(el('p', 'saved-notice', 'Saved to your account · open it anytime from My celebrations.'));
  if ($('#account-status').textContent) out.append(el('p', 'saved-notice', $('#account-status').textContent));
  const hero = el('div', 'themeCard'); hero.append(el('h2', '', d.ai.theme), el('p', '', d.ai.tagline));
  hero.append(el('small', '', `${inr.format(d.budget.perGuest)} per guest`));
  out.append(hero);

  const b = section('Where the money goes');
  d.budget.rows.forEach((r) => {
    const row = el('div', 'row'); const track = el('div', 'track'); const fill = el('b'); fill.style.setProperty('--w', `${r.pct * 3}%`);
    track.append(fill); row.append(el('span', '', r.name), track, el('span', '', inr.format(r.amount))); b.append(row);
    requestAnimationFrame(() => setTimeout(() => { fill.style.width = `${Math.min(100, r.pct * 3)}%`; }, 400));
  });
  b.append(el('p', '', `Total: ${inr.format(d.budget.total)}`));

  const tl = section('Your timeline'); const ul = el('ul', 'tl');
  d.timeline.forEach((m) => { const li = el('li'); const time = el('time', '', new Date(m.due).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })); li.append(time, el('span', '', m.task)); ul.append(li); });
  tl.append(ul);

  const key = `jashn:${d.event.type}:${d.event.date}`;
  let saved = d.planId ? progress.checkedChecklist : [];
  if (!d.planId) { try { saved = JSON.parse(localStorage.getItem(key)) || []; } catch {} }
  const ck = section('Vendor checklist'); const box = el('div', 'chk');
  d.checklist.forEach((c) => {
    const l = el('label'); const i = el('input'); i.type = 'checkbox'; i.checked = saved.includes(c.id); i.disabled = !progressReady;
    i.onchange = () => {
      const ids = [...box.querySelectorAll('input')].flatMap((input, k) => (input.checked ? [k] : []));
      if (d.planId) {
        progress.checkedChecklist = ids;
        queueProgressSave(d.planId, progress, progressStatus);
      } else {
        try { localStorage.setItem(key, JSON.stringify(ids)); }
        catch { $('#account-status').textContent = 'Could not save checklist progress in this browser.'; }
      }
      if (ids.length === d.checklist.length) burst();
    };
    l.append(i, el('span', '', c.item)); box.append(l);
  });
  ck.append(box);

  const id = section('Ideas just for you'); const grid = el('div', 'ideas');
  d.ai.ideas.forEach((x) => { const c = el('article', 'idea'); c.append(el('h3', '', x.title), el('p', '', x.detail)); grid.append(c); });
  id.append(grid);

  const toast = el('p', 'toast reveal', d.ai.toast ? `“${d.ai.toast}”` : '');
  const venueSection = renderVenues(d);
  const guestSection = renderGuests(d, progress, progressReady, progressStatus);
  const act = el('div', 'actions reveal'); const print = el('button', 'btn', 'Save as PDF'); print.onclick = () => print_(); const again = el('button', 'btn ghost', 'Plan another'); again.onclick = () => showScreen('hero');
  act.append(print, again);
  if (currentUser && d.planId) {
    const plans = el('button', 'btn ghost', 'My celebrations');
    plans.onclick = loadDashboard;
    act.append(plans);
  }
  out.append(venueSection, guestSection, b, tl, ck, id, toast, act);

  burst(); out.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.1 });
  out.querySelectorAll('.reveal').forEach((n) => io.observe(n));
}

let progressSaveQueue = Promise.resolve();
function queueProgressSave(planId, progress, status) {
  if (status.dataset.unavailable) return;
  const snapshot = {
    checkedChecklist: [...progress.checkedChecklist],
    guests: progress.guests.map((guest) => ({ ...guest })),
  };
  progressSaveQueue = progressSaveQueue.then(async () => {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save your progress.');
    status.textContent = '';
  }).catch((error) => {
    status.textContent = `${error.message} Your latest changes may not be saved.`;
  });
}

function renderVenues(d) {
  const s = section('Real venues near your celebration');
  const venues = d.venues || { items: [], reason: 'not_configured' };
  if (venues.available && venues.items.length) {
    s.append(el('p', 'section-note', `Live Google Maps listings for ${d.event.city || 'Pune'} · check availability and pricing directly with each venue.`));
    const grid = el('div', 'venue-grid');
    venues.items.forEach((venue) => {
      const card = el('article', 'venue-card');
      const visual = el('div', 'venue-photo');
      if (venue.photoUrl) {
        const image = el('img');
        image.src = venue.photoUrl;
        image.alt = `${venue.name} venue photo`;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.onerror = () => { image.remove(); visual.append(el('span', 'photo-placeholder', 'Venue photo unavailable')); };
        visual.append(image);
      } else visual.append(el('span', 'photo-placeholder', 'No venue photo available'));
      const body = el('div', 'venue-body');
      body.append(el('h3', '', venue.name), el('p', 'venue-address', venue.address));
      if (venue.rating) body.append(el('p', 'venue-rating', `★ ${venue.rating.toFixed(1)}${venue.reviewCount ? ` · ${venue.reviewCount.toLocaleString('en-IN')} reviews` : ''}`));
      const link = el('a', 'map-link', 'View venue on Google Maps ↗');
      link.href = venue.mapsUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      body.append(link);
      body.append(el('small', 'photo-credit', venue.attribution ? `Photo: ${venue.attribution} · Google` : 'Venue photo via Google Maps'));
      card.append(visual, body); grid.append(card);
    });
    s.append(grid);
  } else {
    const city = d.event.city || 'Pune';
    const copy = venues.reason === 'not_configured'
      ? 'Live venue photos need a Google Places API key. Meanwhile, browse real local listings and photos on Google Maps.'
      : venues.reason === 'no_results'
        ? `No live matches came back for ${city}. Try a broader nearby city or browse Google Maps.`
        : 'Live venue search is temporarily unavailable. You can still browse current local listings on Google Maps.';
    s.append(el('p', 'section-note', copy));
    const link = el('a', 'btn map-search', `Explore venues in ${city} ↗`);
    link.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.event.type} event venues in ${city}`)}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; s.append(link);
  }
  return s;
}

function renderGuests(d, progress, progressReady, progressStatus) {
  const s = section('Your guest list & RSVP link');
  const inviteUrl = new URL(location.href);
  inviteUrl.search = ''; inviteUrl.hash = ''; inviteUrl.searchParams.set('rsvp', d.invite.id);
  const share = el('div', 'share-box');
  const linkLabel = el('label', 'f', 'Share this private RSVP link');
  const linkInput = el('input'); linkInput.type = 'url'; linkInput.readOnly = true; linkInput.value = inviteUrl.href;
  linkLabel.append(linkInput);
  const copy = el('button', 'btn ghost', 'Copy RSVP link'); copy.type = 'button';
  const copyStatus = el('span', 'copy-status', '');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(inviteUrl.href); copyStatus.textContent = 'Copied — send it to your guests!'; }
    catch { copyStatus.textContent = 'Copy isn’t available here. Select the link above and copy it.'; linkInput.focus(); linkInput.select(); }
  };
  share.append(linkLabel, copy, copyStatus);

  const guestForm = el('form', 'guest-form');
  const name = el('input'); name.type = 'text'; name.maxLength = 80; name.required = true; name.placeholder = 'Guest name'; name.setAttribute('aria-label', 'Guest name');
  const email = el('input'); email.type = 'email'; email.maxLength = 254; email.placeholder = 'Email (optional)'; email.setAttribute('aria-label', 'Guest email (optional)');
  name.disabled = !progressReady;
  email.disabled = !progressReady;
  const add = el('button', 'btn', 'Add guest'); add.type = 'submit';
  add.disabled = !progressReady;
  guestForm.append(name, email, add);
  const list = el('ul', 'guest-list');
  const summary = el('p', 'guest-summary', 'Loading guest responses…');
  const guestStatus = el('p', 'guest-status', '');
  const storageKey = `jashn:guests:${d.invite.id}`;
  const saved = d.planId ? progress.guests : readList(storageKey);
  let replies = [];
  let repliesLoaded = false;
  let replyError = '';

  function persistLocalGuests() {
    if (d.planId) {
      progress.guests = saved;
      queueProgressSave(d.planId, progress, progressStatus);
    } else saveList(storageKey, saved);
  }

  function updateSummary() {
    if (!repliesLoaded) { summary.textContent = 'Loading guest responses…'; return; }
    if (replyError) { summary.textContent = `${saved.length} on your list · ${replyError}`; return; }
    const yes = replies.filter((guest) => guest.attending).length;
    summary.textContent = `${saved.length} on your list · ${replies.length} replies (${yes} coming, ${replies.length - yes} can’t make it)`;
  }

  async function sendInvitation(guest, button, status) {
    button.disabled = true;
    status.textContent = '';
    try {
      await progressSaveQueue;
      const response = await fetch(`/api/plans/${encodeURIComponent(d.planId)}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: guest.name, email: guest.email }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not send this invitation.');
      button.textContent = 'Resend invitation';
      status.textContent = payload.message || 'Invitation sent.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function updateLocalList() {
    list.replaceChildren();
    saved.forEach((guest, index) => {
      const li = el('li', 'guest-row');
      const details = el('div', 'guest-details');
      details.append(el('strong', '', guest.name), el('span', '', `${guest.email ? ` · ${guest.email}` : ''} · ${guest.status === 'attending' ? 'Going' : guest.status === 'declined' ? 'Can’t make it' : 'Awaiting RSVP'}`));
      li.append(details);
      const controls = el('div', 'guest-controls');
      const edit = el('button', 'guest-remove', 'Edit'); edit.type = 'button'; edit.disabled = !progressReady;
      edit.setAttribute('aria-label', `Edit ${guest.name}`);
      edit.onclick = () => {
        const editor = el('form', 'guest-edit-form');
        const editName = el('input'); editName.type = 'text'; editName.required = true; editName.maxLength = 80; editName.value = guest.name; editName.setAttribute('aria-label', 'Guest name');
        const editEmail = el('input'); editEmail.type = 'email'; editEmail.maxLength = 254; editEmail.value = guest.email || ''; editEmail.placeholder = 'Email (optional)'; editEmail.setAttribute('aria-label', 'Guest email (optional)');
        const save = el('button', 'text-button', 'Save'); save.type = 'submit';
        const cancel = el('button', 'text-button', 'Cancel'); cancel.type = 'button'; cancel.onclick = updateLocalList;
        editor.append(editName, editEmail, save, cancel);
        li.replaceChildren(editor);
        editor.onsubmit = (event) => {
          event.preventDefault();
          const nextName = editName.value.trim();
          const nextEmail = editEmail.value.trim().toLowerCase();
          if (!nextName) return;
          saved[index] = { ...guest, name: nextName.slice(0, 80), ...(nextEmail ? { email: nextEmail } : {}) };
          if (!nextEmail) delete saved[index].email;
          persistLocalGuests();
          updateLocalList();
        };
        editName.focus();
      };
      controls.append(edit);
      if (d.planId && guest.email) {
        const inviteStatus = el('span', 'invite-status', '');
        const invite = el('button', 'guest-remove', 'Send invitation'); invite.type = 'button'; invite.disabled = !progressReady;
        invite.onclick = () => sendInvitation(guest, invite, inviteStatus);
        controls.append(invite, inviteStatus);
      }
      const remove = el('button', 'guest-remove', 'Remove'); remove.type = 'button'; remove.disabled = !progressReady; remove.setAttribute('aria-label', `Remove ${guest.name}`);
      remove.onclick = () => {
          saved.splice(index, 1);
          persistLocalGuests();
          updateLocalList();
      };
      controls.append(remove);
      li.append(controls);
      list.append(li);
    });
    if (saved.length) list.hidden = false;
    updateSummary();
  }
  guestForm.onsubmit = (event) => {
    event.preventDefault();
    const guestName = name.value.trim();
    if (!guestName) return;
    if (d.planId && saved.length >= 40) {
      progressStatus.textContent = 'Your host guest list is full. The limit is 40 names per celebration.';
      return;
    }
    const guestEmail = email.value.trim().toLowerCase();
    saved.push({ name: guestName.slice(0, 80), ...(guestEmail ? { email: guestEmail } : {}), status: 'pending' });
    persistLocalGuests();
    name.value = ''; email.value = ''; updateLocalList(); name.focus();
  };
  updateLocalList();

  const guestUrl = d.planId
    ? `/api/plans/${encodeURIComponent(d.planId)}/guests`
    : `/api/rsvp/${encodeURIComponent(d.invite.id)}/guests`;
  const guestOptions = d.planId ? {} : { headers: { 'x-manage-token': d.invite.manageToken } };
  async function loadReplies() {
    try {
      const response = await fetch(guestUrl, guestOptions);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load RSVP responses.');
      replies = payload.guests || [];
      replyError = '';
      repliesLoaded = true;
      updateSummary();
      replyList.replaceChildren();
      replies.forEach((guest) => {
        const li = el('li', 'guest-row');
        const detail = el('div', 'guest-details');
        detail.append(el('strong', '', guest.name), el('span', '', ` · ${guest.attending ? 'Coming' : 'Can’t make it'}${guest.partySize > 1 ? ` · party of ${guest.partySize}` : ''}`));
        const controls = el('div', 'guest-controls');
        const edit = el('button', 'guest-remove', 'Edit reply'); edit.type = 'button';
        edit.onclick = () => {
          const editor = el('form', 'guest-edit-form');
          const replyName = el('input'); replyName.type = 'text'; replyName.required = true; replyName.maxLength = 80; replyName.value = guest.name; replyName.setAttribute('aria-label', 'Respondent name');
          const attending = el('select'); attending.setAttribute('aria-label', 'Attendance');
          [['true', 'Coming'], ['false', 'Can’t make it']].forEach(([value, label]) => {
            const option = el('option', '', label); option.value = value; option.selected = String(guest.attending) === value; attending.append(option);
          });
          const partySize = el('input'); partySize.type = 'number'; partySize.min = '1'; partySize.max = '20'; partySize.required = true; partySize.value = String(guest.partySize); partySize.setAttribute('aria-label', 'Party size');
          const save = el('button', 'text-button', 'Save reply'); save.type = 'submit';
          const cancel = el('button', 'text-button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => loadReplies();
          editor.append(replyName, attending, partySize, save, cancel);
          li.replaceChildren(editor);
          editor.onsubmit = async (event) => {
            event.preventDefault();
            save.disabled = true;
            try {
              const response = await fetch(`${guestUrl}/${encodeURIComponent(guest.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...(d.planId ? {} : guestOptions.headers) },
                body: JSON.stringify({ name: replyName.value, attending: attending.value === 'true', partySize: Number(partySize.value) }),
              });
              const result = await response.json();
              if (!response.ok) throw new Error(result.error || 'Could not update this reply.');
              await loadReplies();
            } catch (error) {
              guestStatus.textContent = error.message;
              save.disabled = false;
            }
          };
          replyName.focus();
        };
        const remove = el('button', 'guest-remove', 'Delete reply'); remove.type = 'button';
        remove.onclick = async () => {
          if (!window.confirm(`Delete ${guest.name}’s RSVP response?`)) return;
          remove.disabled = true;
          try {
            const response = await fetch(`${guestUrl}/${encodeURIComponent(guest.id)}`, {
              method: 'DELETE',
              ...(d.planId ? {} : { headers: guestOptions.headers }),
            });
            const result = response.status === 204 ? {} : await response.json();
            if (!response.ok) throw new Error(result.error || 'Could not delete this reply.');
            await loadReplies();
          } catch (error) {
            guestStatus.textContent = error.message;
            remove.disabled = false;
          }
        };
        controls.append(edit, remove);
        li.append(detail, controls);
        replyList.append(li);
      });
      if (replies.length) list.hidden = false;
    } catch (error) {
      repliesLoaded = true; replyError = error.message; updateSummary();
    }
  }

  const replyList = el('ul', 'guest-list');
  loadReplies();

  s.append(
    el('p', 'section-note', d.planId
      ? 'Add people here, then copy one RSVP link or email it to saved guests. Edit or remove invitees and manage replies as they come in.'
      : 'Add people here, then copy one RSVP link. Edit or remove invitees and manage replies as they come in.'),
    share,
    guestForm,
    guestStatus,
    el('h3', '', 'Invited guests'),
    list,
    summary,
    el('h3', '', 'RSVP replies'),
    replyList,
  );
  return s;
}

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((guest) => guest && typeof guest.name === 'string' && ['pending', 'attending', 'declined'].includes(guest.status)) : [];
  } catch { return []; }
}

function saveList(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* Guest editing remains available for this page even if storage is full. */ }
}

async function showRsvpPage(id) {
  $('#splash-screen').hidden = true;
  $('#login-screen').hidden = true;
  $('#register-screen').hidden = true;
  $('#dashboard-screen').hidden = true;
  $('#account-nav').hidden = true;
  $('#hero').hidden = true; form.hidden = true; $('#loading').hidden = true; $('#result').hidden = true;
  const view = $('#rsvpView'); view.hidden = false; view.replaceChildren(el('p', '', 'Loading your invitation…'));
  try {
    const response = await fetch(`/api/rsvp/${encodeURIComponent(id)}`);
    const event = await response.json();
    if (!response.ok) throw new Error(event.error || 'This invitation is unavailable.');
    view.replaceChildren(el('p', 'chip', 'YOU’RE INVITED'), el('h1', '', event.title), el('p', 'lead', `${new Date(`${event.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${event.city ? ` · ${event.city}` : ''}`), el('p', 'section-note', 'We’d love to celebrate with you. Let us know if you can make it!'));
    const reply = el('form', 'reply-form');
    const name = el('input'); name.type = 'text'; name.name = 'name'; name.maxLength = 80; name.required = true; name.placeholder = 'Your name'; name.setAttribute('aria-label', 'Your name');
    const sizeLabel = el('label', 'f', 'How many in your party?');
    const partySize = el('select'); partySize.name = 'partySize';
    for (let i = 1; i <= 10; i++) { const option = el('option', '', `${i}${i === 1 ? ' guest' : ' guests'}`); option.value = String(i); partySize.append(option); }
    sizeLabel.append(partySize);
    const choice = el('div', 'reply-choices');
    for (const [value, label] of [['yes', 'Joyfully, yes! 🎉'], ['no', 'Sorry, can’t make it']]) {
      const wrap = el('label', 'reply-choice'); const input = el('input'); input.type = 'radio'; input.name = 'attending'; input.value = value; input.required = true;
      wrap.append(input, el('span', '', label)); choice.append(wrap);
    }
    const error = el('p', 'error', ''); const submitReply = el('button', 'btn', 'Send my RSVP'); submitReply.type = 'submit';
    reply.append(name, sizeLabel, choice, error, submitReply);
    reply.onsubmit = async (submitEvent) => {
      submitEvent.preventDefault(); error.textContent = '';
      submitReply.disabled = true;
      try {
        const data = new FormData(reply);
        const result = await fetch(`/api/rsvp/${encodeURIComponent(id)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.get('name'), partySize: Number(data.get('partySize')), attending: data.get('attending') === 'yes' }),
        });
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error || 'Could not send your RSVP.');
        const accepted = data.get('attending') === 'yes';
        view.replaceChildren(
          el('p', 'chip', 'RSVP RECEIVED'),
          el('h1', '', accepted ? 'You’re on the list!' : 'Thanks for letting us know'),
          el('p', 'lead', accepted ? 'Your host will be so happy to hear from you. See you at the celebration!' : 'Your host has your reply. We’ll miss you at the celebration!'),
        );
      } catch (err) { error.textContent = err.message; submitReply.disabled = false; }
    };
    view.append(reply);
  } catch (error) {
    const home = el('a', 'btn ghost', 'Go to Jashn'); home.href = location.pathname;
    view.replaceChildren(el('h1', '', 'Invitation unavailable'), el('p', 'lead', error.message), home);
  }
}

const inviteId = new URLSearchParams(location.search).get('rsvp');
if (inviteId) showRsvpPage(inviteId);

function print_() { window.print(); }
