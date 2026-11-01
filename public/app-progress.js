let progressSaveQueue = Promise.resolve();
function queueProgressSave(planId, progress, status) {
  if (status.dataset.unavailable) return;
  const snapshot = {
    checkedChecklist: [...progress.checkedChecklist],
    guests: progress.guests.map((guest) => ({ ...guest })),
  };
  progressSaveQueue = progressSaveQueue
    .then(async () => {
      const response = await fetchWithAuth(`/api/plans/${encodeURIComponent(planId)}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save your progress.');
      status.textContent = '';
    })
    .catch((error) => {
      status.textContent = `${error.message} Your latest changes may not be saved.`;
    });
}
