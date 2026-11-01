'use strict';

/**
 * Reads the RSVP event ID stored inside a saved plan record.
 * @param {{plan_json: string}} saved Saved-plan row.
 * @returns {string} RSVP event ID.
 */
function savedPlanEvent(saved) {
  return JSON.parse(saved.plan_json).invite.id;
}

module.exports = { savedPlanEvent };
