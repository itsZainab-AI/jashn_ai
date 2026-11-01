function section(title) {
  const element = el('section', 'reveal');
  element.append(el('h2', '', title));
  return element;
}

function renderPlanOverview(d) {
  const elements = [];
  if (d.planId) {
    elements.push(
      el('p', 'saved-notice', 'Saved to your account · open it anytime from My celebrations.'),
    );
  }
  if ($('#account-status').textContent) {
    elements.push(el('p', 'saved-notice', $('#account-status').textContent));
  }
  const hero = el('div', 'themeCard');
  hero.append(el('h2', '', d.ai.theme), el('p', '', d.ai.tagline));
  hero.append(el('small', '', `${inr.format(d.budget.perGuest)} per guest`));
  elements.push(hero);
  return elements;
}

function renderBudget(d) {
  const budget = section('Where the money goes');
  d.budget.rows.forEach((rowData) => {
    const row = el('div', 'row');
    const track = el('div', 'track');
    const fill = el('b');
    fill.style.setProperty('--w', `${rowData.pct * 3}%`);
    track.append(fill);
    row.append(el('span', '', rowData.name), track, el('span', '', inr.format(rowData.amount)));
    budget.append(row);
    requestAnimationFrame(() =>
      setTimeout(() => {
        fill.style.width = `${Math.min(100, rowData.pct * 3)}%`;
      }, 400),
    );
  });
  budget.append(el('p', '', `Total: ${inr.format(d.budget.total)}`));
  return budget;
}

function renderTimeline(d) {
  const timeline = section('Your timeline');
  const list = el('ul', 'tl');
  d.timeline.forEach((milestone) => {
    const item = el('li');
    const date = new Date(milestone.due).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    item.append(el('time', '', date), el('span', '', milestone.task));
    list.append(item);
  });
  timeline.append(list);
  return timeline;
}

function renderChecklist(d, progress, progressReady, progressStatus) {
  const key = `jashn:${d.event.type}:${d.event.date}`;
  let saved = d.planId ? progress.checkedChecklist : [];
  if (!d.planId) {
    try {
      saved = JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      // Ignore malformed guest-mode checklist data and start with an empty checklist.
    }
  }

  const checklist = section('Vendor checklist');
  const box = el('div', 'chk');
  d.checklist.forEach((checklistItem) => {
    const label = el('label');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = saved.includes(checklistItem.id);
    input.disabled = !progressReady;
    input.onchange = () => {
      const checkedIds = [...box.querySelectorAll('input')].flatMap((checkbox, index) =>
        checkbox.checked ? [index] : [],
      );
      if (d.planId) {
        progress.checkedChecklist = checkedIds;
        queueProgressSave(d.planId, progress, progressStatus);
      } else {
        try {
          localStorage.setItem(key, JSON.stringify(checkedIds));
        } catch {
          $('#account-status').textContent = 'Could not save checklist progress in this browser.';
        }
      }
      if (checkedIds.length === d.checklist.length) burst();
    };
    label.append(input, el('span', '', checklistItem.item));
    box.append(label);
  });
  checklist.append(box);
  return checklist;
}

function renderIdeas(d) {
  const ideas = section('Ideas just for you');
  const grid = el('div', 'ideas');
  d.ai.ideas.forEach((idea) => {
    const card = el('article', 'idea');
    card.append(el('h3', '', idea.title), el('p', '', idea.detail));
    grid.append(card);
  });
  ideas.append(grid);
  return ideas;
}

function renderActions(d) {
  const actions = el('div', 'actions reveal');
  const print = el('button', 'btn', 'Save as PDF');
  print.onclick = () => print_();
  const again = el('button', 'btn ghost', 'Plan another');
  again.onclick = () => showScreen('hero');
  actions.append(print, again);
  if (currentUser && d.planId) {
    const plans = el('button', 'btn ghost', 'My celebrations');
    plans.onclick = loadDashboard;
    actions.append(plans);
  }
  return actions;
}
