'use strict';

const TYPES = ['wedding', 'birthday', 'community'];

const SPLITS = {
  wedding: {
    Venue: 0.3,
    Catering: 0.28,
    'Photo & Video': 0.1,
    'Decor & Flowers': 0.1,
    'Attire & Beauty': 0.08,
    'Music & Dance': 0.06,
    Invitations: 0.03,
    'Oops Buffer': 0.05,
  },
  birthday: {
    Venue: 0.2,
    Catering: 0.3,
    Decor: 0.15,
    Cake: 0.08,
    Entertainment: 0.15,
    'Return Gifts': 0.06,
    Photos: 0.03,
    'Oops Buffer': 0.03,
  },
  community: {
    Venue: 0.2,
    'Food & Water': 0.3,
    'Sound & Stage': 0.15,
    Promotion: 0.1,
    'Supplies & Volunteers': 0.1,
    'Permits & Safety': 0.05,
    'Oops Buffer': 0.1,
  },
};

const MILESTONES = {
  wedding: [
    [26, 'Lock the date and venue'],
    [22, 'Book photographer and caterer'],
    [16, 'Send save the dates, start outfit shopping'],
    [10, 'Finalise menu, decor and music'],
    [6, 'Send invites and track RSVPs'],
    [2, 'Final headcount and vendor payments'],
    [0, 'Wedding day. Phone off, heart on'],
  ],
  birthday: [
    [8, 'Pick the theme and venue'],
    [6, 'Book entertainer or DJ, order cake'],
    [4, 'Send invites'],
    [2, 'Confirm RSVPs, buy return gifts'],
    [1, 'Confirm every vendor'],
    [0, 'Party time'],
  ],
  community: [
    [10, 'Define goal and apply for permits'],
    [8, 'Lock venue and core volunteers'],
    [6, 'Sponsors, sound and stage booking'],
    [3, 'Start promotion and registrations'],
    [1, 'Run through safety and crowd plan'],
    [0, 'Event day'],
  ],
};

const CHECKLISTS = {
  wedding: [
    'Venue and mandap or stage',
    'Caterer with tasting done',
    'Photographer and videographer',
    'Decorator and florist',
    'Makeup artist and mehendi',
    'DJ, band or sangeet choreographer',
    'Invitations and printing',
    'Guest stay and transport',
    'Priest or officiant',
    'Return gifts and day-of emergency kit',
  ],
  birthday: [
    'Venue or home setup',
    'Cake or dessert table',
    'Caterer or snack plan',
    'Decor and balloons',
    'Entertainer, games or DJ',
    'Photographer or photo corner',
    'Invites and RSVP list',
    'Return gifts',
  ],
  community: [
    'Venue and permission letters',
    'Sound system and mic',
    'Stage and seating',
    'Food and water supplier',
    'Volunteer roster with roles',
    'First aid and safety lead',
    'Posters and social media posts',
    'Cleanup crew',
  ],
};

module.exports = { TYPES, SPLITS, MILESTONES, CHECKLISTS };
