function renderReplies({
  d,
  guestUrl,
  guestOptions,
  guestStatus,
  list,
  replyState,
  updateSummary,
}) {
  const replyList = el('ul', 'guest-list');
  async function loadReplies() {
    try {
      const response = await fetch(guestUrl, guestOptions);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load RSVP responses.');
      replyState.guests = payload.guests || [];
      replyState.error = '';
      replyState.loaded = true;
      updateSummary();
      replyList.replaceChildren();
      replyState.guests.forEach((guest) => {
        const li = el('li', 'guest-row');
        const detail = el('div', 'guest-details');
        detail.append(
          el('strong', '', guest.name),
          el(
            'span',
            '',
            ` · ${guest.attending ? 'Coming' : 'Can’t make it'}${guest.partySize > 1 ? ` · party of ${guest.partySize}` : ''}`,
          ),
        );
        const controls = el('div', 'guest-controls');
        const edit = el('button', 'guest-remove', 'Edit reply');
        edit.type = 'button';
        edit.onclick = () => {
          const editor = el('form', 'guest-edit-form');
          const replyName = el('input');
          replyName.type = 'text';
          replyName.required = true;
          replyName.maxLength = 80;
          replyName.value = guest.name;
          replyName.setAttribute('aria-label', 'Respondent name');
          const attending = el('select');
          attending.setAttribute('aria-label', 'Attendance');
          [
            ['true', 'Coming'],
            ['false', 'Can’t make it'],
          ].forEach(([value, label]) => {
            const option = el('option', '', label);
            option.value = value;
            option.selected = String(guest.attending) === value;
            attending.append(option);
          });
          const partySize = el('input');
          partySize.type = 'number';
          partySize.min = '1';
          partySize.max = '20';
          partySize.required = true;
          partySize.value = String(guest.partySize);
          partySize.setAttribute('aria-label', 'Party size');
          const save = el('button', 'text-button', 'Save reply');
          save.type = 'submit';
          const cancel = el('button', 'text-button', 'Cancel');
          cancel.type = 'button';
          cancel.onclick = () => loadReplies();
          editor.append(replyName, attending, partySize, save, cancel);
          li.replaceChildren(editor);
          editor.onsubmit = async (event) => {
            event.preventDefault();
            save.disabled = true;
            try {
              const response = await fetchWithAuth(`${guestUrl}/${encodeURIComponent(guest.id)}`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  ...(d.planId ? {} : guestOptions.headers),
                },
                body: JSON.stringify({
                  name: replyName.value,
                  attending: attending.value === 'true',
                  partySize: Number(partySize.value),
                }),
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
        const remove = el('button', 'guest-remove', 'Delete reply');
        remove.type = 'button';
        remove.onclick = async () => {
          if (!window.confirm(`Delete ${guest.name}’s RSVP response?`)) return;
          remove.disabled = true;
          try {
            const response = await fetchWithAuth(`${guestUrl}/${encodeURIComponent(guest.id)}`, {
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
      if (replyState.guests.length) list.hidden = false;
    } catch (error) {
      replyState.loaded = true;
      replyState.error = error.message;
      updateSummary();
    }
  }

  loadReplies();
  return replyList;
}
