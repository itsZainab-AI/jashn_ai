'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  closeServer,
  createAuthenticatedUser,
  database,
  post,
  setEmailDeliveryFailure,
  startServer,
} = require('./support');

const good = {
  type: 'wedding',
  guests: 150,
  budget: 1_500_000,
  date: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10),
  city: 'Pune',
  vibe: 'pastel',
};

test('saved plans, progress, invitations, and ownership remain isolated', async () => {
  const { server, base } = startServer();
  try {
    const owner = await createAuthenticatedUser('Aarav Sharma', 'aarav@example.com');
    assert.equal((await fetch(`${base}/api/plans`)).status, 401);

    const planResponse = await post(base, '/api/plan', good, owner.cookie);
    const plan = await planResponse.json();
    assert.equal(planResponse.status, 200);
    assert.ok(plan.planId);
    const plans = await fetch(`${base}/api/plans`, { headers: { Cookie: owner.cookie } });
    assert.equal((await plans.json()).plans.length, 1);

    const savedResponse = await fetch(`${base}/api/plans/${plan.planId}`, {
      headers: { Cookie: owner.cookie },
    });
    const savedPlan = await savedResponse.json();
    assert.equal(savedPlan.invite.id, plan.invite.id);
    assert.equal(savedPlan.invite.manageToken, undefined);
    assert.equal(
      (
        await fetch(`${base}/api/plans/${plan.planId}/guests`, {
          headers: { Cookie: owner.cookie },
        })
      ).status,
      200,
    );

    await post(base, `/api/rsvp/${plan.invite.id}`, {
      name: 'Mira',
      attending: true,
      partySize: 2,
    });
    const guestResponse = await fetch(`${base}/api/plans/${plan.planId}/guests`, {
      headers: { Cookie: owner.cookie },
    });
    const guest = (await guestResponse.json()).guests[0];
    assert.equal(guest.name, 'Mira');
    assert.ok(Number.isInteger(guest.id));

    const updateReply = await fetch(`${base}/api/plans/${plan.planId}/guests/${guest.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ name: 'Mira Sharma', attending: false, partySize: 3 }),
    });
    assert.equal(updateReply.status, 200);
    const editedReplies = await fetch(`${base}/api/plans/${plan.planId}/guests`, {
      headers: { Cookie: owner.cookie },
    });
    assert.deepEqual((await editedReplies.json()).guests[0], {
      ...guest,
      name: 'Mira Sharma',
      attending: false,
      partySize: 3,
    });
    const invalidReply = await fetch(`${base}/api/plans/${plan.planId}/guests/${guest.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ name: '', attending: 'maybe', partySize: 21 }),
    });
    assert.equal(invalidReply.status, 400);

    const progressUrl = `${base}/api/plans/${plan.planId}/progress`;
    const emptyProgress = await fetch(progressUrl, { headers: { Cookie: owner.cookie } });
    assert.deepEqual((await emptyProgress.json()).progress, {
      checkedChecklist: [],
      guests: [],
    });
    const progress = {
      checkedChecklist: [0, 2],
      guests: [{ name: 'Aarav Sharma', email: 'aarav.invited@example.com', status: 'pending' }],
    };
    const savedProgress = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify(progress),
    });
    assert.equal(savedProgress.status, 200);
    assert.deepEqual(
      (
        await fetch(progressUrl, {
          headers: { Cookie: owner.cookie },
        }).then((response) => response.json())
      ).progress,
      progress,
    );
    const invalidProgress = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({ ...progress, checkedChecklist: [999] }),
    });
    assert.equal(invalidProgress.status, 400);
    const invalidGuest = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: owner.cookie },
      body: JSON.stringify({
        ...progress,
        guests: [{ name: 'Aarav', email: 'not-an-email', status: 'pending' }],
      }),
    });
    assert.equal(invalidGuest.status, 400);

    const invitation = await post(
      base,
      `/api/plans/${plan.planId}/invites`,
      { name: 'Aarav Sharma', email: 'aarav.invited@example.com' },
      owner.cookie,
    );
    assert.equal(invitation.status, 200);
    assert.equal((await invitation.json()).message, 'Invitation sent.');

    setEmailDeliveryFailure(true);
    const originalError = console.error;
    console.error = () => {};
    let failedInvitation;
    try {
      failedInvitation = await post(
        base,
        `/api/plans/${plan.planId}/invites`,
        { name: 'Aarav Sharma', email: 'aarav.invited@example.com' },
        owner.cookie,
      );
    } finally {
      setEmailDeliveryFailure(false);
      console.error = originalError;
    }
    assert.equal(failedInvitation.status, 503);
    const unlistedInvitation = await post(
      base,
      `/api/plans/${plan.planId}/invites`,
      { name: 'Someone Else', email: 'else@example.com' },
      owner.cookie,
    );
    assert.equal(unlistedInvitation.status, 400);

    const other = await createAuthenticatedUser('Mira', 'mira@example.com');
    const otherPlan = await fetch(`${base}/api/plans/${plan.planId}`, {
      headers: { Cookie: other.cookie },
    });
    assert.equal(otherPlan.status, 404);
    const otherGuests = await fetch(`${base}/api/plans/${plan.planId}/guests`, {
      headers: { Cookie: other.cookie },
    });
    assert.equal(otherGuests.status, 404);
    assert.equal((await fetch(progressUrl, { headers: { Cookie: other.cookie } })).status, 404);
    const otherDelete = await fetch(`${base}/api/plans/${plan.planId}/guests/${guest.id}`, {
      method: 'DELETE',
      headers: { Cookie: other.cookie },
    });
    assert.equal(otherDelete.status, 404);

    const deleteReply = await fetch(`${base}/api/plans/${plan.planId}/guests/${guest.id}`, {
      method: 'DELETE',
      headers: { Cookie: owner.cookie },
    });
    assert.equal(deleteReply.status, 200);
    const storedOwner = database.statements.getUser.get(owner.id);
    assert.equal(storedOwner.email, 'aarav@example.com');
  } finally {
    await closeServer(server);
  }
});
