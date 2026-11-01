function renderGuests(d, progress, progressReady, progressStatus) {
  const s = section('Your guest list & RSVP link');
  const inviteUrl = new URL(location.href);
  inviteUrl.search = '';
  inviteUrl.hash = '';
  inviteUrl.searchParams.set('rsvp', d.invite.id);
  const share = el('div', 'share-box');
  const linkLabel = el('label', 'f', 'Share this private RSVP link');
  const linkInput = el('input');
  linkInput.type = 'url';
  linkInput.readOnly = true;
  linkInput.value = inviteUrl.href;
  linkLabel.append(linkInput);
  const copy = el('button', 'btn ghost', 'Copy RSVP link');
  copy.type = 'button';
  const copyStatus = el('span', 'copy-status', '');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl.href);
      copyStatus.textContent = 'Copied — send it to your guests!';
    } catch {
      copyStatus.textContent = 'Copy isn’t available here. Select the link above and copy it.';
      linkInput.focus();
      linkInput.select();
    }
  };
  share.append(linkLabel, copy, copyStatus);

  const roster = createGuestRoster(d, progress, progressReady, progressStatus);

  const guestUrl = d.planId
    ? `/api/plans/${encodeURIComponent(d.planId)}/guests`
    : `/api/rsvp/${encodeURIComponent(d.invite.id)}/guests`;
  const guestOptions = d.planId ? {} : { headers: { 'x-manage-token': d.invite.manageToken } };
  const replyList = renderReplies({
    d,
    guestUrl,
    guestOptions,
    guestStatus: roster.guestStatus,
    list: roster.list,
    replyState: roster.replyState,
    updateSummary: roster.updateSummary,
  });
  s.append(
    el(
      'p',
      'section-note',
      d.planId
        ? 'Add people here, then copy one RSVP link or email it to saved guests. Edit or remove invitees and manage replies as they come in.'
        : 'Add people here, then copy one RSVP link. Edit or remove invitees and manage replies as they come in.',
    ),
    share,
    roster.guestForm,
    roster.guestStatus,
    el('h3', '', 'Invited guests'),
    roster.list,
    roster.summary,
    el('h3', '', 'RSVP replies'),
    replyList,
  );
  return s;
}
