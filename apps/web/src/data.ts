import { defaultMeetingSections, scorecardTrendFor, weekStartDateFor } from './types';
import type {
  AuditEvent,
  Headline,
  Issue,
  IssueAgeBand,
  IssueTransfer,
  MeetingInstance,
  Notification,
  Rock,
  RockTask,
  ScorecardMetric,
  ScorecardResult,
  Team,
  TeamMessage,
  TeamMembership,
  Todo,
  User,
  Workspace,
} from './types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * DAY).toISOString();
const today = new Date(now).toISOString().slice(0, 10);
const currentWeekStartDate = weekStartDateFor(new Date(now));
const previousWeekStartDate = weekStartDateFor(new Date(new Date(currentWeekStartDate).getTime() - 7 * DAY));

export const defaultAgeBand = (ageInDays: number): IssueAgeBand => {
  if (ageInDays >= 30) return 'critical';
  if (ageInDays >= 14) return 'stale';
  if (ageInDays >= 7) return 'aging';
  return 'fresh';
};

const users: User[] = [
  {
    id: 'ava-khan', name: 'Ava Khan', initials: 'AK', email: 'ava.khan@bremmar.example', accent: '#007E32', active: true,
    platformCapabilities: ['PlatformAdmin'], createdAt: daysAgo(140), updatedAt: daysAgo(1),
  },
  {
    id: 'marcus-lee', name: 'Marcus Lee', initials: 'ML', email: 'marcus.lee@bremmar.example', accent: '#6787b7', active: true,
    platformCapabilities: [], createdAt: daysAgo(135), updatedAt: daysAgo(4),
  },
  {
    id: 'priya-shah', name: 'Priya Shah', initials: 'PS', email: 'priya.shah@bremmar.example', accent: '#9c7baf', active: true,
    platformCapabilities: [], createdAt: daysAgo(130), updatedAt: daysAgo(3),
  },
  {
    id: 'daniel-cho', name: 'Daniel Cho', initials: 'DC', email: 'daniel.cho@bremmar.example', accent: '#4c8f86', active: true,
    platformCapabilities: [], createdAt: daysAgo(120), updatedAt: daysAgo(2),
  },
  {
    id: 'maria-ortiz', name: 'Maria Ortiz', initials: 'MO', email: 'maria.ortiz@bremmar.example', accent: '#d0a15b', active: true,
    platformCapabilities: [], createdAt: daysAgo(115), updatedAt: daysAgo(5),
  },
  {
    id: 'jon-bell', name: 'Jon Bell', initials: 'JB', email: 'jon.bell@bremmar.example', accent: '#6b63ad', active: true,
    platformCapabilities: [], createdAt: daysAgo(110), updatedAt: daysAgo(5),
  },
  {
    id: 'maya-green', name: 'Maya Green', initials: 'MG', email: 'maya.green@bremmar.example', accent: '#c17872', active: true,
    platformCapabilities: [], createdAt: daysAgo(95), updatedAt: daysAgo(7),
  },
];

const teams: Team[] = [
  {
    id: 'leadership', name: 'Leadership Team', shortName: 'Leadership', description: 'Company-wide operating rhythm and cross-functional priorities.',
    parentTeamId: null, nodeType: 'operational', memberCount: 4, meetingDay: 'Monday', meetingTime: '9:00 AM', accent: '#007E32', initials: 'LT', active: true, meetingSections: defaultMeetingSections(), escalationUserIds: ['ava-khan'],
  },
  {
    id: 'professional-services', name: 'Professional Services', shortName: 'Prof. Services', description: 'Client-facing expertise, delivery quality, and specialist capability.',
    parentTeamId: 'leadership', nodeType: 'operational', memberCount: 2, meetingDay: 'Tuesday', meetingTime: '9:00 AM', accent: '#4c8f86', initials: 'PS', active: true, meetingSections: defaultMeetingSections(), escalationUserIds: ['ava-khan', 'marcus-lee'],
  },
  {
    id: 'projects', name: 'Projects', shortName: 'Projects', description: 'Predictable project delivery from kickoff through first value.',
    parentTeamId: 'professional-services', nodeType: 'operational', memberCount: 2, meetingDay: 'Tuesday', meetingTime: '10:30 AM', accent: '#568e85', initials: 'PR', active: true, meetingSections: defaultMeetingSections(), escalationUserIds: ['marcus-lee', 'ava-khan'],
  },
  {
    id: 'cybersecurity', name: 'Cybersecurity', shortName: 'Cybersecurity', description: 'Security outcomes, readiness, and trusted specialist advice.',
    parentTeamId: 'professional-services', nodeType: 'operational', memberCount: 2, meetingDay: 'Wednesday', meetingTime: '9:00 AM', accent: '#746cb5', initials: 'CY', active: true, meetingSections: defaultMeetingSections().map((section) => section.id === 'scorecard' ? { ...section, enabled: false } : section), escalationUserIds: ['priya-shah', 'ava-khan'],
  },
  {
    id: 'managed-services', name: 'Managed Services', shortName: 'Managed Services', description: 'Calm, consistent operations and dependable customer support.',
    parentTeamId: 'leadership', nodeType: 'operational', memberCount: 3, meetingDay: 'Wednesday', meetingTime: '10:30 AM', accent: '#d0a15b', initials: 'MS', active: true, meetingSections: defaultMeetingSections(), escalationUserIds: ['daniel-cho', 'ava-khan'],
  },
  {
    id: 'service-development', name: 'Service Development', shortName: 'Service Dev', description: 'Evolve the service catalogue, tooling, and operating playbooks.',
    parentTeamId: 'managed-services', nodeType: 'operational', memberCount: 2, meetingDay: 'Thursday', meetingTime: '9:00 AM', accent: '#6787b7', initials: 'SD', active: true, meetingSections: defaultMeetingSections(), escalationUserIds: ['maria-ortiz', 'daniel-cho'],
  },
  {
    id: 'service-delivery', name: 'Service Delivery', shortName: 'Service Delivery', description: 'Deliver a consistent, high-trust managed service every day.',
    parentTeamId: 'managed-services', nodeType: 'operational', memberCount: 2, meetingDay: 'Thursday', meetingTime: '10:30 AM', accent: '#c17872', initials: 'SL', active: true, meetingSections: defaultMeetingSections(), escalationUserIds: ['jon-bell', 'daniel-cho'],
  },
];

const memberships: TeamMembership[] = [
  { id: 'membership-ava-leadership', teamId: 'leadership', userId: 'ava-khan', role: 'TeamLead', active: true, createdAt: daysAgo(140), updatedAt: daysAgo(1) },
  { id: 'membership-marcus-leadership', teamId: 'leadership', userId: 'marcus-lee', role: 'Member', active: true, createdAt: daysAgo(135), updatedAt: daysAgo(4) },
  { id: 'membership-priya-leadership', teamId: 'leadership', userId: 'priya-shah', role: 'Member', active: true, createdAt: daysAgo(130), updatedAt: daysAgo(3) },
  { id: 'membership-daniel-leadership', teamId: 'leadership', userId: 'daniel-cho', role: 'Member', active: true, createdAt: daysAgo(120), updatedAt: daysAgo(2) },
  { id: 'membership-marcus-projects', teamId: 'projects', userId: 'marcus-lee', role: 'TeamLead', active: true, createdAt: daysAgo(135), updatedAt: daysAgo(4) },
  { id: 'membership-maya-projects', teamId: 'projects', userId: 'maya-green', role: 'Member', active: true, createdAt: daysAgo(95), updatedAt: daysAgo(7) },
  { id: 'membership-priya-cybersecurity', teamId: 'cybersecurity', userId: 'priya-shah', role: 'TeamLead', active: true, createdAt: daysAgo(130), updatedAt: daysAgo(3) },
  { id: 'membership-maya-cybersecurity', teamId: 'cybersecurity', userId: 'maya-green', role: 'Member', active: true, createdAt: daysAgo(95), updatedAt: daysAgo(7) },
  { id: 'membership-daniel-managed', teamId: 'managed-services', userId: 'daniel-cho', role: 'TeamLead', active: true, createdAt: daysAgo(120), updatedAt: daysAgo(2) },
  { id: 'membership-maria-managed', teamId: 'managed-services', userId: 'maria-ortiz', role: 'Member', active: true, createdAt: daysAgo(115), updatedAt: daysAgo(5) },
  { id: 'membership-jon-managed', teamId: 'managed-services', userId: 'jon-bell', role: 'Member', active: true, createdAt: daysAgo(110), updatedAt: daysAgo(5) },
  { id: 'membership-maria-service-development', teamId: 'service-development', userId: 'maria-ortiz', role: 'TeamLead', active: true, createdAt: daysAgo(115), updatedAt: daysAgo(5) },
  { id: 'membership-daniel-service-development', teamId: 'service-development', userId: 'daniel-cho', role: 'Member', active: true, createdAt: daysAgo(120), updatedAt: daysAgo(2) },
  { id: 'membership-jon-service-delivery', teamId: 'service-delivery', userId: 'jon-bell', role: 'TeamLead', active: true, createdAt: daysAgo(110), updatedAt: daysAgo(5) },
  { id: 'membership-maria-service-delivery', teamId: 'service-delivery', userId: 'maria-ortiz', role: 'Member', active: true, createdAt: daysAgo(115), updatedAt: daysAgo(5) },
];

const makeTask = (task: Omit<RockTask, 'createdAt' | 'updatedAt' | 'version'>): RockTask => ({
  ...task,
  createdAt: daysAgo(10),
  updatedAt: daysAgo(1),
  version: 1,
});

const rocks: Rock[] = [
  {
    id: 'rock-playbook', teamId: 'leadership', quarterId: '2026-q3', title: 'Launch the client onboarding playbook',
    description: 'One clear path from signed agreement to first value for every new client.', notes: 'Keep the first version simple enough for every team to use.', ownerId: 'ava-khan', status: 'on-track', progress: 72,
    dueDate: '2026-09-30', priority: 'high', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 3,
    tasks: [
      makeTask({ id: 'task-playbook-outline', rockId: 'rock-playbook', teamId: 'leadership', title: 'Approve the first-week checklist', notes: 'Review the handoff moments with Projects and Service Delivery.', assigneeId: 'marcus-lee', assignedAt: daysAgo(12), startDate: '2026-08-20', dueDate: '2026-09-05', status: 'in-progress', linkedTodoId: 'todo-brief' }),
      makeTask({ id: 'task-playbook-pilot', rockId: 'rock-playbook', teamId: 'leadership', title: 'Run the checklist with one new client', notes: 'Capture friction before rolling it out.', assigneeId: 'ava-khan', assignedAt: daysAgo(8), startDate: '2026-08-27', dueDate: '2026-09-12', status: 'open' }),
    ],
  },
  {
    id: 'rock-project-kickoff', teamId: 'projects', quarterId: '2026-q3', title: 'Standardise the implementation kickoff',
    description: 'Give every project the same calm, prepared first week.', notes: 'The kickoff template should be usable without a live handover.', ownerId: 'marcus-lee', status: 'on-track', progress: 58,
    dueDate: '2026-09-30', priority: 'high', createdAt: daysAgo(51), updatedAt: daysAgo(2), version: 2,
    tasks: [makeTask({ id: 'task-project-template', rockId: 'rock-project-kickoff', teamId: 'projects', title: 'Pilot the new kickoff checklist', notes: 'Use the next two projects as the test cohort.', assigneeId: 'maya-green', assignedAt: daysAgo(6), startDate: '2026-08-29', dueDate: '2026-09-10', status: 'open' })],
  },
  {
    id: 'rock-cyber-readiness', teamId: 'cybersecurity', quarterId: '2026-q3', title: 'Close the security evidence gaps',
    description: 'Make the evidence path clear before the next customer assurance review.', notes: 'Prioritise evidence that is reusable across customers.', ownerId: 'priya-shah', status: 'off-track', progress: 41,
    dueDate: '2026-09-20', priority: 'high', createdAt: daysAgo(62), updatedAt: daysAgo(4), version: 2,
    tasks: [makeTask({ id: 'task-cyber-evidence', rockId: 'rock-cyber-readiness', teamId: 'cybersecurity', title: 'Agree the evidence owner matrix', notes: 'Resolve the unclear handoffs between service teams.', assigneeId: 'priya-shah', assignedAt: daysAgo(14), startDate: '2026-08-22', dueDate: '2026-09-06', status: 'in-progress' })],
  },
  {
    id: 'rock-managed-catalogue', teamId: 'managed-services', quarterId: '2026-q3', title: 'Publish the managed services catalogue',
    description: 'Give customers and delivery teams one clear view of the service offer.', notes: 'Use customer language, not internal service names.', ownerId: 'daniel-cho', status: 'on-track', progress: 67,
    dueDate: '2026-09-30', priority: 'medium', createdAt: daysAgo(50), updatedAt: daysAgo(2), version: 2,
    tasks: [makeTask({ id: 'task-catalogue-review', rockId: 'rock-managed-catalogue', teamId: 'managed-services', title: 'Review catalogue language with Service Delivery', notes: '', assigneeId: 'jon-bell', assignedAt: daysAgo(5), startDate: '2026-08-29', dueDate: '2026-09-08', status: 'open' })],
  },
  {
    id: 'rock-service-development', teamId: 'service-development', quarterId: '2026-q3', title: 'Release the service health playbook',
    description: 'Create a repeatable weekly health review for every managed service.', notes: 'Include the signals that should create an Issue.', ownerId: 'maria-ortiz', status: 'on-track', progress: 54,
    dueDate: '2026-09-30', priority: 'medium', createdAt: daysAgo(46), updatedAt: daysAgo(3), version: 1,
    tasks: [makeTask({ id: 'task-health-playbook', rockId: 'rock-service-development', teamId: 'service-development', title: 'Draft the health review template', notes: '', assigneeId: 'maria-ortiz', assignedAt: daysAgo(9), startDate: '2026-08-26', dueDate: '2026-09-15', status: 'open' })],
  },
  {
    id: 'rock-service-delivery', teamId: 'service-delivery', quarterId: '2026-q3', title: 'Improve first-response consistency',
    description: 'Make the first customer response predictable across the service desk.', notes: 'Measure the promise and the actual response separately.', ownerId: 'jon-bell', status: 'complete', progress: 100,
    dueDate: '2026-09-12', priority: 'high', createdAt: daysAgo(70), updatedAt: daysAgo(5), version: 4,
    tasks: [makeTask({ id: 'task-first-response', rockId: 'rock-service-delivery', teamId: 'service-delivery', title: 'Publish the response standard', notes: '', assigneeId: 'jon-bell', assignedAt: daysAgo(40), startDate: '2026-07-28', dueDate: '2026-08-29', status: 'done' })],
  },
];

const todos: Todo[] = [
  {
    id: 'todo-brief', teamId: 'leadership', title: 'Share the revised Q4 planning brief with leadership', notes: '', ownerId: 'ava-khan', dueDate: '2026-09-05', status: 'open', origin: 'Rock · Client onboarding playbook', linkedRockTaskId: 'task-playbook-outline', createdAt: daysAgo(4), updatedAt: daysAgo(1), version: 2, isMine: true, carryForwardCount: 0, flagged: false,
  },
  {
    id: 'todo-handoff', teamId: 'leadership', title: 'Schedule the customer success / delivery handoff', notes: '', ownerId: 'ava-khan', dueDate: '2026-09-03', status: 'open', origin: 'Issue · Onboarding handoffs', createdAt: daysAgo(2), updatedAt: daysAgo(1), version: 1, isMine: true, carryForwardCount: 0, flagged: false,
  },
  {
    id: 'todo-alerts', teamId: 'leadership', title: 'Confirm cost alerts with the service teams', notes: '', ownerId: 'daniel-cho', dueDate: '2026-08-31', status: 'done', origin: 'Leadership L10 · Aug 24', createdAt: daysAgo(9), updatedAt: daysAgo(1), version: 2, carryForwardCount: 0, flagged: false,
  },
  {
    id: 'todo-project-kickoff', teamId: 'projects', title: 'Pilot the new implementation kickoff checklist', notes: '', ownerId: 'maya-green', dueDate: '2026-09-10', status: 'open', origin: 'Rock · Standardise the implementation kickoff', linkedRockTaskId: 'task-project-template', createdAt: daysAgo(3), updatedAt: daysAgo(2), version: 1, carryForwardCount: 0, flagged: false,
  },
  {
    id: 'todo-evidence', teamId: 'cybersecurity', title: 'Confirm the evidence owner matrix', notes: '', ownerId: 'priya-shah', dueDate: '2026-09-06', status: 'not-done', origin: 'Rock · Close the security evidence gaps', linkedRockTaskId: 'task-cyber-evidence', createdAt: daysAgo(8), updatedAt: daysAgo(4), version: 2, carryForwardCount: 2, flagged: false,
  },
  {
    id: 'todo-catalogue', teamId: 'managed-services', title: 'Review the catalogue language with delivery', notes: '', ownerId: 'jon-bell', dueDate: '2026-09-08', status: 'open', origin: 'Rock · Publish the managed services catalogue', linkedRockTaskId: 'task-catalogue-review', createdAt: daysAgo(3), updatedAt: daysAgo(2), version: 1, carryForwardCount: 0, flagged: false,
  },
  {
    id: 'todo-health', teamId: 'service-development', title: 'Draft the service health review template', notes: '', ownerId: 'maria-ortiz', dueDate: '2026-09-15', status: 'open', origin: 'Rock · Release the service health playbook', linkedRockTaskId: 'task-health-playbook', createdAt: daysAgo(4), updatedAt: daysAgo(3), version: 1, carryForwardCount: 0, flagged: false,
  },
  {
    id: 'todo-response', teamId: 'service-delivery', title: 'Review the first-response standard after one week', notes: '', ownerId: 'jon-bell', dueDate: '2026-09-04', status: 'done', origin: 'Rock · Improve first-response consistency', linkedRockTaskId: 'task-first-response', createdAt: daysAgo(10), updatedAt: daysAgo(5), version: 2, carryForwardCount: 0, flagged: false,
  },
];

const makeIssue = (issue: Omit<Issue, 'createdAt' | 'updatedAt' | 'ageInDays' | 'ageBand' | 'version' | 'meetingsPassed' | 'escalationState' | 'escalationDueAt' | 'escalationLevel' | 'escalatedToUserId'> & { ageInDays: number }): Issue => ({
  ...issue,
  createdAt: daysAgo(issue.ageInDays),
  updatedAt: daysAgo(Math.min(issue.ageInDays, 1)),
  ageBand: defaultAgeBand(issue.ageInDays),
  version: 1,
  meetingsPassed: 0,
  escalationState: 'not-scheduled',
  escalationLevel: 0,
});

const issues: Issue[] = [
  makeIssue({
    id: 'issue-handoffs', teamId: 'leadership', sourceTeamId: 'leadership', currentTeamId: 'leadership', title: 'Onboarding handoffs still rely on tribal knowledge',
    detail: 'The team is solving the same handoff questions in three different places. We need one owner, one checklist, and one visible path.', category: 'Process', priority: 1, status: 'open', horizon: 'short-term', assignmentState: 'assigned', raisedById: 'ava-khan', ownerId: 'ava-khan', ageInDays: 14, linkedRockId: 'rock-playbook', idsNote: 'Identify the exact moment the handoff becomes ambiguous, then decide who owns the customer-facing transition.',
  }),
  makeIssue({
    id: 'issue-planning', teamId: 'leadership', sourceTeamId: 'leadership', currentTeamId: 'leadership', title: 'The quarterly planning template arrives too late for team leads',
    detail: 'Teams are committing to Rocks before they can see the company-level constraints and focus areas.', category: 'Alignment', priority: 2, status: 'open', horizon: 'long-term', assignmentState: 'assigned', raisedById: 'marcus-lee', ownerId: 'marcus-lee', ageInDays: 5, idsNote: 'Decide what information must be available before each team starts quarterly planning.',
  }),
  makeIssue({
    id: 'issue-escalation', teamId: 'leadership', sourceTeamId: 'leadership', currentTeamId: 'leadership', title: 'Customer escalation path is unclear after hours',
    detail: 'A recent customer concern sat overnight because nobody knew who had the next call.', category: 'Customer', priority: 3, status: 'in-ids', horizon: 'short-term', assignmentState: 'assigned', raisedById: 'priya-shah', ownerId: 'priya-shah', ageInDays: 3, idsNote: 'The first-response owner is clear. Decide who acts as backup and where the rota lives.',
  }),
  makeIssue({
    id: 'issue-project-scope', teamId: 'projects', sourceTeamId: 'projects', currentTeamId: 'projects', title: 'Implementation scope changes are not visible early enough',
    detail: 'The Projects team needs a consistent signal when a project starts to drift from the agreed scope.', category: 'Delivery', priority: 1, status: 'open', horizon: 'short-term', assignmentState: 'assigned', raisedById: 'maya-green', ownerId: 'marcus-lee', ageInDays: 8, linkedRockId: 'rock-project-kickoff', idsNote: 'Agree the earliest reliable signal and who raises it with the customer.',
  }),
  makeIssue({
    id: 'issue-cyber-owners', teamId: 'cybersecurity', sourceTeamId: 'cybersecurity', currentTeamId: null, title: 'Evidence ownership is unclear across service teams',
    detail: 'The evidence request is still valid, but the first team declined the handoff and left the item without an owner.', category: 'Security', priority: 1, status: 'open', horizon: 'short-term', assignmentState: 'unassigned', raisedById: 'priya-shah', ownerId: undefined, ageInDays: 18, linkedRockId: 'rock-cyber-readiness', idsNote: 'Select the team that can make the ownership decision this week.',
  }),
  makeIssue({
    id: 'issue-service-health', teamId: 'service-development', sourceTeamId: 'service-development', currentTeamId: 'service-development', title: 'The service health review lacks a shared definition',
    detail: 'Different teams are using different signals to decide whether a managed service is healthy.', category: 'Alignment', priority: 2, status: 'open', horizon: 'long-term', assignmentState: 'assigned', raisedById: 'maria-ortiz', ownerId: 'maria-ortiz', ageInDays: 4, linkedRockId: 'rock-service-development', idsNote: 'Agree the small set of signals every service must report.',
  }),
  makeIssue({
    id: 'issue-transfer-pending', teamId: 'projects', sourceTeamId: 'projects', currentTeamId: 'projects', title: 'The customer kickoff needs a cybersecurity review',
    detail: 'Projects has identified a security dependency and sent this Issue to Leadership for the right team to accept and resolve.', category: 'Cross-team', priority: 2, status: 'open', horizon: 'short-term', assignmentState: 'pending-transfer', raisedById: 'marcus-lee', ownerId: 'marcus-lee', ageInDays: 22, linkedRockId: 'rock-project-kickoff', idsNote: 'Confirm who owns the review and when the customer can expect an answer.',
  }),
  makeIssue({
    id: 'issue-solved', teamId: 'service-delivery', sourceTeamId: 'service-delivery', currentTeamId: 'service-delivery', title: 'First-response ownership was unclear',
    detail: 'The team agreed a response standard and published the rota.', category: 'Operations', priority: 4, status: 'solved', horizon: 'short-term', assignmentState: 'assigned', raisedById: 'jon-bell', ownerId: 'jon-bell', ageInDays: 9, idsNote: 'Decision preserved in the meeting history.',
  }),
];

const transfers: IssueTransfer[] = [
  {
    id: 'transfer-projects-leadership', issueId: 'issue-transfer-pending', sourceTeamId: 'projects', destinationTeamId: 'leadership', requestedById: 'marcus-lee', requestedAt: daysAgo(2), status: 'pending', sourceIssueVersion: 1, note: 'Leadership should confirm the correct receiving team before the next L10.', version: 1,
  },
  {
    id: 'transfer-cyber-rejected', issueId: 'issue-cyber-owners', sourceTeamId: 'cybersecurity', destinationTeamId: 'service-delivery', requestedById: 'priya-shah', requestedAt: daysAgo(10), status: 'rejected', sourceIssueVersion: 2, decidedById: 'jon-bell', decidedAt: daysAgo(8), rejectionMessage: 'Service Delivery cannot own the evidence decision; it needs a security owner.', version: 2,
  },
];

const notifications: Notification[] = [
  {
    id: 'notification-transfer-projects-leadership', recipientUserId: 'ava-khan', type: 'issue-transfer-requested', title: 'Issue transferred to Leadership',
    message: 'Projects sent “The customer kickoff needs a cybersecurity review” to Leadership. Accept or reject it before the next L10.', issueId: 'issue-transfer-pending', transferId: 'transfer-projects-leadership', teamId: 'leadership', createdAt: daysAgo(2),
  },
  {
    id: 'notification-unassigned-cyber', recipientUserId: 'priya-shah', type: 'issue-transfer-decided', title: 'Issue returned unassigned',
    message: 'Service Delivery rejected “Evidence ownership is unclear across service teams”. Review the rejection message and choose the next team.', issueId: 'issue-cyber-owners', transferId: 'transfer-cyber-rejected', teamId: 'cybersecurity', createdAt: daysAgo(8),
  },
];

const messages: TeamMessage[] = [
  {
    id: 'message-projects-kickoff',
    fromTeamId: 'projects',
    toTeamId: 'leadership',
    senderId: 'marcus-lee',
    subject: 'Security review needed for the next kickoff',
    body: 'The next customer kickoff has a security dependency. Can Leadership help confirm the right receiving team before Friday?',
    status: 'unread',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    version: 1,
  },
];

const metrics: ScorecardMetric[] = [
  { id: 'metric-pipeline', teamId: 'leadership', label: 'Qualified pipeline created', target: '18', unit: 'opportunities', ownerId: 'jon-bell', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 1 },
  { id: 'metric-onboarding', teamId: 'leadership', label: 'Average onboarding cycle', target: '10', unit: 'days', ownerId: 'marcus-lee', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 1 },
  { id: 'metric-health', teamId: 'managed-services', label: 'Customer health checks', target: '15', unit: 'checks', ownerId: 'daniel-cho', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 1 },
  { id: 'metric-incidents', teamId: 'service-delivery', label: 'Critical incidents', target: '< 2', unit: 'incidents', ownerId: 'jon-bell', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 1 },
  { id: 'metric-kickoffs', teamId: 'projects', label: 'Projects kicked off on time', target: '90%', unit: 'on-time', ownerId: 'maria-ortiz', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 1 },
  { id: 'metric-evidence', teamId: 'cybersecurity', label: 'Evidence requests assigned', target: '100%', unit: 'assigned', ownerId: 'priya-shah', createdAt: daysAgo(55), updatedAt: daysAgo(1), version: 1 },
];

const makeScorecardResult = (metricId: string, teamId: string, weekStartDate: string, actual: string, status: ScorecardResult['status'], priorActual?: string): ScorecardResult => ({
  id: `result-${metricId}-${weekStartDate}`,
  metricId,
  teamId,
  weekStartDate,
  actual,
  status,
  ...scorecardTrendFor(actual, priorActual),
  createdAt: daysAgo(2),
  updatedAt: daysAgo(1),
  version: 1,
});

const scorecardResults: ScorecardResult[] = [
  makeScorecardResult('metric-pipeline', 'leadership', previousWeekStartDate, '18', 'on-track'),
  makeScorecardResult('metric-pipeline', 'leadership', currentWeekStartDate, '21', 'on-track', '18'),
  makeScorecardResult('metric-onboarding', 'leadership', previousWeekStartDate, '11', 'off-track'),
  makeScorecardResult('metric-onboarding', 'leadership', currentWeekStartDate, '12', 'off-track', '11'),
  makeScorecardResult('metric-health', 'managed-services', previousWeekStartDate, '13', 'off-track'),
  makeScorecardResult('metric-health', 'managed-services', currentWeekStartDate, '17', 'on-track', '13'),
  makeScorecardResult('metric-incidents', 'service-delivery', previousWeekStartDate, '1', 'on-track'),
  makeScorecardResult('metric-incidents', 'service-delivery', currentWeekStartDate, '1', 'on-track', '1'),
  makeScorecardResult('metric-kickoffs', 'projects', previousWeekStartDate, '88%', 'off-track'),
  makeScorecardResult('metric-kickoffs', 'projects', currentWeekStartDate, '94%', 'on-track', '88%'),
  makeScorecardResult('metric-evidence', 'cybersecurity', previousWeekStartDate, '80%', 'off-track'),
  makeScorecardResult('metric-evidence', 'cybersecurity', currentWeekStartDate, '72%', 'off-track', '80%'),
];

const headlines: Headline[] = [
  { id: 'headline-win', teamId: 'leadership', authorId: 'ava-khan', type: 'win', title: 'The onboarding pilot has a clear first customer', detail: 'Projects and Service Delivery agreed the first pilot path in one conversation.', createdAt: daysAgo(1) },
  { id: 'headline-risk', teamId: 'cybersecurity', authorId: 'priya-shah', type: 'concern', title: 'A customer assurance request needs an owner', detail: 'The request is not blocked, but it needs an explicit decision this week.', createdAt: daysAgo(2), issueId: 'issue-cyber-owners' },
];

const meetings: MeetingInstance[] = teams.map((team) => ({
  id: `meeting-${team.id}-${currentWeekStartDate}`, teamId: team.id, label: `${team.shortName} L10`, dateLabel: 'Monday · Aug 31', weekStartDate: currentWeekStartDate, status: 'upcoming',
  facilitatorId: memberships.find((membership) => membership.teamId === team.id && membership.role === 'TeamLead')?.userId ?? 'ava-khan',
  attendeeIds: memberships.filter((membership) => membership.teamId === team.id && membership.active).map((membership) => membership.userId),
  lastRating: 8.8, agendaProgress: 0, agendaTotal: team.meetingSections.filter((section) => section.enabled).length, idsSolved: 0, idsTotal: issues.filter((issue) => issue.teamId === team.id && issue.status !== 'solved').length, recap: '', sectionNotes: {}, idsIssueIds: [], createdTodoIds: [], idsNotes: [],
}));

const activity: AuditEvent[] = [
  { id: 'audit-transfer-requested', actorId: 'marcus-lee', action: 'Requested transfer', target: 'issue-transfer-pending', detail: 'Sent the Issue from Projects to Leadership.', createdAt: daysAgo(2), type: 'transfer' },
  { id: 'audit-issue-unassigned', actorId: 'jon-bell', action: 'Rejected transfer', target: 'issue-cyber-owners', detail: 'Returned the Issue to Cybersecurity unassigned.', createdAt: daysAgo(8), type: 'transfer' },
  { id: 'audit-rock-note', actorId: 'ava-khan', action: 'Updated Rock notes', target: 'rock-playbook', detail: 'Added guidance for the first-week checklist.', createdAt: daysAgo(1), type: 'rock' },
  { id: 'audit-team-seed', actorId: 'ava-khan', action: 'Created workspace hierarchy', target: 'organization', detail: 'Seeded the Leadership, Professional Services, and Managed Services structure.', createdAt: daysAgo(20), type: 'team' },
];

export const initialWorkspace: Workspace = {
  environment: 'live',
  currentUser: users[0],
  quarter: { id: '2026-q3', label: 'Q3 2026', theme: 'Make Q3 feel lighter.', startDate: '2026-07-01', endDate: '2026-09-30', daysRemaining: 28 },
  settings: { agingDays: 7, staleDays: 14, criticalDays: 30 },
  teams,
  users,
  memberships,
  rocks,
  todos,
  issues,
  messages,
  transfers,
  notifications,
  metrics,
  scorecardResults,
  headlines,
  meetings,
  activity,
};

// The test workspace is a dedicated sanitized fixture. It is cloned once at
// startup and never shares mutable arrays with the Live fixture.
export const testWorkspace: Workspace = {
  ...structuredClone(initialWorkspace),
  environment: 'test',
};

export const workspaceToday = today;
