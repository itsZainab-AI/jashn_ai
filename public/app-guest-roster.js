function createGuestRoster(d, progress, progressReady, progressStatus) {
  const guestForm = el('form', 'guest-form');
  const name = el('input');
  name.type = 'text';
  name.maxLength = 80;
  name.required = true;
  name.placeholder = 'Guest name';
  name.setAttribute('aria-label', 'Guest name');
  const email = el('input');
  email.type = 'email';
  email.maxLength = 254;
  email.placeholder = 'Email (optional)';
  email.setAttribute('aria-label', 'Guest email (optional)');
  name.disabled = !progressReady;
  email.disabled = !progressReady;
  const add = el('button', 'btn', 'Add guest');
  add.type = 'submit';
  add.disabled = !progressReady;
  guestForm.append(name, email, add);
  const list = el('ul', 'guest-list');
  const summary = el('p', 'guest-summary', 'Loading guest responses…');
  const guestStatus = el('p', 'guest-status', '');
  const storageKey = `jashn:guests:${d.invite.id}`;
  const saved = d.planId ? progress.guests : readList(storageKey);
  const replyState = { guests: [], loaded: false, error: '' };

  function persistLocalGuests() {
    if (d.planId) {
      progress.guests = saved;
      queueProgressSave(d.planId, progress, progressStatus);
    } else saveList(storageKey, saved);
  }

  function updateSummary() {
    if (!replyState.loaded) {
      summary.textContent = 'Loading guest responses…';
      return;
    }
    if (replyState.error) {
      summary.textContent = `${saved.length} on your list · ${replyState.error}`;
      return;
    }
    const yes = replyState.guests.filter((guest) => guest.attending).length;
    summary.textContent = `${saved.length} on your list · ${replyState.guests.length} replies (${yes} coming, ${replyState.guests.length - yes} can’t make it)`;
  }

  async function sendInvitation(guest, button, status) {
    button.disabled = true;
    status.textContent = '';
    try {
      await progressSaveQueue;
      const response = await fetchWithAuth(`/api/plans/${encodeURIComponent(d.planId)}/invites`, {
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
      details.append(
        el('strong', '', guest.name),
        el(
          'span',
          '',
          `${guest.email ? ` · ${guest.email}` : ''} · ${guest.status === 'attending' ? 'Going' : guest.status === 'declined' ? 'Can’t make it' : 'Awaiting RSVP'}`,
        ),
      );
      li.append(details);
      const controls = el('div', 'guest-controls');
      const edit = el('button', 'guest-remove', 'Edit');
      edit.type = 'button';
      edit.disabled = !progressReady;
      edit.setAttribute('aria-label', `Edit ${guest.name}`);
      edit.onclick = () => {
        const editor = el('form', 'guest-edit-form');
        const editName = el('input');
        editName.type = 'text';
        editName.required = true;
        editName.maxLength = 80;
        editName.value = guest.name;
        editName.setAttribute('aria-label', 'Guest name');
        const editEmail = el('input');
        editEmail.type = 'email';
        editEmail.maxLength = 254;
        editEmail.value = guest.email || '';
        editEmail.placeholder = 'Email (optional)';
        editEmail.setAttribute('aria-label', 'Guest email (optional)');
        const save = el('button', 'text-button', 'Save');
        save.type = 'submit';
        const cancel = el('button', 'text-button', 'Cancel');
        cancel.type = 'button';
        cancel.onclick = updateLocalList;
        editor.append(editName, editEmail, save, cancel);
        li.replaceChildren(editor);
        editor.onsubmit = (event) => {
          event.preventDefault();
          const nextName = editName.value.trim();
          const nextEmail = editEmail.value.trim().toLowerCase();
          if (!nextName) return;
          saved[index] = {
            ...guest,
            name: nextName.slice(0, 80),
            ...(nextEmail ? { email: nextEmail } : {}),
          };
          if (!nextEmail) delete saved[index].email;
          persistLocalGuests();
          updateLocalList();
        };
        editName.focus();
      };
      controls.append(edit);
      if (d.planId && guest.email) {
        const inviteStatus = el('span', 'invite-status', '');
        const invite = el('button', 'guest-remove', 'Send invitation');
        invite.type = 'button';
        invite.disabled = !progressReady;
        invite.onclick = () => sendInvitation(guest, invite, inviteStatus);
        controls.append(invite, inviteStatus);
      }
      const remove = el('button', 'guest-remove', 'Remove');
      remove.type = 'button';
      remove.disabled = !progressReady;
      remove.setAttribute('aria-label', `Remove ${guest.name}`);
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
      progressStatus.textContent =
        'Your host guest list is full. The limit is 40 names per celebration.';
      return;
    }
    const guestEmail = email.value.trim().toLowerCase();
    saved.push({
      name: guestName.slice(0, 80),
      ...(guestEmail ? { email: guestEmail } : {}),
      status: 'pending',
    });
    persistLocalGuests();
    name.value = '';
    email.value = '';
    updateLocalList();
    name.focus();
  };
  updateLocalList();

  return { guestForm, list, summary, guestStatus, replyState, updateSummary };
}
