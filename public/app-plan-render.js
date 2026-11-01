async function render(d) {
  for (const id of [
    'splash-screen',
    'hero',
    'login-screen',
    'register-screen',
    'dashboard-screen',
  ]) {
    $(`#${id}`).hidden = true;
  }
  $('#account-nav').hidden = !currentUser;
  $('#loading').hidden = true;
  const output = $('#result');
  output.replaceChildren();
  output.hidden = false;

  const progressState = await loadPlanProgress(d, output);
  output.append(...renderPlanOverview(d));
  output.append(
    renderVenues(d),
    renderGuests(
      d,
      progressState.progress,
      progressState.progressReady,
      progressState.progressStatus,
    ),
    renderBudget(d),
    renderTimeline(d),
    renderChecklist(
      d,
      progressState.progress,
      progressState.progressReady,
      progressState.progressStatus,
    ),
    renderIdeas(d),
    el('p', 'toast reveal', d.ai.toast ? `“${d.ai.toast}”` : ''),
    renderActions(d),
  );

  burst();
  output.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('in')),
    { threshold: 0.1 },
  );
  output.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
}

async function loadPlanProgress(d, output) {
  const progressState = {
    progress: { checkedChecklist: [], guests: [] },
    progressReady: !d.planId,
    progressStatus: el('p', 'progress-status', ''),
  };
  if (!d.planId) return progressState;

  progressState.progressStatus.textContent = 'Loading saved checklist and guest list…';
  output.append(progressState.progressStatus);
  try {
    const response = await fetchWithAuth(`/api/plans/${encodeURIComponent(d.planId)}/progress`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load saved progress.');
    progressState.progress = result.progress;
    progressState.progressReady = true;
    progressState.progressStatus.textContent = '';
  } catch (error) {
    progressState.progressStatus.dataset.unavailable = 'true';
    const retry = el('button', 'text-button', 'Retry');
    retry.type = 'button';
    retry.onclick = () => openSavedPlan(d.planId);
    progressState.progressStatus.replaceChildren(
      el('span', '', `${error.message} Your saved progress is protected until it loads.`),
      retry,
    );
  }
  return progressState;
}
