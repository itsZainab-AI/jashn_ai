function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value)
      ? value.filter(
          (guest) =>
            guest &&
            typeof guest.name === 'string' &&
            ['pending', 'attending', 'declined'].includes(guest.status),
        )
      : [];
  } catch {
    return [];
  }
}

function saveList(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Guest editing remains available for this page even if storage is full. */
  }
}

async function showRsvpPage(id) {
  $('#splash-screen').hidden = true;
  $('#login-screen').hidden = true;
  $('#register-screen').hidden = true;
  $('#dashboard-screen').hidden = true;
  $('#account-nav').hidden = true;
  $('#hero').hidden = true;
  form.hidden = true;
  $('#loading').hidden = true;
  $('#result').hidden = true;
  const view = $('#rsvpView');
  view.hidden = false;
  view.replaceChildren(el('p', '', 'Loading your invitation…'));
  try {
    const response = await fetch(`/api/rsvp/${encodeURIComponent(id)}`);
    const event = await response.json();
    if (!response.ok) throw new Error(event.error || 'This invitation is unavailable.');
    view.replaceChildren(
      el('p', 'chip', 'YOU’RE INVITED'),
      el('h1', '', event.title),
      el(
        'p',
        'lead',
        `${new Date(`${event.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${event.city ? ` · ${event.city}` : ''}`,
      ),
      el('p', 'section-note', 'We’d love to celebrate with you. Let us know if you can make it!'),
    );
    const reply = el('form', 'reply-form');
    const name = el('input');
    name.type = 'text';
    name.name = 'name';
    name.maxLength = 80;
    name.required = true;
    name.placeholder = 'Your name';
    name.setAttribute('aria-label', 'Your name');
    const sizeLabel = el('label', 'f', 'How many in your party?');
    const partySize = el('select');
    partySize.name = 'partySize';
    for (let i = 1; i <= 10; i++) {
      const option = el('option', '', `${i}${i === 1 ? ' guest' : ' guests'}`);
      option.value = String(i);
      partySize.append(option);
    }
    sizeLabel.append(partySize);
    const choice = el('div', 'reply-choices');
    for (const [value, label] of [
      ['yes', 'Joyfully, yes! 🎉'],
      ['no', 'Sorry, can’t make it'],
    ]) {
      const wrap = el('label', 'reply-choice');
      const input = el('input');
      input.type = 'radio';
      input.name = 'attending';
      input.value = value;
      input.required = true;
      wrap.append(input, el('span', '', label));
      choice.append(wrap);
    }
    const error = el('p', 'error', '');
    const submitReply = el('button', 'btn', 'Send my RSVP');
    submitReply.type = 'submit';
    reply.append(name, sizeLabel, choice, error, submitReply);
    reply.onsubmit = async (submitEvent) => {
      submitEvent.preventDefault();
      error.textContent = '';
      submitReply.disabled = true;
      try {
        const data = new FormData(reply);
        const result = await fetch(`/api/rsvp/${encodeURIComponent(id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: data.get('name'),
            partySize: Number(data.get('partySize')),
            attending: data.get('attending') === 'yes',
          }),
        });
        const payload = await result.json();
        if (!result.ok) throw new Error(payload.error || 'Could not send your RSVP.');
        const accepted = data.get('attending') === 'yes';
        view.replaceChildren(
          el('p', 'chip', 'RSVP RECEIVED'),
          el('h1', '', accepted ? 'You’re on the list!' : 'Thanks for letting us know'),
          el(
            'p',
            'lead',
            accepted
              ? 'Your host will be so happy to hear from you. See you at the celebration!'
              : 'Your host has your reply. We’ll miss you at the celebration!',
          ),
        );
      } catch (err) {
        error.textContent = err.message;
        submitReply.disabled = false;
      }
    };
    view.append(reply);
  } catch (error) {
    const home = el('a', 'btn ghost', 'Go to Jashn');
    home.href = location.pathname;
    view.replaceChildren(
      el('h1', '', 'Invitation unavailable'),
      el('p', 'lead', error.message),
      home,
    );
  }
}

const inviteId = new URLSearchParams(location.search).get('rsvp');
if (inviteId) showRsvpPage(inviteId);

function print_() {
  window.print();
}
