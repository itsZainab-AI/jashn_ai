$('#dashboard-plan').onclick = () => showScreen('hero');
$('#logout').onclick = async () => {
  const logout = $('#logout');
  logout.disabled = true;
  try {
    const response = await fetchWithAuth('/api/auth/logout', { method: 'POST' });
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
    const response = await fetchWithAuth('/api/plans');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load your plans.');
    status.textContent = result.plans.length ? '' : 'Your saved celebrations will appear here.';
    if (!result.plans.length) {
      cards.append(
        el('p', 'empty-plans', 'No plans yet — your next big idea starts with one click.'),
      );
      return;
    }
    result.plans.forEach((plan) => {
      const card = el('article', 'saved-plan');
      const title = `${plan.event_type[0].toUpperCase()}${plan.event_type.slice(1)} celebration`;
      const date = new Date(`${plan.event_date}T00:00:00`).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
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
    const response = await fetchWithAuth(`/api/plans/${encodeURIComponent(id)}`);
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
    if (result.user) setUser(result.user);
    else setUser(null);
  })
  .catch(() => {
    $('#account-status').textContent =
      'Your account session could not be checked. You can still explore as a guest.';
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
  })
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not verify your email.');
      setUser(result.user);
      showScreen('hero');
      $('#account-status').textContent = 'Email verified — you’re all set!';
    })
    .catch((error) => {
      $('#verification-message').textContent = error.message;
    });
} else if (passwordResetToken) {
  history.replaceState(null, '', location.pathname);
  showAccountPanel('reset-complete-panel');
}

// floating emojis in the background
if (!reduce)
  for (let i = 0; i < 12; i++) {
    const s = el('span', '', ['🎈', '✨', '🎉', '💖', '🌸'][i % 5]);
    s.style.cssText = `left:${Math.random() * 100}%;animation-duration:${14 + Math.random() * 14}s;animation-delay:${-Math.random() * 20}s`;
    $('#floaters').append(s);
  }
$('#date').min = new Date().toISOString().slice(0, 10);
