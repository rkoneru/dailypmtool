// Default first-run dataset: a "Social Media Marketing Campaign" example.
// uid()-style ids are pre-baked here (not via state.uid) to keep this module
// dependency-free and deterministic.
let idCounter = 0;
const id = (prefix) => `${prefix}${++idCounter}`;

export const GANTT_DAYS = 30;

export const sampleData = {
  projectName: 'Social Media Marketing Campaign',
  objective: 'Grow brand awareness and drive 5,000 site visits via a coordinated multi-channel social campaign.',
  dueDate: '2026-09-30',
  reward: 'Team lunch + campaign highlight reel shared company-wide.',
  notes:
    'Kickoff call held 9/1 with marketing + design.\n' +
    'Waiting on legal sign-off for influencer contracts (expected 9/10).\n' +
    'Revisit ad spend split after week 1 performance data.',

  milestones: [
    { id: id('m'), text: 'Creative assets approved', progress: 5, due: '2026-09-05', done: true },
    { id: id('m'), text: 'Campaign launch', progress: 3, due: '2026-09-08', done: false },
    { id: id('m'), text: 'Mid-campaign performance review', progress: 1, due: '2026-09-18', done: false },
    { id: id('m'), text: 'Campaign wrap + report', progress: 0, due: '2026-09-30', done: false },
  ],

  gantt: [
    { id: id('g'), name: 'Creative production', type: 'check', cells: [1, 2, 3, 4, 5] },
    { id: id('g'), name: 'Campaign launch', type: 'diamond', cells: [8] },
    { id: id('g'), name: 'Paid ads live', type: 'check', cells: [8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26] },
    { id: id('g'), name: 'Influencer posts', type: 'check', cells: [9, 16, 23] },
    { id: id('g'), name: 'Mid-campaign review', type: 'diamond', cells: [18] },
    { id: id('g'), name: 'Campaign wrap', type: 'diamond', cells: [30] },
  ],

  tasks: [
    { id: id('t'), task: 'Finalize campaign brief', start: '2026-09-01', end: '2026-09-02', prio: 'High', done: true },
    { id: id('t'), task: 'Design ad creatives', start: '2026-09-02', end: '2026-09-05', prio: 'High', done: true },
    { id: id('t'), task: 'Set up ad accounts & tracking', start: '2026-09-03', end: '2026-09-06', prio: 'Medium', done: false },
    { id: id('t'), task: 'Draft influencer briefs', start: '2026-09-04', end: '2026-09-07', prio: 'Medium', done: false },
    { id: id('t'), task: 'Launch campaign', start: '2026-09-08', end: '2026-09-08', prio: 'High', done: false },
    { id: id('t'), task: 'Weekly performance report', start: '2026-09-12', end: '2026-09-12', prio: 'Low', done: false },
  ],

  dashDate: '2026-09-08',
  dashStatus: 'ON TRACK',
  dashSummary: 'Campaign remains on track with creative approvals complete and launch timing intact.',
  budgetPlanned: 25000,
  budgetActual: 18500,
  pending: { decisions: 2, actions: 5, changeRequests: 1 },

  dashTasks: [
    {
      id: id('d'), name: 'Campaign strategy & brief', assigned: 'Priya N.',
      start: '2026-09-01', end: '2026-09-02', status: 'Complete', prio: 'High',
      comments: 'Signed off by marketing lead.',
    },
    {
      id: id('d'), name: 'Creative asset design', assigned: 'Marcus T.',
      start: '2026-09-02', end: '2026-09-05', status: 'Complete', prio: 'High',
      comments: 'All variants approved.',
    },
    {
      id: id('d'), name: 'Ad account & tracking setup', assigned: 'Jordan K.',
      start: '2026-09-03', end: '2026-09-06', status: 'In Progress', prio: 'Medium',
      comments: 'Pixel verification pending.',
    },
    {
      id: id('d'), name: 'Influencer contracts', assigned: 'Priya N.',
      start: '2026-09-04', end: '2026-09-10', status: 'On Hold', prio: 'Medium',
      comments: 'Waiting on legal sign-off.',
    },
    {
      id: id('d'), name: 'Paid ad launch', assigned: 'Jordan K.',
      start: '2026-09-08', end: '2026-09-26', status: 'In Progress', prio: 'High',
      comments: 'Live on Meta + TikTok.',
    },
    {
      id: id('d'), name: 'Influencer posts', assigned: 'Marcus T.',
      start: '2026-09-09', end: '2026-09-23', status: 'Not Started', prio: 'Medium',
      comments: 'Blocked on contracts.',
    },
    {
      id: id('d'), name: 'Weekly reporting', assigned: 'Priya N.',
      start: '2026-09-12', end: '2026-09-30', status: 'Not Started', prio: 'Low',
      comments: '',
    },
    {
      id: id('d'), name: 'Mid-campaign optimization', assigned: 'Jordan K.',
      start: '2026-09-14', end: '2026-09-18', status: 'Overdue', prio: 'High',
      comments: 'Needs budget reallocation decision.',
    },
    {
      id: id('d'), name: 'Campaign wrap report', assigned: 'Priya N.',
      start: '2026-09-27', end: '2026-09-30', status: 'Not Started', prio: 'Medium',
      comments: '',
    },
  ],
};
