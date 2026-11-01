function burst() {
  if (reduce) return;
  const colors = ['#ff5fa2', '#b69bff', '#ffb48a', '#ffd86b'];
  for (let i = 0; i < 60; i++) {
    const c = el('i', 'confetti');
    c.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % 4]};--x:${(Math.random() - 0.5) * 300}px;animation-delay:${Math.random() * 0.6}s`;
    document.body.append(c);
    setTimeout(() => c.remove(), 3500);
  }
}

function show(n) {
  step = n;
  steps.forEach((s, k) => {
    s.hidden = k !== n;
  });
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
  if (step === 0 && !form.type.value)
    return void ($('#error').textContent = 'Pick one to continue, bestie.');
  if (bad && step > 0) {
    $('#error').textContent = bad.validationMessage || 'Please check this field.';
    return bad.focus();
  }
  step < steps.length - 1 ? show(step + 1) : submit();
};

async function submit() {
  form.hidden = true;
  $('#loading').hidden = false;
  const msgs = [
    'Warming up the confetti cannons...',
    'Haggling with imaginary caterers...',
    'Picking the perfect fairy lights...',
  ];
  let m = 0;
  const t = setInterval(() => {
    $('#loadMsg').textContent = msgs[++m % msgs.length];
  }, 1800);
  try {
    const res = await fetchWithAuth('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.errors || ['Something went wrong.']).join(' '));
    if (data.planId && !currentUser) {
      try {
        const sessionResponse = await fetch('/api/auth/me');
        const session = await sessionResponse.json();
        if (!sessionResponse.ok)
          throw new Error(session.error || 'Could not check account session.');
        if (session.user) setUser(session.user);
      } catch {
        $('#account-status').textContent =
          'Your plan was saved, but the account session could not be checked. Reload before opening My celebrations.';
      }
    }
    await render(data);
  } catch (e) {
    $('#loading').hidden = true;
    form.hidden = false;
    show(1);
    $('#error').textContent = e.message;
  } finally {
    clearInterval(t);
  }
}
