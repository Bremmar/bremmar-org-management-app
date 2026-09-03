import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { workspaceApi, WorkspaceApiError, type SolveIssueInput } from './api';
import { initialWorkspace, workspaceToday } from './data';
import { defaultMeetingSections, meetingReviewStatus, meetingScheduledAt, meetingSectionsFor, rockMilestoneCounts, weekStartDateFor } from './types';
import { sanitizeTodoNotes } from './richText';
import type {
  CompanyOverview,
  EnvironmentAccess,
  EnvironmentId,
  EnvironmentSession,
  Issue,
  IssueAgeSettings,
  IssueMeetingBand,
  IssueHorizon,
  IssueTransfer,
  MeetingSection,
  MeetingAttendeeRating,
  MeetingSkipReason,
  Rock,
  RockStatus,
  RockTask,
  RockTaskStatus,
  ScorecardMetric,
  ScorecardResult,
  Team,
  TeamMessage,
  MeetingSectionConfig,
  TeamMembership,
  TeamNodeType,
  TeamRole,
  Todo,
  TodoChecklistItem,
  TodoStatus,
  User,
  ViewId,
  Workspace,
} from './types';

const clone = <T,>(value: T): T => structuredClone(value);
const isLocalPocBuild = import.meta.env.VITE_LOCAL_POC_MODE !== 'false';

const navLabels: Record<ViewId, string> = {
  overview: 'My week', company: 'Company overview', meeting: 'Live L10', 'meeting-history': 'Past meetings', rocks: 'Rocks', todos: 'To-Dos', issues: 'Issues', messages: 'Team messages', scorecard: 'Scorecard', admin: 'Admin', profile: 'Profile',
};

const userFor = (workspace: Workspace, id?: string): User => workspace.users.find((user) => user.id === id) ?? {
  id: id ?? 'unassigned', name: 'Unassigned', initials: '?', email: '', accent: '#8b96a8', active: true, platformCapabilities: [], createdAt: '', updatedAt: '',
};

const emptyTeam: Team = { id: 'unassigned', name: 'No team assigned', shortName: 'No team', description: '', parentTeamId: null, nodeType: 'grouping', memberCount: 0, meetingCadence: 'weekly', meetingDay: '', meetingTime: '', accent: '#8b96a8', initials: '—', active: false, meetingSections: defaultMeetingSections(), escalationUserIds: [] };
const teamFor = (workspace: Workspace, id?: string | null) => workspace.teams.find((team) => team.id === id) ?? workspace.teams[0] ?? emptyTeam;

const roleFor = (workspace: Workspace, teamId: string) => workspace.memberships.find((membership) => membership.teamId === teamId && membership.userId === workspace.currentUser.id && membership.active)?.role;
const canWrite = (workspace: Workspace, teamId: string) => ['OrgAdmin', 'TeamLead', 'Member'].includes(roleFor(workspace, teamId) ?? '');
const hasCompanyRead = (workspace: Workspace) => Boolean(roleFor(workspace, 'leadership'));
const isPlatformAdmin = (workspace: Workspace) => workspace.currentUser.platformCapabilities.includes('PlatformAdmin') || workspace.memberships.some((membership) => membership.teamId === 'leadership' && membership.userId === workspace.currentUser.id && membership.role === 'OrgAdmin' && membership.active);
const canManageMeetingSummary = (workspace: Workspace, teamId: string) => canWrite(workspace, teamId);

function statusLabel(status: string) {
  return ({ 'on-track': 'On track', 'off-track': 'Off track', complete: 'Complete', open: 'Open', done: 'Done', 'not-done': 'Not done', 'in-ids': 'In IDS', parked: 'Parked', solved: 'Solved', 'in-progress': 'In progress', upcoming: 'Upcoming', closed: 'Completed', skipped: 'Skipped', missed: 'Missed', overdue: 'Overdue' } as Record<string, string>)[status] ?? status;
}

function cadenceLabel(cadence: Team['meetingCadence']) {
  return cadence === 'monthly' ? 'Monthly' : 'Weekly';
}

function ageLabel(issue: Issue) {
  return `${issue.ageInDays} ${issue.ageInDays === 1 ? 'day' : 'days'}`;
}

function formatDate(value: string) {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

function elapsedSecondsSince(startedAt: string | undefined, endAt: number | string) {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = typeof endAt === 'number' ? endAt : new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 1000));
}

function meetingDateTimeLabel(meeting: Workspace['meetings'][number]) {
  return `${meeting.dateLabel}${meeting.scheduledTime ? ` · ${meeting.scheduledTime}` : ''}`;
}

function meetingStatusTone(status: string) {
  if (status === 'closed' || status === 'complete') return 'positive';
  if (status === 'missed' || status === 'overdue' || status === 'skipped') return 'negative';
  if (status === 'in-progress') return 'blue';
  return 'warning';
}

function teamPath(workspace: Workspace, teamId: string) {
  const parts: string[] = [];
  let team = teamFor(workspace, teamId);
  while (team) {
    parts.unshift(team.shortName);
    if (!team.parentTeamId) break;
    const parent = workspace.teams.find((item) => item.id === team.parentTeamId);
    if (!parent) break;
    team = parent;
  }
  return parts.join(' / ');
}

function descendantIds(workspace: Workspace, teamId: string): string[] {
  const children = workspace.teams.filter((team) => team.parentTeamId === teamId).map((team) => team.id);
  return children.flatMap((child) => [child, ...descendantIds(workspace, child)]);
}

function issueStatusClass(issue: Issue) {
  return issue.assignmentState === 'unassigned' ? 'unassigned' : issue.status;
}

function healthClass(band: IssueMeetingBand) {
  return `meeting-health-${band}`;
}

export function pendingTeamMessagesFor(messages: TeamMessage[], teamId: string) {
  return messages.filter((message) => message.toTeamId === teamId && message.status === 'unread');
}

function initialsFor(name: string) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('The image could not be decoded.'));
      image.onload = () => {
        const maximumSide = 256;
        const scale = Math.min(1, maximumSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Image compression is not supported in this browser.'));
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.84;
        let compressed = canvas.toDataURL('image/webp', quality);
        if (!compressed.startsWith('data:image/webp')) compressed = canvas.toDataURL('image/jpeg', quality);
        const compressedBytes = (value: string) => {
          const encoded = value.slice(value.indexOf(',') + 1);
          const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
          return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
        };
        while (compressedBytes(compressed) > 256 * 1024 && quality > 0.4) {
          quality -= 0.08;
          compressed = canvas.toDataURL(compressed.startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', quality);
        }
        if (compressedBytes(compressed) > 256 * 1024) {
          reject(new Error('The compressed avatar is larger than 256 KB.'));
          return;
        }
        resolve(compressed);
      };
      image.src = String(reader.result ?? '');
    };
    reader.readAsDataURL(file);
  });
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => clone(initialWorkspace));
  const [environmentSession, setEnvironmentSession] = useState<EnvironmentSession | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(true);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  const [environmentAccess, setEnvironmentAccess] = useState<EnvironmentAccess[] | null>(null);
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [selectedTeamId, setSelectedTeamId] = useState('leadership');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [meetingSection, setMeetingSection] = useState<MeetingSection>('segue');
  const [meetingRunning, setMeetingRunning] = useState(false);
  const [meetingClosed, setMeetingClosed] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [recapMeetingId, setRecapMeetingId] = useState<string | null>(null);
  const [scorecardWeekStartDate, setScorecardWeekStartDate] = useState('');
  const [scorecardContext, setScorecardContext] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [companyOverview, setCompanyOverview] = useState<CompanyOverview | null>(null);
  const environmentGeneration = useRef(0);

  const accessibleTeams = useMemo(() => {
    const isLeadershipMember = workspace.memberships.some((membership) => membership.teamId === 'leadership' && membership.userId === workspace.currentUser.id && membership.active);
    if (isLeadershipMember) return workspace.teams.filter((team) => team.active);
    const assignedTeamIds = new Set(workspace.memberships
      .filter((membership) => membership.userId === workspace.currentUser.id && membership.active)
      .flatMap((membership) => [membership.teamId, ...(membership.role === 'TeamLead' || membership.role === 'OrgAdmin' ? descendantIds(workspace, membership.teamId) : [])]));
    return workspace.teams.filter((team) => team.active && assignedTeamIds.has(team.id));
  }, [workspace.currentUser.id, workspace.memberships, workspace.teams]);
  const accessibleTeamId = accessibleTeams.some((team) => team.id === selectedTeamId) ? selectedTeamId : accessibleTeams[0]?.id ?? '';
  const hasWorkspaceAccess = accessibleTeams.length > 0;
  const activeTeam = teamFor(workspace, accessibleTeamId);
  const currentRole = roleFor(workspace, activeTeam.id);
  const readOnly = !hasWorkspaceAccess || !canWrite(workspace, activeTeam.id);
  const teamMeetings = useMemo(() => workspace.meetings.filter((meeting) => meeting.teamId === activeTeam.id), [workspace.meetings, activeTeam.id]);
  const sortedTeamMeetings = useMemo(() => [...teamMeetings].sort((left, right) => meetingScheduledAt(left) - meetingScheduledAt(right)), [teamMeetings]);
  const selectedMeeting = teamMeetings.find((meeting) => meeting.id === selectedMeetingId);
  const recapMeeting = teamMeetings.find((meeting) => meeting.id === recapMeetingId);
  const currentMeeting = (meetingClosed ? recapMeeting : undefined)
    ?? (selectedMeeting && (meetingClosed || selectedMeeting.status !== 'closed') ? selectedMeeting : undefined)
    ?? teamMeetings.find((meeting) => meeting.status === 'in-progress')
    ?? sortedTeamMeetings.find((meeting) => meeting.status === 'upcoming')
    ?? sortedTeamMeetings[0];
  const meetingWeekStartDate = currentMeeting?.weekStartDate ?? weekStartDateFor(new Date());
  const selectedScorecardWeek = scorecardWeekStartDate || meetingWeekStartDate;
  const activeAgenda = useMemo(() => meetingSectionsFor(activeTeam), [activeTeam]);
  const activeIssues = useMemo(() => hasWorkspaceAccess ? workspace.issues.filter((issue) => issue.teamId === activeTeam.id && issue.assignmentState !== 'redirected') : [], [hasWorkspaceAccess, workspace.issues, activeTeam.id]);
  const activeRocks = useMemo(() => hasWorkspaceAccess ? workspace.rocks.filter((rock) => rock.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.rocks, activeTeam.id]);
  const activeTodos = useMemo(() => hasWorkspaceAccess ? workspace.todos.filter((todo) => todo.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.todos, activeTeam.id]);
  const activeMetrics = useMemo(() => hasWorkspaceAccess ? workspace.metrics.filter((metric) => metric.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.metrics, activeTeam.id]);
  const activeScorecardResults = useMemo(() => hasWorkspaceAccess ? workspace.scorecardResults.filter((result) => result.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.scorecardResults, activeTeam.id]);
  const activeHeadlines = useMemo(() => hasWorkspaceAccess ? workspace.headlines.filter((headline) => headline.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.headlines, activeTeam.id]);
  const pendingForTeam = hasWorkspaceAccess ? workspace.transfers.filter((transfer) => transfer.status === 'pending' && transfer.destinationTeamId === activeTeam.id) : [];
  const pendingFromTeam = hasWorkspaceAccess ? workspace.transfers.filter((transfer) => transfer.status === 'pending' && transfer.sourceTeamId === activeTeam.id) : [];
  const activeMessages = hasWorkspaceAccess ? workspace.messages.filter((message) => message.toTeamId === activeTeam.id || message.fromTeamId === activeTeam.id) : [];
  const pendingTeamMessages = hasWorkspaceAccess ? pendingTeamMessagesFor(workspace.messages, activeTeam.id) : [];
  const unreadNotifications = workspace.notifications.filter((notification) => notification.recipientUserId === workspace.currentUser.id && !notification.readAt);

  useEffect(() => {
    if (accessibleTeamId && selectedTeamId !== accessibleTeamId) setSelectedTeamId(accessibleTeamId);
  }, [accessibleTeamId, selectedTeamId]);

  useEffect(() => {
    if (!teamMeetings.some((meeting) => meeting.id === selectedMeetingId)) {
      const next = teamMeetings.find((meeting) => meeting.status === 'in-progress') ?? sortedTeamMeetings.find((meeting) => meeting.status === 'upcoming') ?? sortedTeamMeetings[0];
      setSelectedMeetingId(next?.id ?? null);
    }
  }, [activeTeam.id, selectedMeetingId, sortedTeamMeetings, teamMeetings]);

  useEffect(() => {
    const nextContext = `${activeTeam.id}:${currentMeeting?.id ?? ''}`;
    if (nextContext !== scorecardContext) {
      setScorecardContext(nextContext);
      setScorecardWeekStartDate(meetingWeekStartDate);
    }
  }, [activeTeam.id, currentMeeting?.id, meetingWeekStartDate, scorecardContext]);

  useEffect(() => {
    let active = true;
    // A fresh authenticated shell always starts in Live. The server still
    // validates the signed cookie and the Test grant on every later request.
    void workspaceApi.selectEnvironment('live')
      .then(async (session) => {
        if (!active) return;
        setEnvironmentSession(session);
        const next = await workspaceApi.getWorkspace();
        if (!active) return;
        setWorkspace(next);
        setEnvironmentError(null);
      })
      .catch((error) => {
        if (active) setEnvironmentError(error instanceof WorkspaceApiError ? error.message : 'The workspace could not be loaded.');
      })
      .finally(() => {
        if (active) setEnvironmentLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const active = currentMeeting?.status === 'in-progress' && !meetingClosed;
    setClockNow(Date.now());
    if (!active) return undefined;
    const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [currentMeeting?.id, currentMeeting?.status, meetingClosed]);

  useEffect(() => {
    if (activeView !== 'company' || !hasCompanyRead(workspace)) return;
    const generation = environmentGeneration.current;
    void workspaceApi.getCompanyOverview().then((overview) => {
      if (generation === environmentGeneration.current) setCompanyOverview(overview);
    }).catch(() => {
      if (generation === environmentGeneration.current) setCompanyOverview(null);
    });
  }, [activeView, workspace]);

  useEffect(() => {
    if (activeView !== 'admin' || workspace.environment !== 'live' || !isPlatformAdmin(workspace)) {
      setEnvironmentAccess(null);
      return;
    }
    void workspaceApi.getEnvironmentAccess().then(setEnvironmentAccess).catch(() => setEnvironmentAccess(null));
  }, [activeView, workspace.environment, workspace.currentUser.id, workspace.currentUser.platformCapabilities]);

  useEffect(() => {
    const section = activeAgenda.find((item) => item.id === meetingSection);
    if (!section && activeAgenda[0]) {
      setMeetingSection(activeAgenda[0].id);
      return;
    }
  }, [activeAgenda, meetingSection]);

  useEffect(() => {
    if (activeView === 'scorecard' && !activeAgenda.some((section) => section.id === 'scorecard')) setActiveView('overview');
  }, [activeAgenda, activeView]);

  useEffect(() => {
    if (!currentMeeting?.id) return;
    setMeetingSection(currentMeeting.status === 'in-progress' ? currentMeeting.activeSection ?? 'segue' : 'segue');
  }, [currentMeeting?.id, currentMeeting?.status, currentMeeting?.activeSection]);

  useEffect(() => {
    if (currentMeeting?.status === 'closed') setMeetingRunning(false);
    else if (currentMeeting?.status === 'in-progress') setMeetingRunning(true);
    else setMeetingRunning(false);
  }, [currentMeeting?.id, currentMeeting?.status]);

  useEffect(() => {
    const meeting = recapMeetingId ? workspace.meetings.find((candidate) => candidate.id === recapMeetingId) : undefined;
    if (activeView !== 'meeting' || !meetingClosed || !meeting || (meeting.aiSummaryStatus !== 'queued' && meeting.aiSummaryStatus !== 'generating')) return undefined;
    let cancelled = false;
    const poll = window.setInterval(() => {
      void workspaceApi.getWorkspace().then((next) => {
        if (!cancelled && next.environment === workspace.environment) setWorkspace(next);
      }).catch(() => undefined);
    }, 1200);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [activeView, meetingClosed, recapMeetingId, workspace.environment, workspace.meetings]);

  const changeEnvironment = async (environment: EnvironmentId) => {
    if (environment === workspace.environment || !environmentSession?.availableEnvironments.some((item) => item.id === environment)) return;
    const generation = ++environmentGeneration.current;
    setEnvironmentLoading(true);
    setEnvironmentError(null);
    setModal(null);
    setNotificationsOpen(false);
    setCompanyOverview(null);
    setSelectedTeamId('leadership');
    setActiveView('overview');
    setMeetingRunning(false);
    setMeetingClosed(false);
    setSelectedMeetingId(null);
    setRecapMeetingId(null);
    setMeetingSection('segue');
    setClockNow(Date.now());
    setScorecardContext('');
    setScorecardWeekStartDate('');
    try {
      const session = await workspaceApi.selectEnvironment(environment);
      const next = await workspaceApi.getWorkspace();
      if (generation !== environmentGeneration.current) return;
      setEnvironmentSession(session);
      setWorkspace(next);
      notify(`${session.currentEnvironment === 'test' ? 'Test' : 'Live'} environment loaded.`);
    } catch (error) {
      if (generation === environmentGeneration.current) setEnvironmentError(error instanceof WorkspaceApiError ? error.message : 'The environment could not be loaded.');
      const session = await workspaceApi.getEnvironmentSession().catch(() => null);
      if (generation === environmentGeneration.current && session) setEnvironmentSession(session);
    } finally {
      if (generation === environmentGeneration.current) setEnvironmentLoading(false);
    }
  };

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3400);
  };

  const refresh = async (operation: Promise<Workspace>, successMessage?: string) => {
    const generation = environmentGeneration.current;
    try {
      const next = await operation;
      if (generation !== environmentGeneration.current) return false;
      setWorkspace(next);
      if (successMessage) notify(successMessage);
      return true;
    } catch (error) {
      if (error instanceof WorkspaceApiError && (error.code === 'CONFLICT' || error.code === 'UNAVAILABLE')) {
        try {
          const latest = await workspaceApi.getWorkspace();
          if (generation === environmentGeneration.current) setWorkspace(latest);
        } catch {
          // Keep the original mutation message when the recovery read also fails.
        }
      }
      if (error instanceof WorkspaceApiError) notify(error.message);
      else notify('That update could not be saved. Try again.');
      return false;
    }
  };

  const updateEnvironmentAccess = async (userId: string, testAllowed: boolean) => {
    try {
      const access = await workspaceApi.updateEnvironmentAccess(userId, testAllowed);
      const session = await workspaceApi.getEnvironmentSession();
      setEnvironmentAccess(access);
      setEnvironmentSession(session);
      notify(testAllowed ? 'Test access granted.' : 'Test access revoked.');
    } catch (error) {
      notify(error instanceof WorkspaceApiError ? error.message : 'Test access could not be updated.');
    }
  };

  const navigate = (view: ViewId) => {
    setActiveView(view);
    if (view !== 'meeting') {
      setMeetingClosed(false);
      setRecapMeetingId(null);
    }
    setSidebarOpen(false);
    setNotificationsOpen(false);
  };

  const updateRockStatus = (rock: Rock) => {
    const next: RockStatus = rock.status === 'off-track' ? 'on-track' : rock.status === 'on-track' ? 'off-track' : 'on-track';
    void refresh(workspaceApi.updateRockStatus(rock.id, next, rock.version), `${rock.title} marked ${statusLabel(next).toLowerCase()}.`);
  };

  const updateTodoStatus = (todo: Todo, status?: TodoStatus) => {
    const next = status ?? (todo.status === 'done' ? 'open' : 'done');
    void refresh(workspaceApi.updateTodoStatus(todo.id, next, todo.version), `${todo.title} marked ${statusLabel(next).toLowerCase()}.`);
  };

  const startIssue = async (issue: Issue) => {
    const saved = await refresh(workspaceApi.startIssue(issue.id, issue.version), `${issue.title} is ready for IDS.`);
    if (saved) {
      setMeetingSection('ids');
      navigate('meeting');
    }
  };

  const parkIssue = async (issue: Issue) => {
    await refresh(workspaceApi.parkIssue(issue.id, issue.version), `${issue.title} is parked for a future IDS conversation.`);
  };

  const solveIssue = (issue: Issue) => {
    setModal({ type: 'solve-issue', issueId: issue.id });
  };

  const submitSolveIssue = async (issueId: string, input: SolveIssueInput) => {
    const issue = workspace.issues.find((candidate) => candidate.id === issueId);
    if (!issue) return;
    const saved = await refresh(workspaceApi.solveIssue(issue.id, input, issue.version), input.createFollowUpTodo ? 'Issue solved. A follow-up To-Do was added.' : 'Issue solved without a follow-up To-Do.');
    if (saved) setModal(null);
  };

  const addTodoChecklistItem = async (todoId: string, text: string, supporterId?: string) => {
    const todo = workspace.todos.find((candidate) => candidate.id === todoId);
    if (todo && await refresh(workspaceApi.addTodoChecklistItem(todoId, text, supporterId, todo.version), 'Checklist item added.')) return;
  };

  const updateTodoChecklistItem = async (todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>) => {
    const todo = workspace.todos.find((candidate) => candidate.id === todoId);
    if (todo) await refresh(workspaceApi.updateTodoChecklistItem(todoId, itemId, input, todo.version), 'Checklist item updated.');
  };

  const deleteTodoChecklistItem = async (todoId: string, itemId: string) => {
    const todo = workspace.todos.find((candidate) => candidate.id === todoId);
    if (todo) await refresh(workspaceApi.deleteTodoChecklistItem(todoId, itemId, todo.version), 'Checklist item removed.');
  };

  const openMessage = (messageId: string) => setModal({ type: 'message-detail', messageId });
  const markMessageRead = (messageId: string) => { void refresh(workspaceApi.markMessageRead(messageId), 'Message marked read.'); };

  const createScorecardIssue = async (metric: ScorecardMetric, result: ScorecardResult) => {
    await refresh(workspaceApi.createIssueFromScorecard(metric.id, result.weekStartDate, result.version), 'Metric converted into an Issue.');
  };

  const createRockIssue = async (rock: Rock) => {
    await refresh(workspaceApi.createIssueFromRock(rock.id, rock.version), 'Off-track Rock converted into an Issue.');
  };

  const saveMeetingSectionNote = (section: MeetingSection, note: string) => {
    if (!currentMeeting) return Promise.resolve(false);
    return refresh(workspaceApi.updateMeetingSectionNote(activeTeam.id, currentMeeting.id, section, note, currentMeeting.version), 'Meeting notes saved.');
  };

  const reorderMeetingIssues = (issueIds: string[]) => {
    if (!currentMeeting) return Promise.resolve(false);
    return refresh(workspaceApi.reorderMeetingIssues(activeTeam.id, currentMeeting.id, issueIds, currentMeeting.version), 'IDS order saved.');
  };

  const selectMeetingIssues = (issueIds: string[]) => {
    if (!currentMeeting) return Promise.resolve(false);
    return refresh(workspaceApi.setMeetingIssueSelection(activeTeam.id, currentMeeting.id, issueIds, currentMeeting.version), 'IDS issues selected.');
  };

  const saveMeetingIssueNote = (issueId: string, note: string) => {
    if (!currentMeeting) return Promise.resolve(false);
    const issue = workspace.issues.find((candidate) => candidate.id === issueId);
    if (!issue) return Promise.resolve(false);
    return refresh(workspaceApi.addMeetingIssueNote(issueId, currentMeeting.id, note, issue.version), 'IDS notes saved.');
  };

  const transitionMeetingSection = (fromSection: MeetingSection, toSection: MeetingSection) => {
    if (!currentMeeting || currentMeeting.status !== 'in-progress') return Promise.resolve(true);
    return refresh(workspaceApi.transitionMeetingSection(activeTeam.id, currentMeeting.id, fromSection, toSection, currentMeeting.version), 'Section time recorded.');
  };

  const createScorecardMetric = async (input: Pick<ScorecardMetric, 'teamId' | 'label' | 'target' | 'unit' | 'ownerId'>) => {
    if (await refresh(workspaceApi.createScorecardMetric(input), 'Measurable definition added.')) setModal(null);
  };

  const updateScorecardMetric = async (metricId: string, input: Partial<Pick<ScorecardMetric, 'label' | 'target' | 'unit' | 'ownerId'>>) => {
    const metric = workspace.metrics.find((item) => item.id === metricId);
    if (metric && await refresh(workspaceApi.updateScorecardMetric(metricId, input, metric.version), 'Measurable definition updated.')) setModal(null);
  };

  const saveScorecardResult = async (metricId: string, weekStartDate: string, input: Pick<ScorecardResult, 'actual' | 'status'>) => {
    const result = workspace.scorecardResults.find((item) => item.metricId === metricId && item.weekStartDate === weekStartDate);
    if (await refresh(workspaceApi.upsertScorecardResult(metricId, weekStartDate, input, result?.version), 'Weekly result saved.')) setModal(null);
  };

  const closeMeeting = async (recap: string, rating: number, attendeeRatings: MeetingAttendeeRating[]) => {
    if (!currentMeeting) return;
    const closedMeetingId = currentMeeting.id;
    const saved = await refresh(workspaceApi.closeMeeting(activeTeam.id, recap, rating, closedMeetingId, attendeeRatings), 'Meeting closed. Your recap is saved to history.');
    if (saved) {
      setMeetingRunning(false);
      setMeetingClosed(true);
      setSelectedMeetingId(closedMeetingId);
      setRecapMeetingId(closedMeetingId);
    }
  };

  const toggleMeetingRunning = async () => {
    if (meetingRunning) return;
    if (readOnly || !currentMeeting || currentMeeting.status === 'closed' || currentMeeting.status === 'skipped') return;
    setModal({ type: 'meeting-start', meetingId: currentMeeting.id });
  };

  const selectMeetingOccurrence = (meetingId: string) => {
    const selected = workspace.meetings.find((meeting) => meeting.id === meetingId);
    setSelectedMeetingId(meetingId);
    setMeetingClosed(false);
    setRecapMeetingId(null);
    setMeetingSection(selected?.status === 'in-progress' ? selected.activeSection ?? 'segue' : 'segue');
  };

  const startMeetingOccurrence = async (meeting: Workspace['meetings'][number]) => {
    setSelectedMeetingId(meeting.id);
    setMeetingClosed(false);
    setRecapMeetingId(null);
    if (readOnly || !['upcoming', 'in-progress'].includes(meeting.status)) return;
    setMeetingSection(meeting.status === 'in-progress' ? meeting.activeSection ?? 'segue' : 'segue');
    setModal({ type: 'meeting-start', meetingId: meeting.id });
  };

  const submitStartMeeting = async (meetingId: string, facilitatorId: string) => {
    const meeting = workspace.meetings.find((candidate) => candidate.id === meetingId);
    if (!meeting) return;
    const saved = await refresh(workspaceApi.startMeeting(activeTeam.id, meetingId, meeting.version, facilitatorId), 'Meeting started.');
    if (saved) {
      setMeetingSection('segue');
      setMeetingRunning(true);
      setModal(null);
    }
  };

  const submitSkipMeeting = async (meetingId: string, reason: MeetingSkipReason, note: string) => {
    const meeting = workspace.meetings.find((candidate) => candidate.id === meetingId);
    if (!meeting) return;
    if (await refresh(workspaceApi.skipMeeting(activeTeam.id, meetingId, reason, note, meeting.version), 'Meeting skipped. The next cadence occurrence is ready.')) {
      setModal(null);
      setSelectedMeetingId(null);
    }
  };

  const updateMeetingSchedule = async (meetingId: string, input: { scheduledDate: string; scheduledTime: string }) => {
    const meeting = workspace.meetings.find((candidate) => candidate.id === meetingId);
    if (!meeting) return;
    if (await refresh(workspaceApi.updateMeetingSchedule(activeTeam.id, meetingId, input, meeting.version), 'Meeting occurrence date and time updated.')) setModal(null);
  };

  const requestMeetingSummary = (teamId: string, meetingId: string, expectedVersion?: number) => refresh(workspaceApi.requestMeetingSummary(teamId, meetingId, expectedVersion), 'AI recap queued.');

  const changeTeam = (teamId: string) => {
    if (!accessibleTeams.some((team) => team.id === teamId)) return;
    setSelectedTeamId(teamId);
    setMeetingClosed(false);
    setSelectedMeetingId(null);
    setRecapMeetingId(null);
    setActiveView('overview');
    setSidebarOpen(false);
  };

  const acceptTransfer = (transferId: string) => {
    const transfer = workspace.transfers.find((item) => item.id === transferId);
    void refresh(workspaceApi.acceptIssueTransfer(transferId, transfer?.version), 'Issue transfer accepted.');
  };

  const cancelTransfer = (transferId: string) => {
    const transfer = workspace.transfers.find((item) => item.id === transferId);
    void refresh(workspaceApi.cancelIssueTransfer(transferId, transfer?.version), 'Issue transfer cancelled.');
  };

  const handleCreateTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;
    if (await refresh(workspaceApi.addTodo({ title, notes: String(form.get('notes') ?? ''), dueDate: String(form.get('dueDate') ?? workspaceToday), ownerId: String(form.get('ownerId') ?? workspace.currentUser.id), teamId: activeTeam.id }), 'New To-Do added to the team workspace.')) setModal(null);
  };

  const handleCreateIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;
    if (await refresh(workspaceApi.addIssue({ title, detail: String(form.get('detail') ?? '').trim() || 'Captured from the team workspace for discussion.', horizon: String(form.get('horizon') ?? 'short-term') as IssueHorizon, priority: Number(form.get('priority') ?? 1), teamId: activeTeam.id, raisedById: workspace.currentUser.id, ownerId: String(form.get('ownerId') ?? workspace.currentUser.id) }), 'Issue added to the list.')) setModal(null);
  };

  const handleCreateRock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;
    if (await refresh(workspaceApi.addRock({ title, description: String(form.get('description') ?? ''), notes: String(form.get('notes') ?? ''), ownerId: String(form.get('ownerId') ?? workspace.currentUser.id), dueDate: String(form.get('dueDate') ?? '2026-09-30'), priority: String(form.get('priority') ?? 'medium') as Rock['priority'], teamId: activeTeam.id }), 'Rock added to the quarter.')) setModal(null);
  };

  const handleCreateTask = async (event: FormEvent<HTMLFormElement>, rockId: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;
    if (await refresh(workspaceApi.addRockTask(rockId, { title, notes: String(form.get('notes') ?? ''), assigneeId: String(form.get('assigneeId') ?? workspace.currentUser.id), assignedAt: String(form.get('assignedAt') ?? workspaceToday), startDate: String(form.get('startDate') ?? workspaceToday), dueDate: String(form.get('dueDate') ?? '2026-09-30') }), 'Rock Task added.')) setModal(null);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (readOnly) return;
    const task = workspace.rocks.flatMap((rock) => rock.tasks).find((candidate) => candidate.id === taskId);
    if (!task) return;
    const warning = task.linkedTodoId
      ? 'Deleting this milestone will keep its linked To-Do as a standalone commitment. Continue?'
      : 'Delete this milestone? This cannot be undone.';
    if (!window.confirm(warning)) return;
    if (await refresh(workspaceApi.deleteRockTask(task.id, task.version), 'Rock Task deleted.')) setModal(null);
  };

  const renderView = () => {
    const common = { workspace, team: activeTeam, readOnly, onNavigate: navigate };
    switch (activeView) {
      case 'company':
        return <CompanyView {...common} overview={companyOverview} />;
      case 'meeting':
        if (!currentMeeting) {
          return <MeetingSetupView team={activeTeam} readOnly={readOnly} onNavigate={navigate} />;
        }
        if (meetingClosed && currentMeeting.status === 'closed') return <MeetingRecapView workspace={workspace} team={activeTeam} meeting={currentMeeting} canRetry={canManageMeetingSummary(workspace, activeTeam.id)} onRequestSummary={() => requestMeetingSummary(activeTeam.id, currentMeeting.id, currentMeeting.version)} onBack={() => { setMeetingClosed(false); setRecapMeetingId(null); setSelectedMeetingId(null); navigate('meeting'); }} />;
        return <MeetingViewV2 {...common} agenda={activeAgenda} rocks={activeRocks} todos={activeTodos} issues={activeIssues} metrics={activeMetrics} scorecardResults={activeScorecardResults} headlines={activeHeadlines} meeting={currentMeeting} occurrences={sortedTeamMeetings} selectedMeetingId={currentMeeting.id} section={meetingSection} clockNow={clockNow} running={meetingRunning} closed={meetingClosed || currentMeeting.status === 'closed' || currentMeeting.status === 'skipped'} pendingTransfers={pendingForTeam} pendingSourceTransfers={pendingFromTeam} pendingMessages={pendingTeamMessages} canManageSchedule={!readOnly} onSelectMeeting={selectMeetingOccurrence} onStartMeeting={startMeetingOccurrence} onSkipMeeting={(meeting) => setModal({ type: 'meeting-skip', meetingId: meeting.id })} onRescheduleMeeting={(meeting) => setModal({ type: 'meeting-schedule', meetingId: meeting.id })} onSelectSection={setMeetingSection} onTransitionSection={transitionMeetingSection} onToggleRunning={toggleMeetingRunning} onUpdateRock={updateRockStatus} onUpdateTodo={updateTodoStatus} onStartIssue={startIssue} onParkIssue={parkIssue} onOpenIssue={(issueId, meetingReadOnly) => setModal({ type: 'issue-detail', issueId, meetingId: currentMeeting.id, readOnly: meetingReadOnly })} onOpenTodo={(todoId, meetingReadOnly) => setModal({ type: 'todo-detail', todoId, readOnly: meetingReadOnly })} onSolveIssue={solveIssue} onOpenMessage={openMessage} onMarkMessageRead={markMessageRead} onCreateIssueFromMessage={(messageId) => setModal({ type: 'message-issue', messageId })} onCreateIssueFromScorecard={createScorecardIssue} onCreateIssueFromRock={createRockIssue} onSaveSectionNote={saveMeetingSectionNote} onSelectMeetingIssues={selectMeetingIssues} onSaveIssueNote={saveMeetingIssueNote} onReorderIssues={reorderMeetingIssues} onAccept={acceptTransfer} onReject={(id) => setModal({ type: 'reject', transferId: id })} onCancel={cancelTransfer} onClose={closeMeeting} onEditSchedule={() => setModal({ type: 'meeting-schedule', meetingId: currentMeeting.id })} onNavigate={(view) => { if (view === 'scorecard') setScorecardWeekStartDate(meetingWeekStartDate); navigate(view); }} />;
      case 'meeting-history':
        return <MeetingHistoryView workspace={workspace} teams={accessibleTeams} onRequestSummary={requestMeetingSummary} onOpenMeeting={(teamId, meetingId) => { const target = workspace.meetings.find((meeting) => meeting.teamId === teamId && meeting.id === meetingId); const closed = target?.status === 'closed'; setSelectedTeamId(teamId); setSelectedMeetingId(meetingId); setMeetingClosed(closed); setRecapMeetingId(closed ? meetingId : null); navigate('meeting'); }} />;
      case 'rocks':
        return <RocksView {...common} rocks={activeRocks} onUpdateRock={updateRockStatus} onEditRock={(rockId) => setModal({ type: 'edit-rock', rockId })} onAdd={() => setModal({ type: 'rock' })} onAddTask={(rockId) => setModal({ type: 'task', rockId })} onOpenTask={(taskId) => setModal({ type: 'task-detail', taskId })} onConvertTask={(taskId) => void refresh(workspaceApi.convertRockTaskToTodo(taskId), 'Task linked to a new To-Do.')} onUpdateTask={(taskId, input, expectedVersion) => void refresh(workspaceApi.updateRockTask(taskId, input, expectedVersion), 'Rock Task updated.')} />;
      case 'todos':
        return <TodosView {...common} todos={activeTodos} onUpdateTodo={updateTodoStatus} onEditTodo={(todoId) => setModal({ type: 'todo-detail', todoId })} onAdd={() => setModal({ type: 'todo' })} />;
      case 'issues':
        return <IssuesView {...common} issues={activeIssues} onStartIssue={startIssue} onSolveIssue={solveIssue} onEditIssue={(issueId) => setModal({ type: 'issue-detail', issueId })} onAdd={() => setModal({ type: 'issue' })} onTransfer={(issueId) => setModal({ type: 'transfer', issueId })} />;
      case 'messages':
        return <MessagesView {...common} messages={activeMessages} onCompose={() => setModal({ type: 'message' })} onOpen={openMessage} onMarkRead={markMessageRead} onCreateIssue={(messageId) => setModal({ type: 'message-issue', messageId })} />;
      case 'scorecard':
        if (!activeAgenda.some((section) => section.id === 'scorecard')) return <OverviewView {...common} rocks={activeRocks} todos={activeTodos} issues={activeIssues} metrics={activeMetrics} scorecardResults={activeScorecardResults} headlines={activeHeadlines} meeting={currentMeeting} pendingTransfers={pendingForTeam} pendingSourceTransfers={pendingFromTeam} onStartMeeting={() => navigate('meeting')} onUpdateTodo={updateTodoStatus} onUpdateRock={updateRockStatus} onStartIssue={startIssue} onAccept={acceptTransfer} onReject={(id) => setModal({ type: 'reject', transferId: id })} onCancel={cancelTransfer} />;
        return <ScorecardView {...common} metrics={activeMetrics} results={activeScorecardResults} weekStartDate={selectedScorecardWeek} onWeekChange={setScorecardWeekStartDate} onFlagMetric={(metric, result) => { if (result) void createScorecardIssue(metric, result); }} onAddMetric={() => setModal({ type: 'scorecard-metric' })} onEditMetric={(metricId) => setModal({ type: 'scorecard-metric', metricId })} onEditResult={(metricId, weekStartDate) => setModal({ type: 'scorecard-result', metricId, weekStartDate })} />;
      case 'admin':
        return <AdminView workspace={workspace} environmentAccess={environmentAccess} onToggleEnvironmentAccess={updateEnvironmentAccess} onCreateTeam={() => setModal({ type: 'team' })} onCreateUser={() => setModal({ type: 'user' })} onEditUser={(userId) => setModal({ type: 'edit-user', userId })} onUpdateTeam={(teamId, input) => void refresh(workspaceApi.updateTeam(teamId, input), 'Team settings updated.')} onEditTeam={(teamId) => setModal({ type: 'edit-team', teamId })} onMembership={(input) => void refresh(workspaceApi.upsertMembership(input), 'Team assignment updated.')} onSaveSettings={(settings) => void refresh(workspaceApi.updateAgeSettings(settings), 'Issue aging settings updated.')} />;
      case 'profile':
        return <ProfileView workspace={workspace} onSave={(input) => void refresh(workspaceApi.updateProfile(input), 'Profile updated.')} />;
      case 'overview':
      default:
        return <OverviewView {...common} rocks={activeRocks} todos={activeTodos} issues={activeIssues} metrics={activeMetrics} scorecardResults={activeScorecardResults} headlines={activeHeadlines} meeting={currentMeeting} pendingTransfers={pendingForTeam} pendingSourceTransfers={pendingFromTeam} onStartMeeting={() => navigate('meeting')} onUpdateTodo={updateTodoStatus} onUpdateRock={updateRockStatus} onStartIssue={startIssue} onAccept={acceptTransfer} onReject={(id) => setModal({ type: 'reject', transferId: id })} onCancel={cancelTransfer} />;
    }
  };

  const availableTeams = accessibleTeams;

  if (environmentError) return <EnvironmentGate error={environmentError} />;
  if (!environmentSession || environmentLoading) return <EnvironmentGate />;

  return (
    <div className="app-shell">
      <Sidebar workspace={workspace} team={activeTeam} activeView={activeView} onView={navigate} open={sidebarOpen} />
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation">☰</button>
          <div className="breadcrumb"><img className="topbar-logo" src="/branding/bremmar-light.png" alt="Bremmar" /><span>/</span><strong>{navLabels[activeView]}</strong></div>
          <div className="topbar-actions">
            <EnvironmentSwitcher session={environmentSession} onChange={changeEnvironment} />
            <span className="today-chip"><span className="today-dot" /> {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
            <button className={`icon-button notification-button ${notificationsOpen ? 'icon-button-active' : ''}`} onClick={() => setNotificationsOpen((open) => !open)} aria-label={`Notifications${unreadNotifications.length ? `, ${unreadNotifications.length} unread` : ''}`}><span aria-hidden="true">◌</span>{unreadNotifications.length > 0 && <span className="notification-dot" />}</button>
            <button className="avatar-button" onClick={() => navigate('profile')} aria-label="Open profile"><Avatar user={workspace.currentUser} size="md" /></button>
          </div>
          {notificationsOpen && <NotificationPanel workspace={workspace} notifications={unreadNotifications} onRead={(id) => void refresh(workspaceApi.markNotificationRead(id))} onClose={() => setNotificationsOpen(false)} />}
        </header>
        <div className="page-content">
          <div className="workspace-context">
            <div className="team-context"><span className="team-context-mark" style={{ backgroundColor: activeTeam.accent }}>{activeTeam.initials}</span><div><span className="context-label">Current workspace</span><strong>{activeTeam.name}</strong><small>{teamPath(workspace, activeTeam.id)} · {currentRole ? currentRole : 'Read-only company view'}</small></div></div>
            <label className="team-switcher"><span className="sr-only">Choose team</span><select value={accessibleTeamId} onChange={(event) => changeTeam(event.target.value)}>{availableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}{!canWrite(workspace, team.id) ? ' · Read only' : ''}</option>)}</select><span className="select-arrow">⌄</span></label>
          </div>
          {!hasWorkspaceAccess ? <NoWorkspaceAccess /> : readOnly && activeView !== 'company' && activeView !== 'admin' && <div className="read-only-banner"><span>◉</span><strong>Read-only workspace</strong><span>{currentRole === 'Viewer' ? 'Your Viewer membership allows review only.' : 'You can review this team because you are part of Leadership. Editing is limited to your assigned teams.'}</span></div>}
          {hasWorkspaceAccess && renderView()}
        </div>
      </main>
      {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
      {modal?.type === 'todo' && <TodoModal workspace={workspace} team={activeTeam} onClose={() => setModal(null)} onSubmit={handleCreateTodo} />}
      {modal?.type === 'todo-detail' && <TodoEditModal workspace={workspace} todo={workspace.todos.find((todo) => todo.id === modal.todoId)!} readOnly={readOnly || Boolean(modal.readOnly)} onClose={() => setModal(null)} onSubmit={async (input) => { const todo = workspace.todos.find((item) => item.id === modal.todoId); if (todo && await refresh(workspaceApi.updateTodo(todo.id, input, todo.version), 'To-Do details saved.')) setModal(null); }} onChecklistAdd={addTodoChecklistItem} onChecklistUpdate={updateTodoChecklistItem} onChecklistDelete={deleteTodoChecklistItem} />}
      {modal?.type === 'issue' && <IssueModal workspace={workspace} onClose={() => setModal(null)} onSubmit={handleCreateIssue} />}
      {modal?.type === 'rock' && <RockModal workspace={workspace} onClose={() => setModal(null)} onSubmit={handleCreateRock} />}
      {modal?.type === 'edit-rock' && <RockEditModal workspace={workspace} rock={workspace.rocks.find((rock) => rock.id === modal.rockId)!} onClose={() => setModal(null)} onSubmit={async (input) => { const rock = workspace.rocks.find((item) => item.id === modal.rockId); if (rock && await refresh(workspaceApi.updateRock(rock.id, input, rock.version), 'Rock details saved.')) setModal(null); }} />}
      {modal?.type === 'issue-detail' && <IssueEditModal workspace={workspace} issue={workspace.issues.find((issue) => issue.id === modal.issueId)!} meetingId={modal.meetingId} readOnly={readOnly || Boolean(modal.readOnly)} onClose={() => setModal(null)} onSubmit={async (input, meetingNote) => { const issue = workspace.issues.find((item) => item.id === modal.issueId); if (!issue) return; try { let next = await workspaceApi.updateIssue(issue.id, input, issue.version); if (meetingNote?.trim() && modal.meetingId) { const updated = next.issues.find((item) => item.id === issue.id); next = await workspaceApi.addMeetingIssueNote(issue.id, modal.meetingId, meetingNote, updated?.version); } setWorkspace(next); notify('Issue details and IDS notes saved.'); setModal(null); } catch (error) { notify(error instanceof WorkspaceApiError ? error.message : 'That Issue update could not be saved.'); } }} />}
      {modal?.type === 'solve-issue' && <ResolveIssueModal issue={workspace.issues.find((issue) => issue.id === modal.issueId)!} onClose={() => setModal(null)} onSubmit={(input) => submitSolveIssue(modal.issueId, input)} />}
      {modal?.type === 'task' && <TaskModal workspace={workspace} rock={workspace.rocks.find((rock) => rock.id === modal.rockId)!} onClose={() => setModal(null)} onSubmit={(event) => handleCreateTask(event, modal.rockId)} />}
      {modal?.type === 'task-detail' && <TaskEditModal workspace={workspace} task={workspace.rocks.flatMap((rock) => rock.tasks).find((task) => task.id === modal.taskId)!} readOnly={readOnly} onClose={() => setModal(null)} onSubmit={async (input) => { const task = workspace.rocks.flatMap((rock) => rock.tasks).find((candidate) => candidate.id === modal.taskId); if (task && await refresh(workspaceApi.updateRockTask(task.id, input, task.version), 'Rock Task details saved.')) setModal(null); }} onDelete={() => handleDeleteTask(modal.taskId)} />}
      {modal?.type === 'transfer' && <TransferModal workspace={workspace} issue={workspace.issues.find((issue) => issue.id === modal.issueId)!} onClose={() => setModal(null)} onSubmit={async (destination, note) => { const issue = workspace.issues.find((item) => item.id === modal.issueId); if (await refresh(workspaceApi.requestIssueTransfer(modal.issueId, destination, note, issue?.version), 'Issue transfer requested.')) setModal(null); }} />}
      {modal?.type === 'reject' && <RejectModal transfer={workspace.transfers.find((transfer) => transfer.id === modal.transferId)!} issue={workspace.issues.find((issue) => issue.id === workspace.transfers.find((transfer) => transfer.id === modal.transferId)?.issueId)} onClose={() => setModal(null)} onSubmit={async (message) => { const transfer = workspace.transfers.find((item) => item.id === modal.transferId); if (await refresh(workspaceApi.rejectIssueTransfer(modal.transferId, message, transfer?.version), 'Issue returned to the source team unassigned.')) setModal(null); }} />}
      {modal?.type === 'meeting-schedule' && <MeetingScheduleModal team={activeTeam} meeting={workspace.meetings.find((meeting) => meeting.id === modal.meetingId)!} onClose={() => setModal(null)} onSubmit={(input) => updateMeetingSchedule(modal.meetingId, input)} />}
      {modal?.type === 'meeting-skip' && <MeetingSkipModal meeting={workspace.meetings.find((meeting) => meeting.id === modal.meetingId)!} onClose={() => setModal(null)} onSubmit={(reason, note) => submitSkipMeeting(modal.meetingId, reason, note)} />}
      {modal?.type === 'meeting-start' && <MeetingStartModal workspace={workspace} team={activeTeam} meeting={workspace.meetings.find((meeting) => meeting.id === modal.meetingId)!} onClose={() => setModal(null)} onSubmit={(facilitatorId) => submitStartMeeting(modal.meetingId, facilitatorId)} />}
      {modal?.type === 'team' && <TeamModal workspace={workspace} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.createTeam(input), 'Team created.')) setModal(null); }} />}
      {modal?.type === 'edit-team' && <TeamEditModal workspace={workspace} team={workspace.teams.find((team) => team.id === modal.teamId)!} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.updateTeam(modal.teamId, input), 'Team settings updated.')) setModal(null); }} />}
      {modal?.type === 'user' && <UserModal onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.createUser(input), isLocalPocBuild ? 'Local user created.' : 'Entra-linked user created.')) setModal(null); }} />}
      {modal?.type === 'edit-user' && <UserModal user={workspace.users.find((user) => user.id === modal.userId)!} onClose={() => setModal(null)} onSubmit={async (input) => { const user = workspace.users.find((candidate) => candidate.id === modal.userId); if (user && await refresh(workspaceApi.updateUser(user.id, { name: input.name, email: input.email, platformAdmin: input.platformAdmin }, user.version), 'User details updated.')) setModal(null); }} />}
      {modal?.type === 'message' && <MessageModal workspace={workspace} fromTeam={activeTeam} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.sendTeamMessage(input), 'Message sent to the team.')) setModal(null); }} />}
      {modal?.type === 'message-detail' && <MessageDetailModal workspace={workspace} message={workspace.messages.find((message) => message.id === modal.messageId)!} canCreateIssue={canWrite(workspace, activeTeam.id) && workspace.messages.find((message) => message.id === modal.messageId)?.toTeamId === activeTeam.id} onClose={() => setModal(null)} onMarkRead={markMessageRead} onCreateIssue={() => setModal({ type: 'message-issue', messageId: modal.messageId })} />}
      {modal?.type === 'message-issue' && <MessageIssueModal workspace={workspace} message={workspace.messages.find((message) => message.id === modal.messageId)!} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.createIssueFromMessage(modal.messageId, input), 'Issue created from the team message.')) setModal(null); }} />}
      {modal?.type === 'scorecard-metric' && <ScorecardMetricModal workspace={workspace} team={activeTeam} metric={modal.metricId ? workspace.metrics.find((metric) => metric.id === modal.metricId) : undefined} onClose={() => setModal(null)} onSubmit={modal.metricId ? (input) => updateScorecardMetric(modal.metricId!, input) : (input) => createScorecardMetric({ ...input, teamId: activeTeam.id })} />}
      {modal?.type === 'scorecard-result' && <ScorecardResultModal metric={workspace.metrics.find((item) => item.id === modal.metricId)!} result={workspace.scorecardResults.find((item) => item.metricId === modal.metricId && item.weekStartDate === modal.weekStartDate)} weekStartDate={modal.weekStartDate} onClose={() => setModal(null)} onSubmit={(input) => saveScorecardResult(modal.metricId, modal.weekStartDate, input)} />}
    </div>
  );
}

type ModalState =
  | { type: 'todo' }
  | { type: 'todo-detail'; todoId: string; readOnly?: boolean }
  | { type: 'solve-issue'; issueId: string }
  | { type: 'issue' }
  | { type: 'issue-detail'; issueId: string; meetingId?: string; readOnly?: boolean }
  | { type: 'rock' }
  | { type: 'edit-rock'; rockId: string }
  | { type: 'task'; rockId: string }
  | { type: 'task-detail'; taskId: string }
  | { type: 'transfer'; issueId: string }
  | { type: 'reject'; transferId: string }
  | { type: 'meeting-schedule'; meetingId: string }
  | { type: 'meeting-skip'; meetingId: string }
  | { type: 'meeting-start'; meetingId: string }
  | { type: 'message' }
  | { type: 'message-detail'; messageId: string }
  | { type: 'message-issue'; messageId: string }
  | { type: 'scorecard-metric'; metricId?: string }
  | { type: 'scorecard-result'; metricId: string; weekStartDate: string }
  | { type: 'team' }
  | { type: 'edit-team'; teamId: string }
  | { type: 'user' }
  | { type: 'edit-user'; userId: string }
  | null;

function EnvironmentGate({ error }: { error?: string }) {
  return <div className="environment-gate"><div className="environment-gate-card"><span className="section-kicker">AUTHENTICATED WORKSPACE</span><h1>{error ? 'Workspace unavailable' : 'Loading your workspace'}</h1><p>{error ?? 'Checking your environment access and loading the Live workspace.'}</p>{error && <button className="button button-secondary" onClick={() => window.location.reload()}>Try again</button>}</div></div>;
}

function MeetingSetupView({ team, readOnly, onNavigate }: { team: Team; readOnly: boolean; onNavigate: (view: ViewId) => void }) {
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · ${cadenceLabel(team.meetingCadence).toUpperCase()} RHYTHM`} title="No L10 meeting yet." description="The team workspace is connected, but this environment does not have a meeting record to open." actions={<Button variant="secondary" onClick={() => onNavigate('overview')}>Back to My week</Button>} /><div className="loading-card card-surface"><EmptyState title="The meeting shell still needs to be bootstrapped" detail={readOnly ? 'Ask an OrgAdmin to rerun the environment bootstrap. Your profile can read this team, but cannot create its meeting record.' : 'Rerun the environment bootstrap after deployment. It is additive and will create the missing meeting shell without replacing workspace data.'} /></div></>;
}

function EnvironmentSwitcher({ session, onChange }: { session: EnvironmentSession; onChange: (environment: EnvironmentId) => void }) {
  const environments = session.availableEnvironments.filter((environment) => environment.id === 'live' || environment.id === 'test');
  const selected = environments.find((environment) => environment.id === session.currentEnvironment)?.label ?? (session.currentEnvironment === 'test' ? 'Test' : 'Live');
  const canChoose = environments.length > 1;
  return <div className={`environment-switcher environment-${session.currentEnvironment} ${canChoose ? 'environment-switcher-multiple' : 'environment-switcher-single'}`}>
    <span className="environment-badge-dot" aria-hidden="true" />
    {canChoose ? <>
      <span className="environment-switcher-heading">Environment</span>
      <div className="environment-options" role="group" aria-label="Choose environment">
        {environments.map((environment) => <button type="button" key={environment.id} className={`environment-option ${session.currentEnvironment === environment.id ? 'environment-option-active' : ''}`} aria-pressed={session.currentEnvironment === environment.id} aria-label={`Use ${environment.label} environment`} onClick={() => onChange(environment.id)}>{environment.label}</button>)}
      </div>
    </> : <span className="environment-switcher-value">{selected}</span>}
  </div>;
}

function Sidebar({ workspace, team, activeView, onView, open }: { workspace: Workspace; team: Team; activeView: ViewId; onView: (view: ViewId) => void; open: boolean }) {
  const items: Array<{ id: ViewId; label: string; icon: string; group?: string }> = [
    { id: 'overview', label: 'My week', icon: '⌂' },
    ...(hasCompanyRead(workspace) ? [{ id: 'company' as ViewId, label: 'Company overview', icon: '◎' }] : []),
    { id: 'meeting', label: 'Live L10', icon: '◷' },
    { id: 'meeting-history', label: 'Past meetings', icon: '▤' },
    { id: 'rocks', label: 'Rocks', icon: '◇', group: 'WORKSPACE' },
    { id: 'todos', label: 'To-Dos', icon: '✓' },
    { id: 'issues', label: 'Issues', icon: '!', },
    { id: 'messages', label: 'Team messages', icon: '✉' },
    ...(meetingSectionsFor(team).some((section) => section.id === 'scorecard') ? [{ id: 'scorecard' as ViewId, label: 'Scorecard', icon: '◒' }] : []),
    ...(isPlatformAdmin(workspace) ? [{ id: 'admin' as ViewId, label: 'Admin', icon: '⚙', group: 'ORGANISATION' }] : []),
  ];
  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}><div className="brand-lockup"><img className="brand-logo brand-logo-dark" src="/branding/bremmar-dark.png" alt="Bremmar" /></div><div className="sidebar-rule" /><nav className="sidebar-nav">{items.map((item) => <div key={item.id}>{item.group && <div className="nav-group-label">{item.group}</div>}<button className={`nav-item ${activeView === item.id ? 'nav-active' : ''}`} onClick={() => onView(item.id)}><span className="glyph">{item.icon}</span><span>{item.label}</span>{item.id === 'issues' && <span className="nav-count">{workspace.issues.filter((issue) => issue.status !== 'solved' && issue.assignmentState !== 'redirected').length}</span>}</button></div>)}</nav><div className="sidebar-spacer" /><div className="quarter-mini"><div className="quarter-mini-top"><span className="nav-group-label">CURRENT QUARTER</span><span className="quarter-mini-badge">Q3</span></div><strong>{workspace.quarter.theme}</strong><div className="mini-progress"><span style={{ width: '67%' }} /></div><span className="quarter-mini-note">{workspace.quarter.daysRemaining} days remaining</span></div><button className="sidebar-user" onClick={() => onView('profile')}><Avatar user={workspace.currentUser} size="md" /><span><strong>{workspace.currentUser.name}</strong><small>{workspace.currentUser.platformCapabilities.includes('PlatformAdmin') ? 'Platform Admin' : 'Team member'}</small></span><span className="sidebar-more">•••</span></button></aside>;
}

function Avatar({ user, size = 'md' }: { user: User; size?: 'sm' | 'md' | 'lg' }) {
  if (user.avatarDataUrl) return <img className={`avatar avatar-${size} avatar-image`} src={user.avatarDataUrl} alt={user.name} title={user.name} />;
  return <span className={`avatar avatar-${size}`} style={{ backgroundColor: user.accent }} title={user.name} aria-label={user.name}>{user.initials || initialsFor(user.name)}</span>;
}

function AvatarStack({ workspace, ids }: { workspace: Workspace; ids: string[] }) {
  return <span className="avatar-stack" aria-label={`${ids.length} attendees`}>{ids.slice(0, 4).map((id) => <Avatar key={id} user={userFor(workspace, id)} size="sm" />)}{ids.length > 4 && <span className="avatar avatar-sm avatar-more">+{ids.length - 4}</span>}</span>;
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  const tone = status === 'on-track' || status === 'complete' || status === 'done' || status === 'solved' || status === 'closed' ? 'positive' : status === 'off-track' || status === 'not-done' || status === 'unassigned' || status === 'missed' || status === 'overdue' || status === 'skipped' ? 'negative' : status === 'in-ids' || status === 'pending-transfer' || status === 'in-progress' ? 'blue' : 'warning';
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{label ?? statusLabel(status)}</span>;
}

function AgePill({ issue }: { issue: Issue }) {
  const labels: Record<IssueMeetingBand, string> = { neutral: 'No meetings', green: '1 meeting', yellow: '2 meetings', orange: '3 meetings', red: '4+ meetings' };
  return <span className={`meeting-health-pill ${healthClass(issue.meetingBand)}`}><span>{labels[issue.meetingBand]}</span><small>{issue.meetingsPassed} passed</small></span>;
}

function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'coral' | 'teal' | 'lavender' }) {
  return <div className={`progress-track progress-${tone}`}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function Button({ children, variant = 'primary', onClick, type = 'button', disabled = false, className = '' }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean; className?: string }) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-header-actions">{actions}</div>}</div>;
}

function MeetingOccurrencePanel({ team, occurrences, selectedMeetingId, canManageSchedule, onSelect, onStart, onSkip, onReschedule }: { team: Team; occurrences: Workspace['meetings']; selectedMeetingId: string; canManageSchedule: boolean; onSelect: (meetingId: string) => void; onStart: (meeting: Workspace['meetings'][number]) => void; onSkip: (meeting: Workspace['meetings'][number]) => void; onReschedule: (meeting: Workspace['meetings'][number]) => void }) {
  const listed = [...occurrences].sort((left, right) => meetingScheduledAt(left) - meetingScheduledAt(right)).slice(0, 8);
  const futureUpcomingCount = occurrences.filter((meeting) => meeting.status === 'upcoming' && meetingReviewStatus(meeting, team) === 'upcoming').length;
  return <section className="meeting-occurrence-panel card-surface"><div className="meeting-occurrence-heading"><div><span className="section-kicker">MEETING OCCURRENCES</span><h2>Choose the L10 to open</h2></div><span>{futureUpcomingCount} upcoming in the rolling window</span></div><div className="meeting-occurrence-list">{listed.map((meeting) => { const reviewStatus = meetingReviewStatus(meeting, team); const open = meeting.status === 'upcoming' || meeting.status === 'in-progress'; return <div className={`meeting-occurrence-row ${selectedMeetingId === meeting.id ? 'meeting-occurrence-selected' : ''}`} key={meeting.id}><button className="meeting-occurrence-main" onClick={() => onSelect(meeting.id)}><span className="occurrence-date"><strong>{formatDate(meeting.scheduledDate ?? '')}</strong><small>{meeting.scheduledTime ?? team.meetingTime}</small></span><span className="occurrence-copy"><strong>{meeting.label}</strong><small>{meeting.startedAt ? `Started ${formatTime(meeting.startedAt)}` : meeting.status === 'skipped' ? 'Not started' : 'Ready to start'}</small></span><StatusPill status={reviewStatus} /></button><div className="meeting-occurrence-actions">{canManageSchedule && open && <Button variant={meeting.status === 'in-progress' ? 'secondary' : 'primary'} onClick={() => onStart(meeting)}>{meeting.status === 'in-progress' ? 'Resume' : 'Start'}</Button>}{canManageSchedule && meeting.status === 'upcoming' && <><Button variant="quiet" onClick={() => onSkip(meeting)}>Skip</Button><Button variant="quiet" onClick={() => onReschedule(meeting)}>Reschedule</Button></>}</div></div>; })}{listed.length === 0 && <EmptyState title="No meeting occurrences" detail="An OrgAdmin can bootstrap the first meeting for this team." />}</div></section>;
}

function MeetingAiSummaryPanel({ meeting, canRetry, onRequestSummary }: { meeting: Workspace['meetings'][number]; canRetry: boolean; onRequestSummary: () => Promise<boolean> }) {
  const [requesting, setRequesting] = useState(false);
  const status = meeting.aiSummaryStatus ?? (meeting.status === 'closed' ? 'not-generated' : undefined);
  const request = async () => {
    setRequesting(true);
    await onRequestSummary();
    setRequesting(false);
  };
  return <section className="meeting-ai-summary"><div className="recap-section-heading"><div><span className="section-kicker">AI RECAP</span><h2>Turn the record into a useful next step.</h2></div>{status && <StatusPill status={status} label={status === 'not-generated' ? 'Not generated' : status === 'generating' ? 'Generating' : status === 'queued' ? 'Queued' : status === 'ready' ? 'Ready' : 'Failed'} />}</div>{(status === 'queued' || status === 'generating') && <div className="ai-summary-state ai-summary-pending"><span className="ai-summary-orbit">✦</span><div><strong>AI summary is being generated</strong><p>The close-time meeting context has been queued. This page will update when the structured recap is ready.</p></div></div>}{status === 'failed' && <div className="ai-summary-state ai-summary-failed"><strong>AI summary could not be generated.</strong><p>{meeting.aiSummaryError ?? 'The AI worker reported an error. The manual recap remains available.'}</p>{canRetry && <Button onClick={() => void request()} disabled={requesting}>{requesting ? 'Retrying…' : 'Retry summary'}</Button>}</div>}{status === 'not-generated' && <div className="ai-summary-state"><strong>No AI summary has been generated yet.</strong><p>This older meeting can be sent through the summary worker once using its persisted meeting record.</p>{canRetry && <Button variant="secondary" onClick={() => void request()} disabled={requesting}>{requesting ? 'Queuing…' : 'Generate summary'}</Button>}</div>}{status === 'ready' && meeting.aiSummary && <div className="ai-summary-ready"><div className="ai-summary-executive"><span className="section-kicker">EXECUTIVE SUMMARY</span><p>{meeting.aiSummary.executiveSummary}</p></div><div className="ai-summary-grid"><SummaryList title="Decisions" items={meeting.aiSummary.decisions} /><SummaryList title="Commitments" items={meeting.aiSummary.commitments} /><SummaryList title="Risks" items={meeting.aiSummary.risks} /><SummaryList title="Next focus" items={meeting.aiSummary.nextFocus} /></div><small className="ai-summary-generated">Generated {meeting.aiSummaryGeneratedAt ? `${formatDate(meeting.aiSummaryGeneratedAt)} · ${formatTime(meeting.aiSummaryGeneratedAt)}` : 'from the meeting record'}.</small>{canRetry && <div className="ai-summary-actions"><Button variant="secondary" onClick={() => void request()} disabled={requesting}>{requesting ? 'Queuing…' : 'Regenerate recap'}</Button></div>}</div>}</section>;
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return <div className="summary-list"><strong>{title}</strong>{items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}</ul> : <span>Nothing captured.</span>}</div>;
}

function MeetingRecapView({ workspace, team, meeting, canRetry, onRequestSummary, onBack }: { workspace: Workspace; team: Team; meeting: Workspace['meetings'][number]; canRetry: boolean; onRequestSummary: () => Promise<boolean>; onBack: () => void }) {
  const actionSummary = meeting.actionSummary ?? { todosCreated: meeting.createdTodoIds.length, issuesReviewedInIds: meeting.idsIssueIds.length, issuesAddedToIds: meeting.idsAddedIssueIds.length, issuesSolved: meeting.idsSolved };
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · MEETING RECAP`} title="Meeting complete." description="The manual recap is saved and the structured AI recap will stay with this meeting record." actions={<Button variant="secondary" onClick={onBack}>Back to Live L10</Button>} /><div className="recap-meta-strip card-surface"><div><span>Meeting</span><strong>{meetingDateTimeLabel(meeting)}</strong></div><div><span>Facilitator</span><strong>{meeting.facilitatorId ? userFor(workspace, meeting.facilitatorId).name : 'Not recorded'}</strong></div><div><span>Started</span><strong>{meeting.startedAt ? `${formatDate(meeting.startedAt)} · ${formatTime(meeting.startedAt)}` : 'Not recorded'}</strong></div><div><span>Closed</span><strong>{meeting.closedAt ? `${formatDate(meeting.closedAt)} · ${formatTime(meeting.closedAt)}` : '—'}</strong></div><div><span>Duration</span><strong>{meeting.durationSeconds !== undefined ? formatDuration(meeting.durationSeconds) : 'Not recorded'}</strong></div><div><span>Attendance</span><strong>{meeting.attendeeIds.length} invited</strong></div></div><div className="recap-layout"><section className="recap-manual card-surface"><div className="recap-section-heading"><div><span className="section-kicker">MANUAL RECAP</span><h2>What the team needs to remember</h2></div><StatusPill status="closed" label={`${meeting.lastRating || '—'}/10 rating`} /></div><p className="recap-copy">{meeting.recap || 'No written recap was entered.'}</p><div className="meeting-action-summary">{[['To-Dos created', actionSummary.todosCreated], ['Issues reviewed', actionSummary.issuesReviewedInIds], ['Added to IDS', actionSummary.issuesAddedToIds], ['Issues solved', actionSummary.issuesSolved]].map(([label, value]) => <div key={String(label)}><strong>{value}</strong><span>{label}</span></div>)}</div><div className="recap-attendees"><span className="section-kicker">ATTENDANCE</span><div><AvatarStack workspace={workspace} ids={meeting.attendeeIds} /><span>{meeting.attendeeIds.map((id) => userFor(workspace, id).name).join(', ') || 'No attendees recorded.'}</span></div></div>{meeting.attendeeRatings && meeting.attendeeRatings.length > 0 && <div className="recap-attendee-ratings"><span className="section-kicker">INDIVIDUAL RATINGS</span>{meeting.attendeeRatings.map((entry) => <div key={entry.attendeeId}><span>{userFor(workspace, entry.attendeeId).name}</span><strong>{entry.rating}/10</strong></div>)}</div>}</section><MeetingAiSummaryPanel meeting={meeting} canRetry={canRetry} onRequestSummary={onRequestSummary} /></div><MeetingRecordSections workspace={workspace} meeting={meeting} /></>;
}

function MeetingRecordSections({ workspace, meeting }: { workspace: Workspace; meeting: Workspace['meetings'][number] }) {
  const agendaNotes = Object.entries(meeting.sectionNotes ?? {}).filter(([, note]) => Boolean(note?.trim()));
  const createdTodos = meeting.createdTodoIds.map((id) => workspace.todos.find((todo) => todo.id === id)?.title ?? id);
  const sectionDurations = Object.entries(meeting.sectionDurations ?? {}).filter(([, seconds]) => seconds !== undefined);
  return <div className="meeting-record-sections"><section className="card-surface record-section"><div className="recap-section-heading"><div><span className="section-kicker">MEETING TIMING</span><h2>Time spent in the room</h2></div></div><div className="timing-record-grid"><div><span>Overall meeting</span><strong>{meeting.durationSeconds !== undefined ? formatDuration(meeting.durationSeconds) : 'Not recorded'}</strong></div>{sectionDurations.map(([section, seconds]) => <div key={section}><span>{statusLabel(section)}</span><strong>{formatDuration(seconds ?? 0)}</strong></div>)}</div></section><section className="card-surface record-section"><div className="recap-section-heading"><div><span className="section-kicker">AGENDA NOTES</span><h2>Notes captured during the L10</h2></div></div>{agendaNotes.length ? agendaNotes.map(([section, note]) => <div className="record-note" key={section}><strong>{statusLabel(section)}</strong><p>{note}</p></div>) : <EmptyState title="No agenda notes" detail="The team did not add section notes to this meeting." />}</section><section className="card-surface record-section"><div className="recap-section-heading"><div><span className="section-kicker">IDS RECORD</span><h2>Decisions and created commitments</h2></div></div>{meeting.idsNotes.length ? meeting.idsNotes.map((note) => <div className="record-note" key={note.id}><strong>{userFor(workspace, note.authorId).name} · {formatDate(note.createdAt)}</strong><p>{note.note}</p></div>) : <p className="record-empty">No separate IDS notes were captured.</p>}{createdTodos.length > 0 && <div className="record-created-todos"><strong>Created To-Dos</strong><ul>{createdTodos.map((todo, index) => <li key={`${todo}-${index}`}>{todo}</li>)}</ul></div>}</section>{meeting.status === 'skipped' && <section className="card-surface record-section skip-detail"><div className="recap-section-heading"><div><span className="section-kicker">SKIP DETAILS</span><h2>Why this occurrence was skipped</h2></div></div><p><strong>{meeting.skipReason === 'public-holiday' ? 'Public holiday' : meeting.skipReason === 'annual-leave' ? 'Annual leave' : 'Other reason'}</strong>{meeting.skipNote ? ` · ${meeting.skipNote}` : ''}</p><small>{meeting.skippedAt ? `Recorded ${formatDate(meeting.skippedAt)} · ${formatTime(meeting.skippedAt)}` : 'Recorded in the meeting audit trail.'}</small></section>}</div>;
}

function MeetingHistoryView({ workspace, teams, onRequestSummary, onOpenMeeting }: { workspace: Workspace; teams: Team[]; onRequestSummary: (teamId: string, meetingId: string, expectedVersion?: number) => Promise<boolean>; onOpenMeeting: (teamId: string, meetingId: string) => void }) {
  const [filter, setFilter] = useState<'attention' | 'completed' | 'skipped' | 'all'>('attention');
  const [teamFilter, setTeamFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = useMemo(() => workspace.meetings.map((meeting) => { const team = teamFor(workspace, meeting.teamId); return { meeting, team, reviewStatus: meetingReviewStatus(meeting, team) }; }).filter(({ team, reviewStatus }) => teams.some((candidate) => candidate.id === team.id) && (teamFilter === 'all' || team.id === teamFilter) && (filter === 'attention' ? reviewStatus === 'missed' || reviewStatus === 'overdue' : filter === 'completed' ? reviewStatus === 'closed' : filter === 'skipped' ? reviewStatus === 'skipped' : true)).sort((left, right) => meetingScheduledAt(right.meeting) - meetingScheduledAt(left.meeting)), [filter, teamFilter, teams, workspace]);
  const selected = items.find((item) => item.meeting.id === selectedId) ?? items[0];
  useEffect(() => {
    if (selected && selected.meeting.id !== selectedId) setSelectedId(selected.meeting.id);
    if (!selected) setSelectedId(null);
  }, [selected, selectedId]);
  const counts = useMemo(() => ({ attention: workspace.meetings.filter((meeting) => { const team = teamFor(workspace, meeting.teamId); const status = meetingReviewStatus(meeting, team); return teams.some((candidate) => candidate.id === team.id) && (status === 'missed' || status === 'overdue'); }).length, completed: workspace.meetings.filter((meeting) => teams.some((team) => team.id === meeting.teamId) && meeting.status === 'closed').length, skipped: workspace.meetings.filter((meeting) => teams.some((team) => team.id === meeting.teamId) && meeting.status === 'skipped').length }), [teams, workspace]);
  return <><PageHeader eyebrow="MEETING HISTORY" title="Review the room over time." description="See the meetings that need attention, review completed decisions, and keep missed cadence visible across the teams you can read." actions={<div className="history-filter-buttons">{([['attention', `Attention · ${counts.attention}`], ['completed', `Completed · ${counts.completed}`], ['skipped', `Skipped · ${counts.skipped}`], ['all', 'All records']] as const).map(([value, label]) => <button className={`history-filter-button ${filter === value ? 'history-filter-active' : ''}`} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>} /><div className="history-toolbar card-surface"><label>Team<select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">All accessible teams</option>{teams.filter((team) => team.nodeType === 'operational').map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><span>{items.length} {items.length === 1 ? 'meeting' : 'meetings'} in this view</span></div><div className="meeting-history-layout card-surface"><div className="history-list">{items.map(({ meeting, team, reviewStatus }) => <button className={`history-list-row ${selected?.meeting.id === meeting.id ? 'history-list-selected' : ''}`} key={meeting.id} onClick={() => setSelectedId(meeting.id)}><span className="history-list-date"><strong>{formatDate(meeting.scheduledDate ?? '')}</strong><small>{meeting.scheduledTime ?? team.meetingTime}</small></span><span className="history-list-copy"><strong>{team.shortName} L10</strong><small>{meeting.startedAt ? `Started ${formatTime(meeting.startedAt)}` : meeting.status === 'skipped' ? 'Skipped occurrence' : 'No start recorded'}</small></span><StatusPill status={reviewStatus} /></button>)}{items.length === 0 && <EmptyState title={filter === 'attention' ? 'No missed or overdue meetings' : 'No meetings in this view'} detail={filter === 'attention' ? 'The cadence is caught up across the teams you can review.' : 'Try another history filter or team.'} />}</div><div className="history-detail">{selected ? <MeetingHistoryDetail workspace={workspace} item={selected} canRetry={canManageMeetingSummary(workspace, selected.team.id)} onRequestSummary={() => onRequestSummary(selected.team.id, selected.meeting.id, selected.meeting.version)} onOpenMeeting={() => onOpenMeeting(selected.team.id, selected.meeting.id)} /> : <EmptyState title="Select a meeting" detail="Choose a meeting from the history list to review its record." />}</div></div></>;
}

function MeetingHistoryDetail({ workspace, item, canRetry, onRequestSummary, onOpenMeeting }: { workspace: Workspace; item: { meeting: Workspace['meetings'][number]; team: Team; reviewStatus: string }; canRetry: boolean; onRequestSummary: () => Promise<boolean>; onOpenMeeting: () => void }) {
  const { meeting, team, reviewStatus } = item;
  return <><div className="history-detail-head"><div><span className="section-kicker">{team.name.toUpperCase()}</span><h2>{meeting.label}</h2><p>{meetingDateTimeLabel(meeting)}</p></div><div><StatusPill status={reviewStatus} /><Button variant="secondary" onClick={onOpenMeeting}>Open record</Button></div></div><div className="history-detail-meta"><span><strong>Facilitator</strong>{meeting.facilitatorId ? userFor(workspace, meeting.facilitatorId).name : 'Not recorded'}</span><span><strong>Started</strong>{meeting.startedAt ? `${formatDate(meeting.startedAt)} · ${formatTime(meeting.startedAt)}` : 'Not started'}</span><span><strong>Closed</strong>{meeting.closedAt ? `${formatDate(meeting.closedAt)} · ${formatTime(meeting.closedAt)}` : 'Still open'}</span><span><strong>Duration</strong>{meeting.durationSeconds !== undefined ? formatDuration(meeting.durationSeconds) : 'Not recorded'}</span><span><strong>Attendance</strong>{meeting.attendeeIds.length} invited</span></div>{meeting.status === 'skipped' && <div className="history-skip-callout"><strong>Skipped: {meeting.skipReason === 'public-holiday' ? 'Public holiday' : meeting.skipReason === 'annual-leave' ? 'Annual leave' : 'Other'}</strong><span>{meeting.skipNote || 'No note was added.'}</span></div>}{meeting.status === 'closed' ? <><section className="history-manual-recap"><span className="section-kicker">MANUAL RECAP</span><h3>{meeting.lastRating || '—'}/10 rating</h3><p>{meeting.recap || 'No manual recap was entered.'}</p>{meeting.attendeeRatings && meeting.attendeeRatings.length > 0 && <div className="history-attendee-ratings"><span className="section-kicker">INDIVIDUAL RATINGS</span>{meeting.attendeeRatings.map((entry) => <span key={entry.attendeeId}>{userFor(workspace, entry.attendeeId).name}: <strong>{entry.rating}/10</strong></span>)}</div>}</section><MeetingAiSummaryPanel meeting={meeting} canRetry={canRetry} onRequestSummary={onRequestSummary} /></> : <div className="history-open-note"><strong>{reviewStatus === 'missed' ? 'This meeting was missed.' : reviewStatus === 'overdue' ? 'This meeting is overdue.' : 'This occurrence is not complete yet.'}</strong><p>Open Live L10 to resume the meeting or manage the occurrence.</p></div>}<MeetingRecordSections workspace={workspace} meeting={meeting} /></>;
}

function MeetingStartModal({ workspace, team, meeting, onClose, onSubmit }: { workspace: Workspace; team: Team; meeting: Workspace['meetings'][number]; onClose: () => void; onSubmit: (facilitatorId: string) => void }) {
  const teamUsers = workspace.memberships
    .filter((membership) => membership.teamId === team.id && membership.active)
    .map((membership) => workspace.users.find((user) => user.id === membership.userId))
    .filter((user): user is User => Boolean(user && user.active));
  const fallback = teamUsers.find((user) => user.id === meeting.facilitatorId)?.id ?? teamUsers.find((user) => user.id === workspace.currentUser.id)?.id ?? teamUsers[0]?.id ?? workspace.currentUser.id;
  const [facilitatorId, setFacilitatorId] = useState(fallback);
  return <ModalShell title="Start the L10" description="Choose the facilitator for this meeting. They will own the live flow, enter individual attendee ratings, and close the saved record." onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); if (facilitatorId) onSubmit(facilitatorId); }}>
      <div className="meeting-start-preview"><span className="section-kicker">{team.name.toUpperCase()}</span><strong>{meeting.label}</strong><span>{meetingDateTimeLabel(meeting)}</span></div>
      <label>Facilitator<select value={facilitatorId} onChange={(event) => setFacilitatorId(event.target.value)} required disabled={meeting.status === 'in-progress' && Boolean(meeting.facilitatorId)}>{teamUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <small className="form-help">The facilitator is stored on the meeting and shown in the recap and meeting history. Attendees can be rated individually at Conclude.</small>
      <ModalActions onClose={onClose} submitLabel={meeting.status === 'in-progress' ? 'Resume meeting' : 'Start meeting'} />
    </form>
  </ModalShell>;
}

function TransferNotice({ workspace, teamId, pendingTransfers, pendingSourceTransfers, editable, onAccept, onReject, onCancel }: { workspace: Workspace; teamId: string; pendingTransfers: IssueTransfer[]; pendingSourceTransfers: IssueTransfer[]; editable: boolean; onAccept: (transferId: string) => void; onReject: (transferId: string) => void; onCancel: (transferId: string) => void }) {
  if (!pendingTransfers.length && !pendingSourceTransfers.length) return null;
  return <section className="transfer-notices"><div className="transfer-notice-heading"><span className="notice-symbol">⇄</span><div><span className="section-kicker">TEAM HANDOFFS</span><h2>Incoming Issues need a decision.</h2></div></div>{pendingTransfers.map((transfer) => { const issue = workspace.issues.find((item) => item.id === transfer.issueId); if (!issue) return null; const source = teamFor(workspace, transfer.sourceTeamId); return <div className="transfer-row" key={transfer.id}><div className="transfer-row-copy"><strong>{issue.title}</strong><span>{source.name} sent this Issue here · {ageLabel(issue)} old</span></div>{editable ? <div className="transfer-row-actions"><Button variant="secondary" onClick={() => onReject(transfer.id)}>Reject</Button><Button onClick={() => onAccept(transfer.id)}>Accept</Button></div> : <span className="read-only-label">Decision restricted to team editors</span>}</div>; })}{pendingSourceTransfers.map((transfer) => { const issue = workspace.issues.find((item) => item.id === transfer.issueId); if (!issue) return null; const destination = teamFor(workspace, transfer.destinationTeamId); return <div className="transfer-row transfer-row-pending" key={transfer.id}><div className="transfer-row-copy"><strong>Waiting for {destination.name}</strong><span>{issue.title} · sent {formatDate(transfer.requestedAt)}</span></div>{editable && <Button variant="quiet" onClick={() => onCancel(transfer.id)}>Cancel transfer</Button>}</div>; })}<small className="notice-footnote">{pendingTransfers.length ? editable ? 'Any team editor can decide. The first decision wins.' : 'A TeamLead or Member must decide. You can review the request.' : `The Issue remains in ${teamFor(workspace, teamId).name} until the destination responds.`}</small></section>;
}

function OverviewView({ workspace, team, readOnly, rocks, todos, issues, metrics, scorecardResults, headlines, meeting, pendingTransfers, pendingSourceTransfers, onStartMeeting, onUpdateTodo, onUpdateRock, onStartIssue, onAccept, onReject, onCancel, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; rocks: Rock[]; todos: Todo[]; issues: Issue[]; metrics: ScorecardMetric[]; scorecardResults: ScorecardResult[]; headlines: Workspace['headlines']; meeting?: Workspace['meetings'][number]; pendingTransfers: IssueTransfer[]; pendingSourceTransfers: IssueTransfer[]; onStartMeeting: () => void; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onUpdateRock: (rock: Rock) => void; onStartIssue: (issue: Issue) => void; onAccept: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void; onNavigate: (view: ViewId) => void }) {
  const mine = todos.filter((todo) => todo.ownerId === workspace.currentUser.id);
  const openMine = mine.filter((todo) => todo.status !== 'done');
  const activeIssues = issues.filter((issue) => issue.status !== 'solved');
  const onTrackRocks = rocks.filter((rock) => rock.status !== 'off-track').length;
  const completedTodos = todos.filter((todo) => todo.status === 'done').length;
  const week = meeting?.weekStartDate ?? weekStartDateFor(new Date());
  const offTrackMetrics = metrics.filter((metric) => scorecardResults.some((result) => result.metricId === metric.id && result.weekStartDate === week && result.status === 'off-track')).length;
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · ${workspace.quarter.label}`} title={`Good morning, ${workspace.currentUser.name.split(' ')[0]}.`} description={readOnly ? 'Review the team pulse and company context. Editing is limited to your assigned teams.' : 'Here’s what needs your attention before the team meets.'} actions={<><Button variant="secondary" onClick={() => onNavigate('issues')}>Review Issues ↗</Button><Button onClick={onStartMeeting} disabled={!meeting}>Start L10 →</Button></>} /><TransferNotice workspace={workspace} teamId={team.id} pendingTransfers={pendingTransfers} pendingSourceTransfers={pendingSourceTransfers} editable={!readOnly} onAccept={onAccept} onReject={onReject} onCancel={onCancel} /><section className="overview-top-grid"><article className="quarter-hero card-surface"><div className="hero-content"><span className="eyebrow eyebrow-light">{workspace.quarter.label} · OPERATING RHYTHM</span><h2>{workspace.quarter.theme}</h2><p>One quarter. Fewer priorities. More traction.</p><div className="hero-progress"><div className="progress-label"><span>Quarter progress</span><strong>67%</strong></div><ProgressBar value={67} /></div><div className="hero-foot"><span><span className="live-dot" /> {workspace.quarter.daysRemaining} days remaining</span><span>{formatDate(workspace.quarter.startDate)} — {formatDate(workspace.quarter.endDate)}</span></div></div><div className="hero-rings" aria-hidden="true"><span /><span /><span /></div></article><article className="next-meeting-card card-surface"><div className="card-topline"><span className="card-kicker"><span className="meeting-live-dot" /> NEXT MEETING</span><span className="card-menu">•••</span></div>{meeting ? <><h3>{meeting.label}</h3><div className="meeting-time"><span className="calendar-icon">▣</span><div><strong>{meeting.dateLabel}</strong><span>{team.memberCount} people · {cadenceLabel(team.meetingCadence)} · {meeting.scheduledTime ?? team.meetingTime} · 90 minutes</span></div></div><div className="meeting-card-footer"><AvatarStack workspace={workspace} ids={meeting.attendeeIds} /><Button variant="quiet" onClick={onStartMeeting}>Open agenda →</Button></div></> : <><h3>No L10 scheduled</h3><div className="meeting-time"><span className="calendar-icon">＋</span><div><strong>The workspace shell is ready.</strong><span>Rerun environment bootstrap to create this team’s first {cadenceLabel(team.meetingCadence).toLowerCase()} meeting.</span></div></div><div className="meeting-card-footer"><span className="form-help">{readOnly ? 'Ask an OrgAdmin to finish setup.' : 'An OrgAdmin can finish setup.'}</span><Button variant="quiet" onClick={() => onNavigate('meeting')}>View setup →</Button></div></>}</article></section><section className="stat-grid"><button className="stat-card card-surface" onClick={() => onNavigate('rocks')}><div className="stat-card-head"><span className="stat-icon stat-icon-brand">◇</span><span className="stat-trend positive-text">Quarter</span></div><strong className="stat-number">{onTrackRocks}<small>/{rocks.length}</small></strong><span className="stat-label">Rocks on track</span><ProgressBar value={rocks.length ? onTrackRocks / rocks.length * 100 : 0} /></button><button className="stat-card card-surface" onClick={() => onNavigate('todos')}><div className="stat-card-head"><span className="stat-icon stat-icon-teal">✓</span><span className="stat-trend positive-text">Weekly</span></div><strong className="stat-number">{completedTodos}<small>/{todos.length}</small></strong><span className="stat-label">To-Dos complete</span><ProgressBar value={todos.length ? completedTodos / todos.length * 100 : 0} tone="teal" /></button><button className="stat-card card-surface" onClick={() => onNavigate('issues')}><div className="stat-card-head"><span className="stat-icon stat-icon-lavender">!</span><span className="stat-trend warning-text">{offTrackMetrics ? `${offTrackMetrics} scorecard flag` : 'All metrics clear'}</span></div><strong className="stat-number">{activeIssues.length}<small> active</small></strong><span className="stat-label">Issues to solve</span><div className="issue-dots"><span /><span /><span /><span className="dot-muted" /></div></button></section><section className="content-grid"><div className="main-column"><SectionHeading kicker="ACCOUNTABILITY" title="Your week" action="View all To-Dos →" onClick={() => onNavigate('todos')} /><div className="commitment-card card-surface"><div className="commitment-card-head"><div><h3>My commitments</h3><p>{openMine.length} open items need your attention</p></div><span className="completion-ring"><strong>{mine.filter((todo) => todo.status === 'done').length}</strong><small>/ {mine.length}</small></span></div><div className="todo-list">{openMine.slice(0, 4).map((todo) => <TodoRow key={todo.id} workspace={workspace} todo={todo} readOnly={readOnly} onToggle={() => onUpdateTodo(todo)} />)}{openMine.length === 0 && <EmptyState title="A clear week" detail={mine.length ? 'All your visible To-Dos are complete.' : 'You have no open To-Dos assigned to you.'} />}</div></div><SectionHeading kicker="QUARTERLY PRIORITIES" title="Rocks to watch" action="Open Rock sheet →" onClick={() => onNavigate('rocks')} /><div className="rocks-watch-card card-surface">{rocks.filter((rock) => rock.status !== 'complete').slice(0, 3).map((rock) => <RockRow key={rock.id} workspace={workspace} rock={rock} readOnly={readOnly} onUpdate={() => onUpdateRock(rock)} />)}</div></div><div className="side-column"><SectionHeading kicker="TEAM PULSE" title="At a glance" /><div className="pulse-card card-surface"><div className="pulse-score"><span className="pulse-score-number">{meeting?.lastRating?.toFixed(1) ?? '—'}</span><span className="pulse-score-label">{meeting ? 'last meeting rating' : 'no meeting rating yet'}</span><span className="pulse-score-trend">Team rhythm</span></div><div className="pulse-bars"><PulseBar label="Rocks" value={onTrackRocks / Math.max(1, rocks.length) * 100} /><PulseBar label="To-Dos" value={completedTodos / Math.max(1, todos.length) * 100} color="teal" /><PulseBar label="Scorecard" value={(metrics.length - offTrackMetrics) / Math.max(1, metrics.length) * 100} color="lavender" /></div><div className="pulse-footer"><span><span className="pulse-check">✓</span> {readOnly ? 'Company visibility active' : 'Team is preparing'}</span></div></div><SectionHeading kicker="IDS QUEUE" title="Top Issues" action="See all →" onClick={() => onNavigate('issues')} /><div className="issues-preview card-surface">{activeIssues.filter((issue) => issue.horizon === 'short-term').slice(0, 3).map((issue) => <IssuePreview key={issue.id} workspace={workspace} issue={issue} readOnly={readOnly} onClick={() => onStartIssue(issue)} />)}{activeIssues.filter((issue) => issue.horizon === 'short-term').length === 0 && <EmptyState title="No short-term Issues" detail="The weekly IDS queue is clear." />}</div>{headlines[0] && <div className="headline-card"><div className="headline-accent" /><div><span className="section-kicker">LATEST HEADLINE</span><h3>{headlines[0].title}</h3><p>{headlines[0].detail}</p><span className="headline-author"><Avatar user={userFor(workspace, headlines[0].authorId)} size="sm" /> {userFor(workspace, headlines[0].authorId).name}</span></div></div>}</div></section></>;
}

function SectionHeading({ kicker, title, action, onClick }: { kicker: string; title: string; action?: string; onClick?: () => void }) {
  return <div className="section-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>{action && <button className="text-button" onClick={onClick}>{action}</button>}</div>;
}

function TodoRow({ workspace, todo, readOnly = false, onToggle }: { workspace: Workspace; todo: Todo; readOnly?: boolean; onToggle: () => void }) {
  return <div className={`todo-row ${todo.status === 'done' ? 'todo-done' : ''}`}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={onToggle} disabled={readOnly} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><div className="todo-row-copy"><strong>{todo.title}</strong><span>{todo.origin}</span></div><div className="todo-row-meta"><Avatar user={userFor(workspace, todo.ownerId)} size="sm" /><span className={todo.status === 'not-done' ? 'due-overdue' : ''}>{formatDate(todo.dueDate)}</span></div></div>;
}

function RockRow({ workspace, rock, readOnly = false, onUpdate }: { workspace: Workspace; rock: Rock; readOnly?: boolean; onUpdate: () => void }) {
  const milestones = rockMilestoneCounts(rock);
  return <div className="rock-row"><div className="rock-row-main"><div className="rock-title-line"><span className={`priority-marker priority-${rock.priority}`} /><strong>{rock.title}</strong><StatusPill status={rock.status} /></div><div className="rock-row-progress"><ProgressBar value={milestones.total ? milestones.completed / milestones.total * 100 : 0} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{milestones.completed} completed · {milestones.remaining} remaining</span></div></div><div className="rock-row-owner"><Avatar user={userFor(workspace, rock.ownerId)} size="sm" /><span>{userFor(workspace, rock.ownerId).name.split(' ')[0]}</span><button className="row-action" onClick={onUpdate} disabled={readOnly}>{rock.status === 'off-track' ? 'Recover' : 'Update'} →</button></div></div>;
}

function PulseBar({ label, value, color = 'brand' }: { label: string; value: number; color?: 'brand' | 'coral' | 'teal' | 'lavender' }) {
  return <div className="pulse-bar"><div><span>{label}</span><strong>{Math.round(value)}%</strong></div><ProgressBar value={value} tone={color} /></div>;
}

function IssuePreview({ workspace, issue, readOnly = false, onClick }: { workspace: Workspace; issue: Issue; readOnly?: boolean; onClick: () => void }) {
  return <button className="issue-preview-row" onClick={onClick} disabled={readOnly}><span className="issue-number">P{issue.priority}</span><span className="issue-preview-copy"><strong>{issue.title}</strong><span><AgePill issue={issue} /> · {issue.horizon === 'short-term' ? 'Short-term' : 'Long-term'}</span></span><span className="issue-chevron">›</span></button>;
}

function CompanyView({ workspace, overview, onNavigate }: { workspace: Workspace; overview: CompanyOverview | null; onNavigate: (view: ViewId) => void }) {
  const [teamFilter, setTeamFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [meetingFilter, setMeetingFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  if (!overview) return <><PageHeader eyebrow="COMPANY · READ ONLY" title="Loading company overview." description="Preparing the cross-team operating picture." /><div className="loading-card card-surface">Loading the Leadership view…</div></>;
  const filteredIssues = overview.issues.filter((issue) => (teamFilter === 'all' || issue.teamId === teamFilter) && (ownerFilter === 'all' || issue.ownerId === ownerFilter) && (statusFilter === 'all' || issueStatusClass(issue) === statusFilter) && (meetingFilter === 'all' || issue.meetingBand === meetingFilter) && (priorityFilter === 'all' || String(issue.priority) === priorityFilter));
  const selectedTeam = selectedTeamId ? teamFor(workspace, selectedTeamId) : null;
  const selectedItems = selectedTeamId ? { issues: overview.issues.filter((issue) => issue.teamId === selectedTeamId), rocks: overview.rocks.filter((rock) => rock.teamId === selectedTeamId), todos: overview.todos.filter((todo) => todo.teamId === selectedTeamId) } : null;
  return <><PageHeader eyebrow="LEADERSHIP · COMPANY VISIBILITY" title="See the whole operating system." description="Read-only rollups across every operational team, with direct-team and descendant totals kept separate." actions={<Button variant="secondary" onClick={() => onNavigate('issues')}>Open current team Issues →</Button>} /><div className="company-hero card-surface"><div><span className="section-kicker">COMPANY OVERVIEW</span><h2>{overview.issues.filter((issue) => issue.status !== 'solved').length} active Issues across {workspace.teams.length} workspaces.</h2><p>Use meeting health and status to see where a conversation needs to happen before the next L10.</p></div><div className="company-orbit"><strong>{overview.rocks.filter((rock) => rock.status !== 'off-track').length}</strong><span>Rocks on track</span></div></div><div className="company-rollup-grid">{workspace.teams.map((team) => { const rollup = overview.teams.find((item) => item.teamId === team.id); if (!rollup) return null; return <button key={team.id} className={`company-team-card card-surface ${selectedTeamId === team.id ? 'company-team-selected' : ''}`} onClick={() => setSelectedTeamId(team.id)}><div className="company-team-top"><span className="team-mark" style={{ backgroundColor: team.accent }}>{team.initials}</span><span className="node-type">{team.nodeType}</span></div><strong>{team.name}</strong><small>{teamPath(workspace, team.id)}</small><div className="company-team-stats"><span><b>{rollup.direct.issues.total}</b> direct Issues</span><span><b>{rollup.descendants.issues}</b> child Issues</span><span><b>{rollup.direct.rocks.offTrack}</b> off-track Rocks</span></div></button>; })}</div><div className="company-workbench card-surface"><div className="company-filters"><label>Team<select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">All teams</option>{workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Owner<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">All owners</option>{workspace.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="in-ids">In IDS</option><option value="parked">Parked</option><option value="unassigned">Unassigned</option><option value="solved">Solved</option></select></label><label>Meeting health<select value={meetingFilter} onChange={(event) => setMeetingFilter(event.target.value)}><option value="all">Any health</option><option value="neutral">Neutral · 0</option><option value="green">Green · 1</option><option value="yellow">Yellow · 2</option><option value="orange">Orange · 3</option><option value="red">Red · 4+</option></select></label><label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">Any priority</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label></div><div className="company-table-head"><div><span className="section-kicker">ISSUE HEALTH</span><h2>Company Issues</h2></div><span>{filteredIssues.length} visible</span></div><div className="company-table">{filteredIssues.map((issue) => <div className="company-table-row" key={`${issue.teamId}-${issue.id}`}><span className="issue-number">{issue.priority}</span><div><strong>{issue.title}</strong><small>{teamPath(workspace, issue.teamId)} · {issue.horizon === 'short-term' ? 'Short-term' : 'Long-term'} · {ageLabel(issue)} old</small></div><span><Avatar user={userFor(workspace, issue.ownerId)} size="sm" />{userFor(workspace, issue.ownerId).name}</span><AgePill issue={issue} /><StatusPill status={issueStatusClass(issue)} /></div>)}{filteredIssues.length === 0 && <EmptyState title="No Issues match these filters" detail="Try widening the status, owner, or meeting-health selection." />}</div></div>{selectedItems && selectedTeam && <div className="detail-drawer card-surface"><div className="detail-drawer-head"><div><span className="section-kicker">READ-ONLY TEAM DETAIL</span><h2>{selectedTeam.name}</h2><p>{teamPath(workspace, selectedTeam.id)}</p></div><button className="icon-button" onClick={() => setSelectedTeamId(null)} aria-label="Close detail">×</button></div><div className="detail-drawer-grid"><div><strong>{selectedItems.issues.length}</strong><span>Issues</span></div><div><strong>{selectedItems.rocks.length}</strong><span>Rocks</span></div><div><strong>{selectedItems.todos.length}</strong><span>To-Dos</span></div></div><div className="drawer-list">{selectedItems.issues.slice(0, 5).map((issue) => <div key={issue.id}><span>{issue.title}</span><AgePill issue={issue} /></div>)}</div></div>}</>;
}

function MeetingView({ workspace, team, readOnly, agenda, rocks, todos, issues, metrics, scorecardResults, headlines, meeting, section, secondsLeft, running, closed, pendingTransfers, pendingSourceTransfers, onSelectSection, onToggleRunning, onUpdateRock, onUpdateTodo, onOpenIssue, onStartIssue, onSolveIssue, onFlagMetric, onAccept, onReject, onCancel, onClose, onEditSchedule, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; agenda: MeetingSectionConfig[]; rocks: Rock[]; todos: Todo[]; issues: Issue[]; metrics: ScorecardMetric[]; scorecardResults: ScorecardResult[]; headlines: Workspace['headlines']; meeting: Workspace['meetings'][number]; section: MeetingSection; secondsLeft: number; running: boolean; closed: boolean; pendingTransfers: IssueTransfer[]; pendingSourceTransfers: IssueTransfer[]; onSelectSection: (section: MeetingSection) => void; onToggleRunning: () => void; onUpdateRock: (rock: Rock) => void; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onOpenIssue: (issueId: string) => void; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onFlagMetric: (metric: ScorecardMetric, result?: ScorecardResult) => void; onAccept: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void; onClose: (recap: string, rating: number) => void; onEditSchedule: () => void; onNavigate: (view: ViewId) => void }) {
  const [recap, setRecap] = useState(meeting.recap);
  const [rating, setRating] = useState(meeting.lastRating || 8);
  const currentIndex = Math.max(0, agenda.findIndex((item) => item.id === section));
  const shortIssues = issues.filter((issue) => issue.horizon === 'short-term' && issue.status !== 'solved');
  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');
  const next = () => onSelectSection(agenda[Math.min(agenda.length - 1, currentIndex + 1)].id);
  return <><div className="meeting-page-header"><div><span className="eyebrow">{team.name.toUpperCase()} · {workspace.quarter.label}</span><h1>{closed ? 'Meeting complete.' : 'Run the room.'}</h1><p>{closed ? 'The meeting record is saved. The team can now execute the recap.' : 'Keep the reporting crisp. Put the real work where it belongs: IDS.'}</p></div><div className="meeting-header-actions"><div className={`meeting-status ${closed ? 'meeting-status-closed' : ''}`}><span className="meeting-status-dot" />{closed ? 'Closed' : running ? 'In progress' : 'Ready to start'}</div>{!closed && !readOnly && <Button variant="secondary" onClick={onEditSchedule}>Change date & time</Button>}<Button variant="secondary" onClick={() => onNavigate('overview')}>Exit meeting</Button></div></div><TransferNotice workspace={workspace} teamId={team.id} pendingTransfers={pendingTransfers} pendingSourceTransfers={pendingSourceTransfers} editable={!readOnly} onAccept={onAccept} onReject={onReject} onCancel={onCancel} /><div className="meeting-workspace"><aside className="agenda-rail card-surface"><div className="agenda-rail-head"><div><span className="section-kicker">{cadenceLabel(team.meetingCadence).toUpperCase()} RHYTHM</span><h2>{meeting.label}</h2></div><span className="agenda-date">{meeting.dateLabel}<small>{meeting.scheduledTime ? ` · ${meeting.scheduledTime}` : ''}</small></span></div><div className="agenda-list">{agenda.map((item, index) => <button key={item.id} className={`agenda-item ${item.id === section ? 'agenda-item-active' : ''} ${index < currentIndex || closed ? 'agenda-item-done' : ''}`} onClick={() => onSelectSection(item.id)}><span className="agenda-index">{index < currentIndex || closed ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="agenda-item-copy"><strong>{item.label}</strong><small>{item.duration} min</small></span></button>)}</div><div className="agenda-rail-bottom"><span className="section-kicker">ATTENDEES</span><div className="attendee-line"><AvatarStack workspace={workspace} ids={meeting.attendeeIds} /><span>{meeting.attendeeIds.length} people invited</span></div></div></aside><section className="meeting-stage card-surface"><div className="meeting-stage-toolbar"><div className="stage-location"><span className="stage-number">{currentIndex + 1}</span><div><span className="section-kicker">NOW IN</span><strong>{agenda[currentIndex]?.label}</strong></div></div><div className="meeting-timer"><span className="timer-label">TIME BOX</span><strong className={secondsLeft < 60 ? 'timer-warning' : ''}>{minutes}:{seconds}</strong><button className={`timer-toggle ${running ? 'timer-pause' : ''}`} onClick={onToggleRunning} aria-label={running ? 'Pause timer' : 'Start timer'}>{running ? 'Ⅱ' : '▶'}</button></div></div><div className="meeting-stage-body"><MeetingSectionContent section={section} workspace={workspace} team={team} rocks={rocks} todos={todos} issues={shortIssues} metrics={metrics} scorecardResults={scorecardResults} headlines={headlines} meetingWeekStartDate={meeting.weekStartDate ?? weekStartDateFor(new Date())} recap={recap} setRecap={setRecap} rating={rating} setRating={setRating} readOnly={readOnly} onUpdateRock={onUpdateRock} onUpdateTodo={onUpdateTodo} onOpenIssue={onOpenIssue} onStartIssue={onStartIssue} onSolveIssue={onSolveIssue} onFlagMetric={onFlagMetric} onNavigate={onNavigate} /></div><div className="meeting-stage-footer"><button className="footer-nav-button" onClick={() => onSelectSection(agenda[Math.max(0, currentIndex - 1)].id)} disabled={currentIndex === 0}>← Previous</button><div className="footer-progress"><ProgressBar value={(currentIndex + 1) / agenda.length * 100} /><span>{currentIndex + 1} of {agenda.length}</span></div>{section === 'conclude' && !closed ? <Button onClick={() => onClose(recap, rating)} disabled={readOnly}>Close meeting ✓</Button> : <button className="footer-nav-button footer-nav-next" onClick={next} disabled={currentIndex === agenda.length - 1}>Next section →</button>}</div></section></div></>;
}

function MeetingSectionContent({ section, workspace, team, rocks, todos, issues, metrics, scorecardResults, headlines, meetingWeekStartDate, recap, setRecap, rating, setRating, readOnly, onUpdateRock, onUpdateTodo, onOpenIssue, onStartIssue, onSolveIssue, onFlagMetric, onNavigate }: { section: MeetingSection; workspace: Workspace; team: Team; rocks: Rock[]; todos: Todo[]; issues: Issue[]; metrics: ScorecardMetric[]; scorecardResults: ScorecardResult[]; headlines: Workspace['headlines']; meetingWeekStartDate: string; recap: string; setRecap: (value: string) => void; rating: number; setRating: (value: number) => void; readOnly: boolean; onUpdateRock: (rock: Rock) => void; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onOpenIssue: (issueId: string) => void; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onFlagMetric: (metric: ScorecardMetric, result?: ScorecardResult) => void; onNavigate: (view: ViewId) => void }) {
  if (section === 'segue') return <div className="meeting-intro"><span className="intro-orbit">✦</span><span className="section-kicker">SEGUE · 5 MINUTES</span><h2>Leave the noise at the door.</h2><p>Each person shares a personal and professional best from the week. Be present, be brief, and get the room ready to solve.</p><div className="check-in-grid"><div><span>01</span><strong>Personal best</strong><small>What gave you energy?</small></div><div><span>02</span><strong>Professional best</strong><small>What moved the work?</small></div><div><span>03</span><strong>Room check</strong><small>What needs our focus?</small></div></div></div>;
  if (section === 'scorecard') return <div className="meeting-section-content"><SectionIntro kicker={`SCORECARD · WEEK OF ${formatDate(meetingWeekStartDate)}`} title="Report the number, not the story." description="This is the saved result for the meeting’s Monday-start week. Manage values from the Scorecard screen." /><div className="meeting-metric-table">{metrics.map((metric) => { const result = scorecardResults.find((candidate) => candidate.metricId === metric.id && candidate.weekStartDate === meetingWeekStartDate); return <div className="metric-row" key={metric.id}><div className="metric-name"><span className={`metric-status-dot metric-${result?.status ?? 'missing'}`} /><strong>{metric.label}</strong><small><Avatar user={userFor(workspace, metric.ownerId)} size="sm" />{userFor(workspace, metric.ownerId).name}</small></div><div className="metric-values"><span>Target <b>{metric.target}</b> {metric.unit}</span><span>Actual <b>{result?.actual ?? 'Not entered'}</b>{result?.actual ? ` ${metric.unit}` : ''}</span></div><div className="metric-trend"><span className={`trend-arrow trend-${result?.trend ?? 'flat'}`}>{result?.trend === 'up' ? '↗' : result?.trend === 'down' ? '↘' : '→'}</span>{result?.trendLabel ?? 'No comparable prior result'}</div>{result ? <StatusPill status={result.status} /> : <span className="missing-result-pill">Not entered</span>}{result?.status === 'off-track' && !readOnly && <button className="row-action row-action-small" onClick={() => onFlagMetric(metric, result)}>Add to IDS</button>}</div>; })}</div><Button variant="secondary" onClick={() => onNavigate('scorecard')}>Open this week in Scorecard →</Button></div>;
  if (section === 'rock-review') return <div className="meeting-section-content"><SectionIntro kicker="ROCK REVIEW · 5 MINUTES" title="Are we on track?" description="Every Rock gets a clear status. Milestone counts show the work completed and remaining. Off-track Rocks can become Issues." /><div className="meeting-rock-list">{rocks.map((rock) => { const milestones = rockMilestoneCounts(rock); return <div className="meeting-rock-row" key={rock.id}><div className="meeting-rock-info"><strong>{rock.title}</strong><span><Avatar user={userFor(workspace, rock.ownerId)} size="sm" />{userFor(workspace, rock.ownerId).name} · due {formatDate(rock.dueDate)}</span></div><div className="meeting-rock-progress"><ProgressBar value={milestones.total ? milestones.completed / milestones.total * 100 : 0} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{milestones.completed} completed · {milestones.remaining} remaining</span></div><button className={`quick-status-button ${rock.status}`} onClick={() => onUpdateRock(rock)} disabled={readOnly}><span className="status-dot" />{statusLabel(rock.status)}</button></div>; })}</div></div>;
  if (section === 'headlines') return <div className="meeting-section-content"><SectionIntro kicker="CUSTOMER & EMPLOYEE HEADLINES · 5 MINUTES" title="Share what changed." description="Wins, concerns, and context help the team see the whole picture before IDS." /><div className="headline-meeting-grid">{headlines.map((headline) => <article className="headline-meeting-card" key={headline.id}><div className="headline-card-label"><span>{headline.type === 'win' ? '↗' : '!'}</span>{headline.type === 'win' ? 'Win' : 'Concern'}<span className="headline-time">{formatDate(headline.createdAt)}</span></div><h3>{headline.title}</h3><p>{headline.detail}</p><span className="headline-author"><Avatar user={userFor(workspace, headline.authorId)} size="sm" />{userFor(workspace, headline.authorId).name}</span></article>)}</div></div>;
  if (section === 'todo-review') return <div className="meeting-section-content"><SectionIntro kicker="TO-DO REVIEW · 5 MINUTES" title="Did we do what we said?" description="Mark commitments done or not done. To roll a commitment over, edit its due date; the rollover is recorded automatically." /><div className="meeting-todo-table">{todos.map((todo) => <div className="meeting-todo-row" key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdateTodo(todo)} disabled={readOnly}>{todo.status === 'done' ? '✓' : ''}</button><div className="meeting-todo-copy"><strong>{todo.title}</strong><span className="meeting-todo-meta">Due {formatDate(todo.dueDate)} · rolled {todo.carryForwardCount}×</span></div><div className="meeting-todo-owner"><Avatar user={userFor(workspace, todo.ownerId)} size="sm" /><span><small>OWNER</small><strong>{userFor(workspace, todo.ownerId).name}</strong></span></div><StatusPill status={todo.flagged ? 'not-done' : todo.status} label={todo.flagged ? 'Flagged' : undefined} /></div>)}</div></div>;
  if (section === 'ids') return <div className="meeting-section-content"><SectionIntro kicker="IDS · 60 MINUTES" title="Solve the real issue." description={`There are ${issues.length} short-term Issues in this team's queue. Identify, discuss, and solve the highest-value problem.`} /><div className="ids-meeting-list">{issues.map((issue) => <div className="ids-meeting-row" key={issue.id}><span className="issue-number">P{issue.priority}</span><button className="ids-meeting-copy" onClick={() => onOpenIssue(issue.id)}><strong>{issue.title}</strong><small><AgePill issue={issue} /> · {ageLabel(issue)} old</small></button><div className="ids-meeting-actions"><Button variant="quiet" onClick={() => onOpenIssue(issue.id)}>Open issue</Button>{issue.status !== 'in-ids' && <Button variant="secondary" onClick={() => onStartIssue(issue)} disabled={readOnly}>Start IDS</Button>}{issue.status !== 'solved' && <Button onClick={() => onSolveIssue(issue)} disabled={readOnly}>Solve ✓</Button>}</div></div>)}{issues.length === 0 && <EmptyState title="The IDS queue is clear" detail="Capture an Issue from the workspace when the next one appears." />}</div></div>;
  if (section === 'conclude') return <div className="meeting-section-content conclude-content"><span className="conclude-symbol">✓</span><span className="section-kicker">CONCLUDE · 5 MINUTES</span><h2>Leave with clarity.</h2><p>Recap the decisions, confirm every To-Do has an owner and due date, and rate the meeting.</p><label className="recap-field">Final recap<textarea value={recap} onChange={(event) => setRecap(event.target.value)} placeholder="What did the team decide?" rows={4} disabled={readOnly} /></label><div className="rating-field"><span className="section-kicker">MEETING RATING</span><div className="rating-options">{[6, 7, 8, 9, 10].map((value) => <button key={value} className={rating === value ? 'rating-selected' : ''} onClick={() => setRating(value)} disabled={readOnly}>{value}</button>)}</div></div></div>;
  return <div className="meeting-intro"><span className="intro-orbit">✦</span><span className="section-kicker">{team.name.toUpperCase()} L10</span><h2>Start with the room.</h2><p>The weekly rhythm gives the team a shared place to report, solve, and commit.</p></div>;
}

function SectionIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <div className="section-intro-row"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div></div>;
}

type IdsStage = 'select' | 'order' | 'work';

interface MeetingViewV2Props {
  workspace: Workspace;
  team: Team;
  readOnly: boolean;
  agenda: MeetingSectionConfig[];
  rocks: Rock[];
  todos: Todo[];
  issues: Issue[];
  metrics: ScorecardMetric[];
  scorecardResults: ScorecardResult[];
  headlines: Workspace['headlines'];
  meeting: Workspace['meetings'][number];
  occurrences: Workspace['meetings'];
  selectedMeetingId: string;
  pendingMessages: TeamMessage[];
  section: MeetingSection;
  clockNow: number;
  running: boolean;
  closed: boolean;
  pendingTransfers: IssueTransfer[];
  pendingSourceTransfers: IssueTransfer[];
  canManageSchedule: boolean;
  onSelectMeeting: (meetingId: string) => void;
  onStartMeeting: (meeting: Workspace['meetings'][number]) => void;
  onSkipMeeting: (meeting: Workspace['meetings'][number]) => void;
  onRescheduleMeeting: (meeting: Workspace['meetings'][number]) => void;
  onSelectSection: (section: MeetingSection) => void;
  onTransitionSection: (fromSection: MeetingSection, toSection: MeetingSection) => Promise<boolean>;
  onToggleRunning: () => void;
  onUpdateRock: (rock: Rock) => void;
  onUpdateTodo: (todo: Todo, status?: TodoStatus) => void;
  onOpenIssue: (issueId: string, readOnly?: boolean) => void;
  onOpenTodo: (todoId: string, readOnly?: boolean) => void;
  onOpenMessage: (messageId: string) => void;
  onMarkMessageRead: (messageId: string) => void;
  onCreateIssueFromMessage: (messageId: string) => void;
  onStartIssue: (issue: Issue) => void;
  onParkIssue: (issue: Issue) => void;
  onSolveIssue: (issue: Issue) => void;
  onCreateIssueFromScorecard: (metric: ScorecardMetric, result: ScorecardResult) => void;
  onCreateIssueFromRock: (rock: Rock) => void;
  onSaveSectionNote: (section: MeetingSection, note: string) => Promise<boolean>;
  onSelectMeetingIssues: (issueIds: string[]) => Promise<boolean>;
  onSaveIssueNote: (issueId: string, note: string) => Promise<boolean>;
  onReorderIssues: (issueIds: string[]) => Promise<boolean>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  onClose: (recap: string, rating: number, attendeeRatings: MeetingAttendeeRating[]) => void;
  onEditSchedule: () => void;
  onNavigate: (view: ViewId) => void;
}

function MeetingViewV2({ workspace, team, readOnly, agenda, rocks, todos, issues, metrics, scorecardResults, headlines, meeting, occurrences, selectedMeetingId, section, clockNow, running, closed, pendingTransfers, pendingSourceTransfers, pendingMessages, canManageSchedule, onSelectMeeting, onStartMeeting, onSkipMeeting, onRescheduleMeeting, onSelectSection, onTransitionSection, onToggleRunning, onUpdateRock, onUpdateTodo, onOpenIssue, onOpenTodo, onOpenMessage, onMarkMessageRead, onCreateIssueFromMessage, onStartIssue, onParkIssue, onSolveIssue, onCreateIssueFromScorecard, onCreateIssueFromRock, onSaveSectionNote, onSelectMeetingIssues, onSaveIssueNote, onReorderIssues, onAccept, onReject, onCancel, onClose, onEditSchedule, onNavigate }: MeetingViewV2Props) {
  const [recap, setRecap] = useState(meeting.recap);
  const [rating, setRating] = useState(meeting.lastRating || 8);
  const [attendeeRatings, setAttendeeRatings] = useState<Record<string, number>>(() => Object.fromEntries((meeting.attendeeRatings ?? []).map((entry) => [entry.attendeeId, entry.rating])));
  const [idsStage, setIdsStage] = useState<IdsStage>('select');
  const [idsCursor, setIdsCursor] = useState(0);
  const currentIndex = Math.max(0, agenda.findIndex((item) => item.id === section));
  const skipped = meeting.status === 'skipped';
  const recordClosed = closed || meeting.status === 'closed' || skipped;
  const meetingReadOnly = readOnly || recordClosed;
  const shortIssues = issues.filter((issue) => issue.horizon === 'short-term');
  const meetingElapsed = elapsedSecondsSince(meeting.startedAt, meeting.status === 'closed' ? meeting.closedAt ?? clockNow : clockNow);
  const activeSection = meeting.activeSection ?? section;
  const storedSectionElapsed = meeting.sectionDurations?.[section] ?? 0;
  const liveSectionElapsed = !recordClosed && meeting.status === 'in-progress' && activeSection === section
    ? elapsedSecondsSince(meeting.activeSectionStartedAt ?? meeting.startedAt, clockNow)
    : 0;
  const sectionElapsed = storedSectionElapsed + liveSectionElapsed;
  const sectionLimit = (agenda[currentIndex]?.duration ?? 0) * 60;
  const sectionRemaining = Math.max(0, sectionLimit - sectionElapsed);
  const canRateAttendees = !meetingReadOnly && meeting.facilitatorId === workspace.currentUser.id;
  const completeAttendeeRatings: MeetingAttendeeRating[] = meeting.attendeeIds
    .map((attendeeId) => ({ attendeeId, rating: attendeeRatings[attendeeId] }))
    .filter((entry): entry is MeetingAttendeeRating => Number.isInteger(entry.rating) && entry.rating >= 1 && entry.rating <= 10);
  const hasAllAttendeeRatings = meeting.attendeeIds.every((attendeeId) => Number.isInteger(attendeeRatings[attendeeId]) && attendeeRatings[attendeeId] >= 1 && attendeeRatings[attendeeId] <= 10);
  useEffect(() => {
    setRecap(meeting.recap);
    setRating(meeting.lastRating || 8);
    setAttendeeRatings(Object.fromEntries((meeting.attendeeRatings ?? []).map((entry) => [entry.attendeeId, entry.rating])));
    setIdsStage('select');
    setIdsCursor(0);
  }, [meeting.id]);
  const changeSection = async (nextSection: MeetingSection) => {
    if (nextSection === section) return;
    if (!meetingReadOnly && meeting.status === 'in-progress') {
      const saved = await onTransitionSection(section, nextSection);
      if (!saved) return;
    }
    onSelectSection(nextSection);
  };
  const next = () => {
    const nextSection = agenda[Math.min(agenda.length - 1, currentIndex + 1)];
    if (nextSection) void changeSection(nextSection.id);
  };
  return <>
    <div className="meeting-page-header">
      <div><span className="eyebrow">{team.name.toUpperCase()} · {workspace.quarter.label}</span><h1>{skipped ? 'Meeting skipped.' : recordClosed ? 'Meeting complete.' : 'Run the room.'}</h1><p>{skipped ? 'This occurrence is preserved in history and the team cadence continues.' : recordClosed ? 'The meeting record is saved. The team can now execute the recap.' : 'Keep the reporting crisp. Put the real work where it belongs: IDS.'}</p><span className="meeting-facilitator">Facilitator · {meeting.facilitatorId ? userFor(workspace, meeting.facilitatorId).name : 'Not selected'}</span></div>
      <div className="meeting-header-actions"><div className={`meeting-status ${recordClosed ? 'meeting-status-closed' : ''}`}><span className="meeting-status-dot" />{skipped ? 'Skipped' : recordClosed ? 'Closed' : running ? 'In progress' : 'Ready to start'}</div>{!meetingReadOnly && <Button variant="secondary" onClick={onEditSchedule}>Change date & time</Button>}<Button variant="secondary" onClick={() => onNavigate('overview')}>Exit meeting</Button></div>
    </div>
    <TransferNotice workspace={workspace} teamId={team.id} pendingTransfers={pendingTransfers} pendingSourceTransfers={pendingSourceTransfers} editable={!meetingReadOnly} onAccept={onAccept} onReject={onReject} onCancel={onCancel} />
    <MeetingOccurrencePanel team={team} occurrences={occurrences} selectedMeetingId={selectedMeetingId} canManageSchedule={canManageSchedule && !recordClosed} onSelect={onSelectMeeting} onStart={onStartMeeting} onSkip={onSkipMeeting} onReschedule={onRescheduleMeeting} />
    <div className="meeting-workspace">
      <aside className="agenda-rail card-surface"><div className="agenda-rail-head"><div><span className="section-kicker">{cadenceLabel(team.meetingCadence).toUpperCase()} RHYTHM</span><h2>{meeting.label}</h2></div><span className="agenda-date">{meeting.dateLabel}<small>{meeting.scheduledTime ? ` · ${meeting.scheduledTime}` : ''}</small></span></div><div className="agenda-list">{agenda.map((item, index) => <button key={item.id} className={`agenda-item ${item.id === section ? 'agenda-item-active' : ''} ${index < currentIndex || recordClosed ? 'agenda-item-done' : ''}`} onClick={() => void changeSection(item.id)}><span className="agenda-index">{index < currentIndex || recordClosed ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="agenda-item-copy"><strong>{item.label}</strong><small>{item.duration} min</small></span></button>)}</div><div className="agenda-rail-bottom"><span className="section-kicker">FACILITATOR</span><div className="facilitator-line"><Avatar user={userFor(workspace, meeting.facilitatorId)} size="sm" /><span>{meeting.facilitatorId ? userFor(workspace, meeting.facilitatorId).name : 'Not selected'}</span></div><span className="section-kicker attendee-kicker">ATTENDEES</span><div className="attendee-line"><AvatarStack workspace={workspace} ids={meeting.attendeeIds} /><span>{meeting.attendeeIds.length} people invited</span></div></div></aside>
      <section className="meeting-stage card-surface">
        <div className="meeting-stage-toolbar"><div className="stage-location"><span className="stage-number">{currentIndex + 1}</span><div><span className="section-kicker">NOW IN</span><strong>{agenda[currentIndex]?.label}</strong></div></div><div className="meeting-timer-group"><div className="meeting-timer meeting-timer-overall"><span className="timer-label">MEETING</span><strong>{formatDuration(meetingElapsed)}</strong><small>overall</small></div><div className="meeting-timer meeting-timer-section"><span className="timer-label">SECTION</span><strong className={sectionRemaining <= 60 && !recordClosed ? 'timer-warning' : ''}>{formatDuration(sectionElapsed)}</strong><small>{sectionRemaining > 0 ? `${formatDuration(sectionRemaining)} left` : 'time box reached'}</small></div>{meeting.status === 'in-progress' ? <span className="timer-live-indicator">● LIVE</span> : <button className="timer-toggle" onClick={onToggleRunning} disabled={meetingReadOnly} aria-label="Start meeting timer">▶</button>}</div></div>
        <div className="meeting-stage-body"><MeetingSectionContentV2 section={section} workspace={workspace} team={team} rocks={rocks} todos={todos} issues={shortIssues} metrics={metrics} scorecardResults={scorecardResults} headlines={headlines} meeting={meeting} pendingMessages={pendingMessages} recap={recap} setRecap={setRecap} rating={rating} setRating={setRating} attendeeRatings={attendeeRatings} setAttendeeRating={(attendeeId, value) => setAttendeeRatings((current) => ({ ...current, [attendeeId]: value }))} canRateAttendees={canRateAttendees} hasAllAttendeeRatings={hasAllAttendeeRatings} idsStage={idsStage} idsCursor={idsCursor} setIdsStage={setIdsStage} setIdsCursor={setIdsCursor} readOnly={meetingReadOnly} onUpdateRock={onUpdateRock} onUpdateTodo={onUpdateTodo} onOpenIssue={onOpenIssue} onOpenTodo={onOpenTodo} onOpenMessage={onOpenMessage} onMarkMessageRead={onMarkMessageRead} onCreateIssueFromMessage={onCreateIssueFromMessage} onStartIssue={onStartIssue} onParkIssue={onParkIssue} onSolveIssue={onSolveIssue} onCreateIssueFromScorecard={onCreateIssueFromScorecard} onCreateIssueFromRock={onCreateIssueFromRock} onSaveSectionNote={onSaveSectionNote} onSelectMeetingIssues={onSelectMeetingIssues} onSaveIssueNote={onSaveIssueNote} onReorderIssues={onReorderIssues} onNavigate={onNavigate} /></div>
        <div className="meeting-stage-footer"><button className="footer-nav-button" onClick={() => { const previous = agenda[Math.max(0, currentIndex - 1)]; if (previous) void changeSection(previous.id); }} disabled={currentIndex === 0}>← Previous</button><div className="footer-progress"><ProgressBar value={(currentIndex + 1) / Math.max(1, agenda.length) * 100} /><span>{currentIndex + 1} of {agenda.length}</span></div>{section === 'conclude' && !recordClosed ? <Button onClick={() => onClose(recap, rating, completeAttendeeRatings)} disabled={meetingReadOnly || !hasAllAttendeeRatings}>Close meeting ✓</Button> : <button className="footer-nav-button footer-nav-next" onClick={next} disabled={currentIndex === agenda.length - 1}>Next section →</button>}</div>
      </section>
    </div>
  </>;
}

function MeetingNotesField({ meeting, section, title, readOnly, onSave }: { meeting: Workspace['meetings'][number]; section: MeetingSection; title: string; readOnly: boolean; onSave: (section: MeetingSection, note: string) => Promise<boolean> }) {
  const persistedNote = meeting.sectionNotes[section] ?? '';
  const [note, setNote] = useState(persistedNote);
  const [savedNote, setSavedNote] = useState(persistedNote);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setNote(persistedNote);
    setSavedNote(persistedNote);
  }, [meeting.id, meeting.version, persistedNote, section]);
  const save = async () => {
    setSaving(true);
    if (await onSave(section, note)) setSavedNote(note.trim());
    setSaving(false);
  };
  const dirty = note.trim() !== savedNote;
  return <div className="meeting-notes-panel"><div className="meeting-notes-heading"><div><span className="section-kicker">MEETING NOTES</span><strong>{title}</strong></div><span className={dirty ? 'meeting-notes-status meeting-notes-unsaved' : 'meeting-notes-status'}>{dirty ? 'Unsaved changes' : 'Saved to this meeting'}</span></div><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder={`Capture the ${title.toLowerCase()} the facilitator wants to keep.`} disabled={readOnly} /><div className="meeting-notes-actions"><small>Notes are included in the meeting recap and history.</small><Button variant="secondary" onClick={save} disabled={readOnly || saving || !dirty}>{saving ? 'Saving…' : 'Save notes'}</Button></div></div>;
}

interface MeetingSectionContentV2Props {
  section: MeetingSection;
  workspace: Workspace;
  team: Team;
  rocks: Rock[];
  todos: Todo[];
  issues: Issue[];
  metrics: ScorecardMetric[];
  scorecardResults: ScorecardResult[];
  headlines: Workspace['headlines'];
  meeting: Workspace['meetings'][number];
  pendingMessages: TeamMessage[];
  recap: string;
  setRecap: (value: string) => void;
  rating: number;
  setRating: (value: number) => void;
  attendeeRatings: Record<string, number>;
  setAttendeeRating: (attendeeId: string, rating: number) => void;
  canRateAttendees: boolean;
  hasAllAttendeeRatings: boolean;
  idsStage: IdsStage;
  idsCursor: number;
  setIdsStage: (stage: IdsStage) => void;
  setIdsCursor: (cursor: number) => void;
  readOnly: boolean;
  onUpdateRock: (rock: Rock) => void;
  onUpdateTodo: (todo: Todo, status?: TodoStatus) => void;
  onOpenIssue: (issueId: string, readOnly?: boolean) => void;
  onOpenTodo: (todoId: string, readOnly?: boolean) => void;
  onOpenMessage: (messageId: string) => void;
  onMarkMessageRead: (messageId: string) => void;
  onCreateIssueFromMessage: (messageId: string) => void;
  onStartIssue: (issue: Issue) => void;
  onParkIssue: (issue: Issue) => void;
  onSolveIssue: (issue: Issue) => void;
  onCreateIssueFromScorecard: (metric: ScorecardMetric, result: ScorecardResult) => void;
  onCreateIssueFromRock: (rock: Rock) => void;
  onSaveSectionNote: (section: MeetingSection, note: string) => Promise<boolean>;
  onSelectMeetingIssues: (issueIds: string[]) => Promise<boolean>;
  onSaveIssueNote: (issueId: string, note: string) => Promise<boolean>;
  onReorderIssues: (issueIds: string[]) => Promise<boolean>;
  onNavigate: (view: ViewId) => void;
}

function MeetingSectionContentV2({ section, workspace, team, rocks, todos, issues, metrics, scorecardResults, headlines, meeting, pendingMessages, recap, setRecap, rating, setRating, attendeeRatings, setAttendeeRating, canRateAttendees, hasAllAttendeeRatings, idsStage, idsCursor, setIdsStage, setIdsCursor, readOnly, onUpdateRock, onUpdateTodo, onOpenIssue, onOpenTodo, onOpenMessage, onMarkMessageRead, onCreateIssueFromMessage, onStartIssue, onParkIssue, onSolveIssue, onCreateIssueFromScorecard, onCreateIssueFromRock, onSaveSectionNote, onSelectMeetingIssues, onSaveIssueNote, onReorderIssues, onNavigate }: MeetingSectionContentV2Props) {
  const [draggedIssueId, setDraggedIssueId] = useState<string | null>(null);
  const [dragOverIssueId, setDragOverIssueId] = useState<string | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>(meeting.idsIssueIds);
  const [idsNote, setIdsNote] = useState('');
  const [savedIdsNote, setSavedIdsNote] = useState('');
  const meetingIssueIds = meeting.idsIssueIds.filter((issueId) => issues.some((issue) => issue.id === issueId));
  const orderedIssues = meetingIssueIds.map((issueId) => issues.find((issue) => issue.id === issueId)).filter((issue): issue is Issue => Boolean(issue));
  const selectableIssues = issues.filter((issue) => issue.status !== 'solved' && issue.assignmentState !== 'redirected');
  const selectedActiveIssueIds = selectedIssueIds.filter((issueId) => selectableIssues.some((issue) => issue.id === issueId));
  const currentIdsIssue = orderedIssues[Math.min(idsCursor, Math.max(0, orderedIssues.length - 1))];
  const currentIssueNote = currentIdsIssue ? [...meeting.idsNotes].reverse().find((note) => note.issueId === currentIdsIssue.id)?.note ?? '' : '';
  useEffect(() => {
    setSelectedIssueIds(meeting.idsIssueIds);
  }, [meeting.id, meeting.version]);
  useEffect(() => {
    setIdsNote(currentIssueNote);
    setSavedIdsNote(currentIssueNote);
  }, [meeting.id, meeting.version, currentIdsIssue?.id, currentIssueNote]);
  const moveIssue = (issueId: string, direction: -1 | 1) => {
    const next = [...meetingIssueIds];
    const index = next.indexOf(issueId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length || readOnly) return;
    [next[index], next[target]] = [next[target], next[index]];
    void onReorderIssues(next);
  };
  const dropIssue = (targetId: string) => {
    if (!draggedIssueId || draggedIssueId === targetId || readOnly) return;
    const next = [...meetingIssueIds];
    const from = next.indexOf(draggedIssueId);
    const target = next.indexOf(targetId);
    if (from < 0 || target < 0) return;
    next.splice(from, 1);
    next.splice(target, 0, draggedIssueId);
    void onReorderIssues(next);
    setDraggedIssueId(null);
    setDragOverIssueId(null);
  };
  const continueToOrder = async () => {
    if (readOnly) return;
    const nextSelection = selectedActiveIssueIds;
    if (await onSelectMeetingIssues(nextSelection)) setIdsStage('order');
  };
  if (section === 'segue') return <div className="meeting-intro segue-intro"><span className="intro-orbit">✦</span><span className="section-kicker">SEGUE · 5 MINUTES</span><h2>Leave the noise at the door.</h2><p>Each person shares a personal and professional best from the week. Be present, be brief, and get the room ready to solve.</p><div className="check-in-grid"><article><span className="check-in-number">01</span><div><strong>Personal best</strong><small>What gave you energy?</small></div></article><article><span className="check-in-number">02</span><div><strong>Professional best</strong><small>What moved the work?</small></div></article><article><span className="check-in-number">03</span><div><strong>Room check</strong><small>What needs our focus?</small></div></article></div><PendingMessagesPanel workspace={workspace} messages={pendingMessages} readOnly={readOnly} onOpen={onOpenMessage} onMarkRead={onMarkMessageRead} onCreateIssue={onCreateIssueFromMessage} /></div>;
  if (section === 'scorecard') return <div className="meeting-section-content"><SectionIntro kicker={`SCORECARD · WEEK OF ${formatDate(meeting.weekStartDate ?? weekStartDateFor(new Date()))}`} title="Report the number, not the story." description="This is the saved result for the meeting’s Monday-start week. Manage values from the Scorecard screen." /><div className="meeting-metric-table">{metrics.map((metric) => { const result = scorecardResults.find((candidate) => candidate.metricId === metric.id && candidate.weekStartDate === (meeting.weekStartDate ?? weekStartDateFor(new Date()))); const existingIssue = result && workspace.issues.find((issue) => issue.linkedScorecardMetricId === metric.id && issue.linkedScorecardWeekStartDate === result.weekStartDate && issue.assignmentState !== 'redirected'); return <div className="metric-row" key={metric.id}><div className="metric-name"><span className={`metric-status-dot metric-${result?.status ?? 'missing'}`} /><strong>{metric.label}</strong><small><Avatar user={userFor(workspace, metric.ownerId)} size="sm" />{userFor(workspace, metric.ownerId).name}</small></div><div className="metric-values"><span>Target <b>{metric.target}</b> {metric.unit}</span><span>Actual <b>{result?.actual ?? 'Not entered'}</b>{result?.actual ? ` ${metric.unit}` : ''}</span></div><div className="metric-trend"><span className={`trend-arrow trend-${result?.trend ?? 'flat'}`}>{result?.trend === 'up' ? '↗' : result?.trend === 'down' ? '↘' : '→'}</span>{result?.trendLabel ?? 'No comparable prior result'}</div>{result ? <StatusPill status={result.status} /> : <span className="missing-result-pill">Not entered</span>}{result?.status === 'off-track' && !readOnly && <Button variant="secondary" className="row-action-button" onClick={() => onCreateIssueFromScorecard(metric, result)} disabled={Boolean(existingIssue)}>{existingIssue ? 'Issue created' : 'Create Issue'}</Button>}</div>; })}</div><MeetingNotesField meeting={meeting} section="scorecard" title="Scorecard notes" readOnly={readOnly} onSave={onSaveSectionNote} /><Button variant="secondary" onClick={() => onNavigate('scorecard')}>Open this week in Scorecard →</Button></div>;
  if (section === 'rock-review') return <div className="meeting-section-content"><SectionIntro kicker="ROCK REVIEW · 5 MINUTES" title="Are we on track?" description="Every Rock gets a clear status. Milestone counts show the work completed and remaining. Off-track Rocks can become Issues." /><div className="meeting-rock-list">{rocks.map((rock) => { const milestones = rockMilestoneCounts(rock); const existingIssue = workspace.issues.find((issue) => issue.linkedRockId === rock.id && issue.assignmentState !== 'redirected'); return <div className="meeting-rock-row" key={rock.id}><div className="meeting-rock-info"><strong>{rock.title}</strong><span><Avatar user={userFor(workspace, rock.ownerId)} size="sm" />{userFor(workspace, rock.ownerId).name} · due {formatDate(rock.dueDate)}</span></div><div className="meeting-rock-progress"><ProgressBar value={milestones.total ? milestones.completed / milestones.total * 100 : 0} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{milestones.completed} completed · {milestones.remaining} remaining</span></div><button className={`quick-status-button ${rock.status}`} onClick={() => onUpdateRock(rock)} disabled={readOnly}><span className="status-dot" />{statusLabel(rock.status)}</button>{rock.status === 'off-track' && <Button variant="secondary" className="rock-issue-button" onClick={() => onCreateIssueFromRock(rock)} disabled={readOnly || Boolean(existingIssue)}>{existingIssue ? 'Issue created' : 'Create Issue'}</Button>}</div>; })}</div></div>;
  if (section === 'headlines') return <div className="meeting-section-content"><SectionIntro kicker="CUSTOMER & EMPLOYEE HEADLINES · 5 MINUTES" title="Share what changed." description="Wins, concerns, and context help the team see the whole picture before IDS." /><div className="headline-meeting-grid">{headlines.map((headline) => <article className="headline-meeting-card" key={headline.id}><div className="headline-card-label"><span>{headline.type === 'win' ? '↗' : '!'}</span>{headline.type === 'win' ? 'Win' : 'Concern'}<span className="headline-time">{formatDate(headline.createdAt)}</span></div><h3>{headline.title}</h3><p>{headline.detail}</p><span className="headline-author"><Avatar user={userFor(workspace, headline.authorId)} size="sm" />{userFor(workspace, headline.authorId).name}</span></article>)}</div><MeetingNotesField meeting={meeting} section="headlines" title="Customer & Employee headline notes" readOnly={readOnly} onSave={onSaveSectionNote} /></div>;
  if (section === 'todo-review') return <div className="meeting-section-content"><SectionIntro kicker="TO-DO REVIEW · 5 MINUTES" title="Did we do what we said?" description="Mark commitments done or not done. Open a To-Do to review its context or update its notes." /><div className="meeting-todo-table">{todos.map((todo) => <div className="meeting-todo-row" key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdateTodo(todo)} disabled={readOnly} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><button type="button" className={`meeting-todo-open ${todo.status === 'done' ? 'todo-done' : ''}`} onClick={() => onOpenTodo(todo.id, readOnly)}><strong>{todo.title}</strong><span className="meeting-todo-meta">Due {formatDate(todo.dueDate)} · rolled {todo.carryForwardCount}×</span></button><div className="meeting-todo-owner"><Avatar user={userFor(workspace, todo.ownerId)} size="sm" /><span><small>OWNER</small><strong>{userFor(workspace, todo.ownerId).name}</strong></span></div><StatusPill status={todo.flagged ? 'not-done' : todo.status} label={todo.flagged ? 'Flagged' : undefined} /></div>)}</div></div>;
  if (section === 'ids') {
    if (idsStage === 'select') return <div className="meeting-section-content"><SectionIntro kicker="IDS · STEP 1 OF 3" title="Choose the Issues for IDS." description={`Select up to 5 of the ${selectableIssues.length} active short-term Issues. The facilitator can keep the list focused before the team starts solving.`} /><div className="ids-stage-toolbar"><strong>{selectedActiveIssueIds.length} / 5 selected</strong><span>Only selected Issues move into the meeting’s IDS order.</span></div><div className="ids-selection-list">{selectableIssues.map((issue) => { const selected = selectedIssueIds.includes(issue.id); const disabled = readOnly || (!selected && selectedActiveIssueIds.length >= 5); return <label className={`ids-selection-row ${selected ? 'ids-selection-row-selected' : ''}`} key={issue.id}><input type="checkbox" checked={selected} onChange={() => setSelectedIssueIds((current) => selected ? current.filter((id) => id !== issue.id) : current.length < 5 ? [...current, issue.id] : current)} disabled={disabled} /><span className="issue-number">P{issue.priority}</span><span className="ids-selection-copy"><strong>{issue.title}</strong><small><AgePill issue={issue} /> · {ageLabel(issue)} old · {statusLabel(issue.status)}</small></span><button type="button" className="row-action" onClick={(event) => { event.preventDefault(); onOpenIssue(issue.id, readOnly); }}>Open</button></label>; })}{selectableIssues.length === 0 && <EmptyState title="The active IDS queue is clear" detail="Capture a short-term Issue before selecting it for this meeting." />}</div><div className="ids-stage-actions"><Button variant="secondary" onClick={() => void continueToOrder()} disabled={readOnly}>Continue to order →</Button></div></div>;
    if (idsStage === 'order') return <div className="meeting-section-content"><SectionIntro kicker="IDS · STEP 2 OF 3" title="Set the solving order." description="Order the selected Issues from highest-value conversation to lowest. Priority stays independent from this meeting order." /><div className="ids-meeting-list">{orderedIssues.map((issue) => { const reorderIndex = meetingIssueIds.indexOf(issue.id); const reorderable = !readOnly; return <div className={`ids-meeting-row ${dragOverIssueId === issue.id ? 'ids-meeting-row-drag-over' : ''}`} key={issue.id} draggable={reorderable} onDragStart={() => reorderable && setDraggedIssueId(issue.id)} onDragOver={(event) => { if (reorderable && draggedIssueId && draggedIssueId !== issue.id) { event.preventDefault(); setDragOverIssueId(issue.id); } }} onDrop={(event) => { event.preventDefault(); dropIssue(issue.id); }} onDragEnd={() => { setDraggedIssueId(null); setDragOverIssueId(null); }}><span className="issue-priority">{reorderIndex + 1}</span><span className="ids-drag-handle" aria-hidden="true">⋮⋮</span><button className="ids-meeting-copy" onClick={() => onOpenIssue(issue.id, readOnly)}><strong>{issue.title}</strong><small><AgePill issue={issue} /> · {statusLabel(issue.status)}</small></button><div className="ids-order-controls"><button type="button" className="ids-order-button" onClick={() => moveIssue(issue.id, -1)} disabled={readOnly || reorderIndex === 0} aria-label={`Move ${issue.title} up`}>↑</button><button type="button" className="ids-order-button" onClick={() => moveIssue(issue.id, 1)} disabled={readOnly || reorderIndex === meetingIssueIds.length - 1} aria-label={`Move ${issue.title} down`}>↓</button></div></div>})}{orderedIssues.length === 0 && <EmptyState title="No Issues selected" detail="Go back to selection and choose up to five Issues." />}</div><div className="ids-stage-actions"><Button variant="quiet" onClick={() => setIdsStage('select')}>← Back to selection</Button><Button variant="secondary" onClick={() => { setIdsCursor(0); setIdsStage('work'); }} disabled={readOnly || orderedIssues.length === 0}>Begin IDS →</Button></div></div>;
    if (!currentIdsIssue) return <div className="meeting-section-content"><SectionIntro kicker="IDS · STEP 3 OF 3" title="No Issues are ready to work." description="Return to selection to choose the Issues the room should solve." /><div className="ids-stage-actions"><Button variant="secondary" onClick={() => setIdsStage('select')}>Back to selection</Button></div></div>;
    const currentIssueIndex = Math.min(idsCursor, orderedIssues.length - 1);
    const saveIssueNote = async () => {
      if (readOnly || !idsNote.trim() || idsNote.trim() === savedIdsNote) return;
      if (await onSaveIssueNote(currentIdsIssue.id, idsNote.trim())) setSavedIdsNote(idsNote.trim());
    };
    return <div className="meeting-section-content"><SectionIntro kicker={`IDS · STEP 3 OF 3 · ISSUE ${currentIssueIndex + 1} OF ${orderedIssues.length}`} title={currentIdsIssue.title} description="Identify, discuss, and solve this Issue. Add the room’s thinking below before moving to the next selected Issue." /><div className="ids-work-card"><div className="ids-work-card-head"><div><span className="issue-number">P{currentIdsIssue.priority}</span><StatusPill status={currentIdsIssue.status} /></div><Button variant="quiet" onClick={() => onOpenIssue(currentIdsIssue.id, readOnly)}>Open full Issue</Button></div><p className="ids-work-detail">{currentIdsIssue.detail || 'No additional Issue context has been recorded.'}</p><div className="issue-detail-meta"><span><Avatar user={userFor(workspace, currentIdsIssue.ownerId ?? currentIdsIssue.raisedById)} size="sm" /> {userFor(workspace, currentIdsIssue.ownerId ?? currentIdsIssue.raisedById).name}</span><span>{ageLabel(currentIdsIssue)} old · {currentIdsIssue.meetingsPassed} meetings passed</span></div><div className="meeting-notes-panel ids-notes-panel"><div className="meeting-notes-heading"><div><span className="section-kicker">IDS NOTES</span><strong>Identify · Discuss · Solve</strong></div><span className={idsNote.trim() !== savedIdsNote ? 'meeting-notes-status meeting-notes-unsaved' : 'meeting-notes-status'}>{idsNote.trim() !== savedIdsNote ? 'Unsaved changes' : 'Saved to this meeting'}</span></div><textarea value={idsNote} onChange={(event) => setIdsNote(event.target.value)} rows={8} placeholder="Capture what the team identified, discussed, decided, or needs to remember." disabled={readOnly} /><div className="meeting-notes-actions"><small>Each save is appended to this Issue’s history and the meeting recap.</small><Button variant="secondary" onClick={() => void saveIssueNote()} disabled={readOnly || !idsNote.trim() || idsNote.trim() === savedIdsNote}>Save IDS notes</Button></div></div><div className="ids-work-actions">{currentIdsIssue.status !== 'solved' && <><Button onClick={() => onSolveIssue(currentIdsIssue)} disabled={readOnly}>Solve Issue ✓</Button><Button variant="secondary" onClick={() => onParkIssue(currentIdsIssue)} disabled={readOnly}>Park for next meeting</Button></>}{currentIdsIssue.status === 'solved' && <span className="solved-banner"><span>✓</span><strong>Issue solved</strong></span>}</div></div><div className="ids-stage-actions"><Button variant="quiet" onClick={() => setIdsStage('order')}>← Back to order</Button><div><Button variant="secondary" onClick={() => setIdsCursor(Math.max(0, currentIssueIndex - 1))} disabled={currentIssueIndex === 0}>Previous Issue</Button><Button onClick={() => setIdsCursor(Math.min(orderedIssues.length - 1, currentIssueIndex + 1))} disabled={currentIssueIndex === orderedIssues.length - 1}>Next Issue →</Button></div></div></div>;
  }
  if (section === 'conclude') { const actionSummary = meeting.actionSummary ?? { todosCreated: meeting.createdTodoIds.length, issuesReviewedInIds: meeting.idsIssueIds.length, issuesAddedToIds: meeting.idsAddedIssueIds.length, issuesSolved: meeting.idsIssueIds.filter((issueId) => workspace.issues.find((issue) => issue.id === issueId)?.status === 'solved').length }; return <div className="meeting-section-content conclude-content"><span className="conclude-symbol">✓</span><span className="section-kicker">CONCLUDE · 5 MINUTES</span><h2>Leave with clarity.</h2><p>Recap the decisions, confirm every To-Do has an owner and due date, and rate the meeting.</p><div className="meeting-action-summary"><div><strong>{actionSummary.todosCreated}</strong><span>To-Dos created</span></div><div><strong>{actionSummary.issuesReviewedInIds}</strong><span>Issues reviewed in IDS</span></div><div><strong>{actionSummary.issuesAddedToIds}</strong><span>Issues added to IDS</span></div><div><strong>{actionSummary.issuesSolved}</strong><span>Issues solved</span></div></div><label className="recap-field">Final recap<textarea value={recap} onChange={(event) => setRecap(event.target.value)} placeholder="What did the team decide?" rows={4} disabled={readOnly} /></label><div className="rating-field"><span className="section-kicker">OVERALL MEETING RATING</span><div className="rating-options">{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => <button type="button" key={value} className={rating === value ? 'rating-selected' : ''} onClick={() => setRating(value)} disabled={readOnly}>{value}</button>)}</div></div><div className="attendee-rating-field"><div className="attendee-rating-heading"><div><span className="section-kicker">INDIVIDUAL RATINGS</span><strong>How did each person experience the meeting?</strong></div><span>{canRateAttendees ? 'Facilitator entry' : 'Facilitator only'}</span></div><div className="attendee-rating-list">{meeting.attendeeIds.map((attendeeId) => { const attendee = userFor(workspace, attendeeId); return <label className="attendee-rating-row" key={attendeeId}><span><Avatar user={attendee} size="sm" /><strong>{attendee.name}</strong></span><select value={attendeeRatings[attendeeId] ?? ''} onChange={(event) => setAttendeeRating(attendeeId, Number(event.target.value))} disabled={!canRateAttendees}><option value="">Rate</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => <option value={value} key={value}>{value} / 10</option>)}</select></label>; })}{meeting.attendeeIds.length === 0 && <p className="record-empty">No attendees were recorded for this meeting.</p>}</div>{!hasAllAttendeeRatings && !readOnly && <small className="form-help">The facilitator must rate every recorded attendee before closing the meeting.</small>}</div></div>; }
  return <div className="meeting-intro"><span className="intro-orbit">✦</span><span className="section-kicker">{team.name.toUpperCase()} L10</span><h2>Start with the room.</h2><p>The weekly rhythm gives the team a shared place to report, solve, and commit.</p></div>;
}

function RocksView({ workspace, team, readOnly, rocks, onUpdateRock, onEditRock, onAdd, onAddTask, onOpenTask, onConvertTask, onUpdateTask, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; rocks: Rock[]; onUpdateRock: (rock: Rock) => void; onEditRock: (rockId: string) => void; onAdd: () => void; onAddTask: (rockId: string) => void; onOpenTask: (taskId: string) => void; onConvertTask: (taskId: string) => void; onUpdateTask: (taskId: string, input: Partial<Pick<RockTask, 'status'>>, expectedVersion?: number) => void; onNavigate: (view: ViewId) => void }) {
  const milestoneTotals = rocks.reduce((totals, rock) => {
    const milestones = rockMilestoneCounts(rock);
    return { total: totals.total + milestones.total, completed: totals.completed + milestones.completed };
  }, { total: 0, completed: 0 });
  const milestonePercentage = milestoneTotals.total ? milestoneTotals.completed / milestoneTotals.total * 100 : 0;
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · QUARTERLY PRIORITIES`} title="Make the important work visible." description="Rocks stay visible on the sheet. Open a task or milestone when you need its details." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Use in L10</Button>{!readOnly && <Button onClick={onAdd}>Add Rock ＋</Button>}</>} /><div className="rocks-summary-strip card-surface"><div><span className="section-kicker">TOTAL ROCKS</span><strong>{rocks.length}</strong><span>this quarter</span></div><span className="summary-divider" aria-hidden="true" /><div><span className="section-kicker">ON TRACK</span><strong className="positive-text">{rocks.filter((rock) => rock.status === 'on-track').length}</strong><span>with a clear path</span></div><span className="summary-divider" aria-hidden="true" /><div><span className="section-kicker">ATTENTION</span><strong className="negative-text">{rocks.filter((rock) => rock.status === 'off-track').length}</strong><span>need a conversation</span></div><div className="rocks-summary-progress"><div className="progress-label"><span>Milestones complete</span><strong>{milestoneTotals.completed}/{milestoneTotals.total}</strong></div><ProgressBar value={milestonePercentage} /></div></div><div className="rock-sheet-list">{rocks.map((rock, index) => <RockCard key={rock.id} workspace={workspace} rock={rock} index={index} readOnly={readOnly} onEdit={() => onEditRock(rock.id)} onUpdateStatus={() => onUpdateRock(rock)} onAddTask={() => onAddTask(rock.id)} onOpenTask={onOpenTask} onConvertTask={onConvertTask} onUpdateTask={onUpdateTask} />)}{rocks.length === 0 && <EmptyState title="No Rocks yet" detail="Create the first quarterly priority for this team." />}</div></>;
}

function RockCard({ workspace, rock, index, readOnly, onEdit, onUpdateStatus, onAddTask, onOpenTask, onConvertTask, onUpdateTask }: { workspace: Workspace; rock: Rock; index: number; readOnly: boolean; onEdit: () => void; onUpdateStatus: () => void; onAddTask: () => void; onOpenTask: (taskId: string) => void; onConvertTask: (taskId: string) => void; onUpdateTask: (taskId: string, input: Partial<Pick<RockTask, 'status'>>, expectedVersion?: number) => void }) {
  const [tasksOpen, setTasksOpen] = useState(false);
  const milestones = rockMilestoneCounts(rock);
  return <article className={`rock-card card-surface ${rock.status === 'off-track' ? 'rock-card-alert' : ''}`}><div className="rock-card-header"><span className="rock-card-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{rock.title}</h2><p>{rock.description}</p></div><StatusPill status={rock.status} /></div><div className="rock-card-progress"><div className="progress-label"><span>Milestones complete</span><strong>{milestones.completed}/{milestones.total}</strong></div><ProgressBar value={milestones.total ? milestones.completed / milestones.total * 100 : 0} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><div className="rock-card-milestones"><span>{milestones.remaining} remaining</span><span>Due {formatDate(rock.dueDate)}</span></div></div><div className="rock-card-footer"><span><Avatar user={userFor(workspace, rock.ownerId)} size="sm" /> <strong>{userFor(workspace, rock.ownerId).name}</strong></span><div className="rock-card-actions">{!readOnly && <button className="row-action" onClick={onEdit}>Edit details</button>}<button className="row-action" onClick={onUpdateStatus} disabled={readOnly}>{rock.status === 'off-track' ? 'Mark on track' : rock.status === 'complete' ? 'Reopen' : 'Update status'} →</button></div></div><div className="rock-detail"><div className="rock-detail-notes"><div className="rock-detail-notes-head"><span className="section-kicker">ROCK NOTES</span>{!readOnly && <button className="row-action" onClick={onEdit}>Edit notes</button>}</div><p>{rock.notes || 'No notes added yet.'}</p></div><div className="task-header"><div><span className="section-kicker">TASKS / MILESTONES</span><h3>Steps toward the outcome</h3></div><div className="task-header-actions">{rock.tasks.length > 0 && <button type="button" className="task-section-toggle" onClick={() => setTasksOpen((open) => !open)} aria-expanded={tasksOpen}>{tasksOpen ? 'Hide tasks & milestones' : `View ${rock.tasks.length} task${rock.tasks.length === 1 ? '' : 's'} & milestones`}</button>}{!readOnly && <Button variant="secondary" onClick={onAddTask}>Add Task ＋</Button>}</div></div>{tasksOpen && <div className="task-list">{rock.tasks.map((task) => <TaskRow key={task.id} workspace={workspace} task={task} readOnly={readOnly} onOpen={() => onOpenTask(task.id)} onConvert={() => onConvertTask(task.id)} onToggle={() => onUpdateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' }, task.version)} />)}{rock.tasks.length === 0 && <EmptyState title="No Tasks yet" detail="Break this Rock into a small number of dated steps." />}</div>}</div></article>;
}

function TaskRow({ workspace, task, readOnly, onOpen, onConvert, onToggle }: { workspace: Workspace; task: RockTask; readOnly: boolean; onOpen: () => void; onConvert: () => void; onToggle: () => void }) {
  return <div className={`task-row ${task.status === 'done' ? 'task-done' : ''}`}><button className={`todo-checkbox ${task.status === 'done' ? 'checked' : ''}`} onClick={onToggle} disabled={readOnly} aria-label={`Mark ${task.title} ${task.status === 'done' ? 'open' : 'done'}`}>{task.status === 'done' ? '✓' : ''}</button><button type="button" className="task-open-button" onClick={onOpen}><span className="task-copy"><strong>{task.title}</strong><p>{task.notes || 'No task notes.'}</p><small><Avatar user={userFor(workspace, task.assigneeId)} size="sm" />{userFor(workspace, task.assigneeId).name} · assigned {formatDate(task.assignedAt)} · due {formatDate(task.dueDate)}</small></span></button>{task.linkedTodoId ? <span className="linked-chip">Linked To-Do</span> : !readOnly && <button type="button" className="row-action" onClick={onConvert}>Make To-Do →</button>}</div>;
}

function TodosView({ workspace, team, readOnly, todos, onUpdateTodo, onEditTodo, onAdd, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; todos: Todo[]; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onEditTodo: (todoId: string) => void; onAdd: () => void; onNavigate: (view: ViewId) => void }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'mine'>('all');
  const visible = todos.filter((todo) => filter === 'all' || (filter === 'open' ? todo.status !== 'done' : todo.ownerId === workspace.currentUser.id));
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · TEAM COMMITMENTS`} title="Keep the promises visible." description="To-Dos are clear commitments for the next seven days, owned by a person and visible to the team." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Open L10 agenda</Button>{!readOnly && <Button onClick={onAdd}>Add To-Do ＋</Button>}</>} /><div className="todo-summary-grid"><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-teal">✓</span><div><strong>{todos.filter((todo) => todo.status === 'done').length}/{todos.length}</strong><span>complete</span></div><ProgressBar value={todos.length ? todos.filter((todo) => todo.status === 'done').length / todos.length * 100 : 0} tone="teal" /></div><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-coral">◷</span><div><strong>{todos.filter((todo) => todo.status !== 'done').length}</strong><span>still open</span></div><span className="summary-help">Review before the next L10.</span></div><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-lavender">AK</span><div><strong>{todos.filter((todo) => todo.ownerId === workspace.currentUser.id).length}</strong><span>assigned to you</span></div><span className="summary-help">Your visible commitments.</span></div></div><div className="table-card card-surface"><div className="table-card-header"><div><span className="section-kicker">WEEKLY COMMITMENTS</span><h2>Team To-Dos</h2></div><div className="table-filters"><button className={filter === 'all' ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter('all')}>All <span>{todos.length}</span></button><button className={filter === 'open' ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter('open')}>Open</button><button className={filter === 'mine' ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter('mine')}>Mine</button></div></div><div className="todo-table"><div className="table-header"><span /><span>COMMITMENT</span><span>OWNER</span><span>ORIGIN</span><span>DUE</span><span>STATUS</span><span /></div>{visible.map((todo) => <div className={`table-row ${todo.flagged ? 'table-row-flagged' : ''}`} key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdateTodo(todo)} disabled={readOnly} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><button className={`table-primary table-primary-button ${todo.status === 'done' ? 'todo-done' : ''}`} onClick={() => onEditTodo(todo.id)}><strong>{todo.title}</strong><small>{todo.linkedRockTaskId ? 'Linked Rock Task' : todo.origin}{todo.flagged ? ` · flagged after ${todo.carryForwardCount} moves` : ''}</small></button><span className="table-person"><Avatar user={userFor(workspace, todo.ownerId)} size="sm" />{userFor(workspace, todo.ownerId).name}</span><span className="table-origin">{todo.origin}</span><span className={`table-due ${todo.status === 'not-done' ? 'due-overdue' : ''}`}>{formatDate(todo.dueDate)}</span><StatusPill status={todo.flagged ? 'not-done' : todo.status} label={todo.flagged ? 'Flagged' : undefined} /></div>)}{visible.length === 0 && <div className="empty-table"><EmptyState title="No To-Dos match" detail="Change the filter or add a new team commitment." /></div>}</div></div></>;
}

function IssuesView({ workspace, team, readOnly, issues, onStartIssue, onSolveIssue, onEditIssue, onAdd, onTransfer, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; issues: Issue[]; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onEditIssue: (issueId: string) => void; onAdd: () => void; onTransfer: (issueId: string) => void; onNavigate: (view: ViewId) => void }) {
  const [horizon, setHorizon] = useState<IssueHorizon>('short-term');
  const [selectedId, setSelectedId] = useState(issues.find((issue) => issue.horizon === horizon)?.id ?? issues[0]?.id);
  const visible = issues.filter((issue) => issue.horizon === horizon);
  const selectedIssue = visible.find((issue) => issue.id === selectedId) ?? visible[0];
  const open = issues.filter((issue) => issue.status !== 'solved');
  const unassigned = issues.filter((issue) => issue.assignmentState === 'unassigned');
  useEffect(() => { if (visible.length && !visible.some((issue) => issue.id === selectedId)) setSelectedId(visible[0].id); }, [horizon, issues, selectedId, visible]);
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · STANDALONE ISSUES`} title="Solve the right problem." description="Capture Issues when they appear. The team workspace owns the list; the L10 is one place to solve it." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Open live IDS</Button>{!readOnly && <Button onClick={onAdd}>Capture Issue ＋</Button>}</>} /><div className="issues-stat-row"><div><span className="section-kicker">ACTIVE ISSUES</span><strong>{open.length}</strong><span>visible to the team</span></div><div><span className="section-kicker">3+ MEETINGS</span><strong className="warning-text">{issues.filter((issue) => issue.meetingBand === 'orange' || issue.meetingBand === 'red').length}</strong><span>need attention</span></div><div><span className="section-kicker">UNASSIGNED</span><strong className="negative-text">{unassigned.length}</strong><span>source team triage</span></div><div className="issues-stat-note"><span>⌁</span><p>Short-term Issues feed this week’s IDS. Long-term Issues stay visible for future planning.</p></div></div><div className="issue-horizon-tabs"><button className={horizon === 'short-term' ? 'horizon-tab-active' : ''} onClick={() => setHorizon('short-term')}>Short-term <span>{issues.filter((issue) => issue.horizon === 'short-term').length}</span></button><button className={horizon === 'long-term' ? 'horizon-tab-active' : ''} onClick={() => setHorizon('long-term')}>Long-term <span>{issues.filter((issue) => issue.horizon === 'long-term').length}</span></button></div><div className="issues-workbench card-surface"><div className="issues-list-panel"><div className="workbench-panel-head"><div><span className="section-kicker">MEETING HEALTH</span><h2>{horizon === 'short-term' ? 'Weekly Issues' : 'Long-term Issues'}</h2></div><span className="sort-label">Priority · meeting count</span></div>{visible.map((issue) => <button className={`workbench-issue-row ${selectedIssue?.id === issue.id ? 'workbench-issue-selected' : ''} ${issue.status === 'solved' ? 'workbench-issue-solved' : ''}`} key={issue.id} onClick={() => setSelectedId(issue.id)}><span className="issue-number">{issue.priority}</span><span className="workbench-issue-copy"><strong>{issue.title}</strong><small><AgePill issue={issue} /> · {ageLabel(issue)} old</small></span><StatusPill status={issueStatusClass(issue)} /></button>)}{visible.length === 0 && <EmptyState title="No Issues in this horizon" detail="Capture the next problem or idea when it appears." />}</div><IssueDetail workspace={workspace} team={team} issue={selectedIssue} readOnly={readOnly} onEditIssue={onEditIssue} onStartIssue={onStartIssue} onSolveIssue={onSolveIssue} onTransfer={onTransfer} /></div></>;
}

function IssueDetail({ workspace, team, issue, readOnly, onEditIssue, onStartIssue, onSolveIssue, onTransfer }: { workspace: Workspace; team: Team; issue?: Issue; readOnly: boolean; onEditIssue: (issueId: string) => void; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onTransfer: (issueId: string) => void }) {
  if (!issue) return <div className="issue-detail-panel"><EmptyState title="Choose an Issue" detail="Select an item from the list to see its context." /></div>;
  const transfer = workspace.transfers.find((item) => item.issueId === issue.id && item.status === 'pending');
  const issueTransfers = workspace.transfers.filter((item) => item.issueId === issue.id).sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  const sourceTeam = teamFor(workspace, issue.sourceTeamId);
  return <div className="issue-detail-panel"><div className="detail-panel-head"><StatusPill status={issueStatusClass(issue)} /><span className="detail-horizon">{issue.horizon === 'short-term' ? 'Short-term' : 'Long-term'}</span><AgePill issue={issue} /></div><div className="detail-title-row"><h2>{issue.title}</h2>{!readOnly && <Button variant="secondary" onClick={() => onEditIssue(issue.id)}>Edit Details</Button>}</div><p className="issue-detail-copy">{issue.detail}</p>{issue.linkedRockId && <div className="linked-record"><span>Linked Rock</span><strong>{workspace.rocks.find((rock) => rock.id === issue.linkedRockId)?.title ?? 'Quarterly priority'}</strong><span>↗</span></div>}<div className="issue-detail-note"><span className="section-kicker">HISTORICAL CONTEXT</span><p>{issue.idsNote ?? 'No historical context has been recorded yet.'}</p></div>{issue.meetingBand === 'red' && <div className="escalation-callout escalation-escalated"><strong>Escalated after four L10 meetings</strong><span>{issue.meetingsPassed} meetings passed{issue.escalatedToUserId ? ` · routed to ${userFor(workspace, issue.escalatedToUserId).name}` : ''}</span></div>}{issue.assignmentState === 'unassigned' && <div className="unassigned-callout"><strong>Unassigned after transfer rejection</strong><span>Choose a new destination team to put this Issue back into motion.</span></div>}{transfer && <div className="pending-callout"><strong>Transfer pending</strong><span>Waiting for {teamFor(workspace, transfer.destinationTeamId).name}. The source team can cancel this request.</span></div>}<div className="issue-detail-meta"><span><Avatar user={userFor(workspace, issue.ownerId ?? issue.raisedById)} size="sm" /> {issue.ownerId ? `Owner: ${userFor(workspace, issue.ownerId).name}` : 'Unassigned'}</span><span>Created {formatDate(issue.createdAt)} · {ageLabel(issue)} old</span></div>{issue.status !== 'solved' && !readOnly && <div className="detail-actions"><Button variant="secondary" onClick={() => onStartIssue(issue)} disabled={issue.horizon === 'long-term' || issue.assignmentState === 'pending-transfer'}>{issue.status === 'in-ids' ? 'Continue in IDS' : 'Start IDS'} →</Button><Button onClick={() => onSolveIssue(issue)} disabled={issue.assignmentState === 'pending-transfer'}>Mark solved ✓</Button>{!transfer && <Button variant="quiet" onClick={() => onTransfer(issue.id)}>Send to another team ⇄</Button>}</div>}{issue.status === 'solved' && <div className="solved-banner"><span>✓</span><div><strong>Solved and removed from the active list</strong><small>The original creation date and decision history remain preserved.</small></div></div>}{issueTransfers.length > 0 && <div className="issue-history"><span className="section-kicker">ISSUE HISTORY</span>{issueTransfers.map((item) => <div className="issue-history-row" key={item.id}><div><strong>{item.status === 'pending' ? 'Transfer pending' : `Transfer ${item.status}`}</strong><small>{teamFor(workspace, item.sourceTeamId).name} → {teamFor(workspace, item.destinationTeamId).name} · {formatDate(item.requestedAt)}</small></div>{item.rejectionMessage && <span>{item.rejectionMessage}</span>}</div>)}</div>}<div className="issue-provenance"><span>Originated in {sourceTeam.name}</span><span>Version {issue.version}</span></div></div>;
}

function MessagesView({ workspace, team, readOnly, messages, onCompose, onOpen, onMarkRead, onCreateIssue }: { workspace: Workspace; team: Team; readOnly: boolean; messages: TeamMessage[]; onCompose: () => void; onOpen: (messageId: string) => void; onMarkRead: (messageId: string) => void; onCreateIssue: (messageId: string) => void }) {
  const incoming = messages.filter((message) => message.toTeamId === team.id);
  const sent = messages.filter((message) => message.fromTeamId === team.id);
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · TEAM MESSAGES`} title="Keep teams in the loop." description="Send context to another team without moving an Issue. The receiving team can turn a message into a fully editable Issue when it needs IDS." actions={!readOnly ? <Button onClick={onCompose}>New message ＋</Button> : undefined} /><div className="message-summary-grid"><div className="message-summary-card card-surface"><span className="summary-icon summary-icon-coral">✉</span><div><strong>{incoming.filter((message) => message.status === 'unread').length}</strong><span>unread messages</span></div><small>Context waiting for this team.</small></div><div className="message-summary-card card-surface"><span className="summary-icon summary-icon-teal">↗</span><div><strong>{sent.length}</strong><span>sent by this team</span></div><small>Keep handoffs lightweight.</small></div><div className="message-summary-card card-surface"><span className="summary-icon summary-icon-lavender">!</span><div><strong>{messages.filter((message) => message.convertedIssueId).length}</strong><span>converted to Issues</span></div><small>Messages remain linked for provenance.</small></div></div><div className="messages-layout"><MessageList workspace={workspace} title="Received by this team" empty="No messages are waiting for this team." messages={incoming} onOpen={onOpen} onMarkRead={onMarkRead} onCreateIssue={(message) => onCreateIssue(message.id)} canCreateIssue={!readOnly} /><MessageList workspace={workspace} title="Sent by this team" empty="No messages sent yet." messages={sent} onOpen={onOpen} canCreateIssue={false} /></div></>;
}

function MessageList({ workspace, title, empty, messages, onOpen, onMarkRead, onCreateIssue, canCreateIssue }: { workspace: Workspace; title: string; empty: string; messages: TeamMessage[]; onOpen: (messageId: string) => void; onMarkRead?: (messageId: string) => void; onCreateIssue?: (message: TeamMessage) => void; canCreateIssue: boolean }) {
  return <section className="message-list-card card-surface"><div className="table-card-header"><div><span className="section-kicker">INBOX</span><h2>{title}</h2></div><span>{messages.length}</span></div><div className="message-list">{messages.map((message) => <div className={`message-row ${message.status === 'unread' ? 'message-row-unread' : ''}`} key={message.id}><button className="message-open-button" onClick={() => onOpen(message.id)}><span className="message-symbol">{message.status === 'unread' ? '●' : '○'}</span><span className="message-copy"><strong>{message.subject}</strong><small>{teamName(workspace, message.fromTeamId)} → {teamName(workspace, message.toTeamId)} · {formatDate(message.createdAt)}</small><span>{message.body}</span></span></button><div className="message-row-actions">{message.status === 'unread' && onMarkRead && <button className="row-action row-action-small" onClick={() => onMarkRead(message.id)}>Mark read</button>}{message.convertedIssueId ? <span className="linked-chip">Issue created</span> : canCreateIssue && onCreateIssue ? <button className="row-action row-action-small" onClick={() => onCreateIssue(message)}>Create Issue</button> : null}</div></div>)}{messages.length === 0 && <EmptyState title={empty} detail="Messages preserve context without changing ownership." />}</div></section>;
}

function PendingMessagesPanel({ workspace, messages, readOnly, onOpen, onMarkRead, onCreateIssue }: { workspace: Workspace; messages: TeamMessage[]; readOnly: boolean; onOpen: (messageId: string) => void; onMarkRead: (messageId: string) => void; onCreateIssue: (messageId: string) => void }) {
  return <section className="pending-messages-panel"><div className="pending-messages-panel-header"><div><span className="section-kicker">TEAM MESSAGES</span><h3>Important context for the start</h3></div><span>{messages.length}</span></div>{messages.length === 0 ? <p className="pending-messages-empty">No unread incoming team messages are waiting.</p> : <div className="pending-messages-list">{messages.map((message) => <article className="pending-message-row" key={message.id}><div className="pending-message-copy"><strong>{message.subject}</strong><small>{teamName(workspace, message.fromTeamId)} · {formatDate(message.createdAt)} · Unread</small><p>{message.body}</p></div><div className="pending-message-actions"><button className="row-action row-action-small" onClick={() => onOpen(message.id)}>Open</button><button className="row-action row-action-small" onClick={() => onMarkRead(message.id)}>Mark read</button>{!readOnly && <button className="row-action row-action-small" onClick={() => onCreateIssue(message.id)}>Create Issue</button>}</div></article>)}</div>}</section>;
}

function teamName(workspace: Workspace, teamId: string) {
  return workspace.teams.find((team) => team.id === teamId)?.shortName ?? teamId;
}

function MessageModal({ workspace, fromTeam, onClose, onSubmit }: { workspace: Workspace; fromTeam: Team; onClose: () => void; onSubmit: (input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>) => void }) {
  const destinations = workspace.teams.filter((team) => team.active && team.nodeType === 'operational' && team.id !== fromTeam.id);
  return <ModalShell title="Send a team message" description={`Share context from ${fromTeam.name}. Messages do not transfer Issue ownership.`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ fromTeamId: fromTeam.id, toTeamId: String(form.get('toTeamId')), subject: String(form.get('subject') ?? ''), body: String(form.get('body') ?? '') }); }}><label>To team<select name="toTeamId" required defaultValue=""><option value="" disabled>Select a team</option>{destinations.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label><label>Subject<input name="subject" required autoFocus placeholder="What does the other team need to know?" /></label><label>Message<textarea name="body" rows={6} required placeholder="Add context, a question, or a request." /></label><ModalActions onClose={onClose} submitLabel="Send message" /></form></ModalShell>;
}

function MessageDetailModal({ workspace, message, canCreateIssue, onClose, onMarkRead, onCreateIssue }: { workspace: Workspace; message: TeamMessage; canCreateIssue: boolean; onClose: () => void; onMarkRead: (messageId: string) => void; onCreateIssue: () => void }) {
  return <ModalShell title={message.subject} description={`${teamName(workspace, message.fromTeamId)} → ${teamName(workspace, message.toTeamId)} · ${formatDate(message.createdAt)}`} onClose={onClose}><div className="message-detail-modal"><p>{message.body}</p><div className="message-detail-actions">{message.status === 'unread' && <Button variant="secondary" onClick={() => onMarkRead(message.id)}>Mark as read</Button>}{message.convertedIssueId ? <div className="linked-record"><span>Linked Issue</span><strong>{message.convertedIssueId}</strong></div> : canCreateIssue && message.toTeamId !== message.fromTeamId && <Button onClick={onCreateIssue}>Create Issue from message →</Button>}</div></div></ModalShell>;
}

function MessageIssueModal({ workspace, message, onClose, onSubmit }: { workspace: Workspace; message: TeamMessage; onClose: () => void; onSubmit: (input: Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId'>) => void }) {
  return <ModalShell title="Create Issue from message" description="The message has prefilled the Issue. Edit the fields before it enters this team’s Issues list." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ title: String(form.get('title') ?? '').trim(), detail: String(form.get('detail') ?? '').trim(), priority: Number(form.get('priority') ?? 2), horizon: String(form.get('horizon') ?? 'short-term') as IssueHorizon, ownerId: String(form.get('ownerId') ?? workspace.currentUser.id) }); }}><label>Issue title<input name="title" defaultValue={message.subject} autoFocus required /></label><label>Original Context<textarea name="detail" defaultValue={message.body} rows={6} required /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue="2"><option value="1">1 · highest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · lowest</option></select></label><label>Horizon<select name="horizon" defaultValue="short-term"><option value="short-term">Short-term · feed L10</option><option value="long-term">Long-term · future planning</option></select></label></div><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><ModalActions onClose={onClose} submitLabel="Create editable Issue" /></form></ModalShell>;
}

function ScorecardView({ workspace, team, readOnly, metrics, results, weekStartDate, onWeekChange, onFlagMetric, onAddMetric, onEditMetric, onEditResult, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; metrics: ScorecardMetric[]; results: ScorecardResult[]; weekStartDate: string; onWeekChange: (weekStartDate: string) => void; onFlagMetric: (metric: ScorecardMetric, result?: ScorecardResult) => void; onAddMetric: () => void; onEditMetric: (metricId: string) => void; onEditResult: (metricId: string, weekStartDate: string) => void; onNavigate: (view: ViewId) => void }) {
  const weeks = useMemo(() => {
    const output: string[] = [];
    const quarterStart = new Date(workspace.quarter.startDate + 'T12:00:00Z').getTime();
    const quarterEnd = new Date(workspace.quarter.endDate + 'T12:00:00Z').getTime();
    let cursor = weekStartDateFor(workspace.quarter.startDate);
    while (new Date(cursor + 'T12:00:00Z').getTime() < quarterStart) cursor = weekStartDateFor(new Date(new Date(cursor + 'T12:00:00Z').getTime() + 7 * 24 * 60 * 60 * 1000));
    while (new Date(cursor + 'T12:00:00Z').getTime() <= quarterEnd) {
      output.push(cursor);
      cursor = weekStartDateFor(new Date(new Date(cursor + 'T12:00:00Z').getTime() + 7 * 24 * 60 * 60 * 1000));
    }
    return output;
  }, [workspace.quarter.startDate, workspace.quarter.endDate]);
  const currentIndex = Math.max(0, weeks.indexOf(weekStartDate));
  const selectedWeek = weeks[currentIndex] ?? weekStartDate;
  const selectedResults = results.filter((result) => result.weekStartDate === selectedWeek);
  const onTrack = metrics.filter((metric) => selectedResults.find((result) => result.metricId === metric.id)?.status === 'on-track').length;
  const previous = weeks[Math.max(0, currentIndex - 1)];
  const next = weeks[Math.min(weeks.length - 1, currentIndex + 1)];
  return <><PageHeader eyebrow={team.name.toUpperCase() + ' · WEEKLY NUMBERS'} title="Let the numbers speak." description="Enter one result for each Monday-start week. Definitions stay fixed while actuals and statuses tell the weekly story." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Use in L10</Button>{!readOnly && <Button onClick={onAddMetric}>Add measurable ＋</Button>}</>} /><div className="scorecard-week-toolbar card-surface"><div><span className="section-kicker">CURRENT QUARTER · WEEKLY RESULTS</span><strong>Week of {formatDate(selectedWeek)}</strong><small>{selectedResults.length} of {metrics.length} results entered</small></div><div className="scorecard-week-controls"><Button variant="secondary" onClick={() => previous && onWeekChange(previous)} disabled={!previous || currentIndex === 0}>← Previous</Button><Button variant="secondary" onClick={() => next && onWeekChange(next)} disabled={!next || currentIndex === weeks.length - 1}>Next →</Button></div></div><div className="scorecard-hero card-surface"><div><span className="section-kicker">WEEKLY SCORECARD</span><h2>{onTrack} of {metrics.length} measurables are on track.</h2><p>{selectedResults.length === metrics.length ? 'Every measurable has a result for this week.' : 'Missing results stay visible as Not entered until the team records them.'}</p></div><div className="scorecard-orbit"><span>{Math.round(onTrack / Math.max(1, metrics.length) * 100)}%</span><small>healthy</small></div></div><div className="metric-table card-surface"><div className="metric-table-head"><div><span className="section-kicker">TEAM SCORECARD</span><h2>Weekly measurables</h2></div><span className="last-updated">Week of {formatDate(selectedWeek)}</span></div>{metrics.map((metric) => { const result = selectedResults.find((candidate) => candidate.metricId === metric.id); const status = result?.status; return <div className="metric-row scorecard-metric-row" key={metric.id}><div className="metric-name"><span className={'metric-status-dot metric-' + (status ?? 'missing')} /><strong>{metric.label}</strong><small><Avatar user={userFor(workspace, metric.ownerId)} size="sm" />{userFor(workspace, metric.ownerId).name}{!readOnly && <Button variant="quiet" className="metric-edit-button" onClick={() => onEditMetric(metric.id)}>Edit definition</Button>}</small></div><div className="metric-values"><span>Target <b>{metric.target}</b> {metric.unit}</span><span>Actual <b>{result?.actual ?? 'Not entered'}</b>{result?.actual ? ' ' + metric.unit : ''}</span></div><div className="metric-trend"><span className={'trend-arrow trend-' + (result?.trend ?? 'flat')}>{result?.trend === 'up' ? '↗' : result?.trend === 'down' ? '↘' : '→'}</span>{result?.trendLabel ?? 'No comparable prior result'}</div>{result ? <StatusPill status={result.status} /> : <span className="missing-result-pill">Not entered</span>}<div className="scorecard-row-actions">{!readOnly && <Button variant="secondary" className="scorecard-result-button" onClick={() => onEditResult(metric.id, selectedWeek)}>{result ? 'Edit result' : 'Enter result'}</Button>}{result?.status === 'off-track' && !readOnly && <button className="row-action row-action-small" onClick={() => onFlagMetric(metric, result)}>Create Issue</button>}</div></div>; })}{metrics.length === 0 && <EmptyState title="No measurables yet" detail="Add the first team-owned measurable to begin weekly tracking." />}</div></>;
}

function AdminView({ workspace, environmentAccess, onToggleEnvironmentAccess, onCreateTeam, onCreateUser, onEditUser, onUpdateTeam, onEditTeam, onMembership, onSaveSettings }: { workspace: Workspace; environmentAccess: EnvironmentAccess[] | null; onToggleEnvironmentAccess: (userId: string, testAllowed: boolean) => void; onCreateTeam: () => void; onCreateUser: () => void; onEditUser: (userId: string) => void; onUpdateTeam: (teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) => void; onEditTeam: (teamId: string) => void; onMembership: (input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>) => void; onSaveSettings: (settings: IssueAgeSettings) => void }) {
  const [settings, setSettings] = useState(workspace.settings);
  const [selectedUserId, setSelectedUserId] = useState(workspace.users[0]?.id ?? '');
  const [selectedTeamId, setSelectedTeamId] = useState(workspace.teams[0]?.id ?? '');
  const [selectedRole, setSelectedRole] = useState<TeamRole>('Member');
  return <><PageHeader eyebrow="PLATFORM ADMINISTRATION" title="Keep the operating system healthy." description="Manage the hierarchy, user profiles, per-team access, legacy age settings, and the audit trail. Platform administration does not grant work-data access." /><div className="admin-grid"><section className="admin-main"><div className="admin-section-heading"><div><span className="section-kicker">TEAM HIERARCHY</span><h2>Operational workspaces</h2></div><Button onClick={onCreateTeam}>Add team ＋</Button></div><div className="hierarchy-card card-surface">{workspace.teams.filter((team) => !team.parentTeamId).map((team) => <TeamTree key={team.id} workspace={workspace} team={team} depth={0} onToggleType={(id, nodeType) => onUpdateTeam(id, { nodeType })} onEdit={onEditTeam} />)}</div>{environmentAccess && <div className="environment-access-card card-surface"><div className="admin-section-heading"><div><span className="section-kicker">ENVIRONMENT ACCESS</span><h2>Test workspace allowlist</h2></div><span className="admin-inline-note">Managed from Live</span></div><p>Granting access exposes the separate Test database only. Live memberships and roles are unchanged.</p><div className="environment-access-list">{environmentAccess.map((access) => <label className="environment-access-row" key={access.userId}><span><strong>{access.name}</strong><small>{access.email}</small></span><input type="checkbox" checked={access.testAllowed} onChange={(event) => onToggleEnvironmentAccess(access.userId, event.target.checked)} /><span>{access.testAllowed ? 'Test enabled' : 'No Test access'}</span></label>)}</div></div>}<div className="admin-section-heading admin-section-heading-spaced"><div><span className="section-kicker">{isLocalPocBuild ? 'LOCAL DIRECTORY' : 'ENTRA DIRECTORY'}</span><h2>Users and assignments</h2></div><Button variant="secondary" onClick={onCreateUser}>{isLocalPocBuild ? 'Add local user' : 'Add Entra user'} ＋</Button></div><div className="user-directory card-surface">{workspace.users.map((user) => <div className="user-directory-row" key={user.id}><Avatar user={user} size="md" /><div className="user-directory-copy"><strong>{user.name}</strong><span>{user.email}</span></div>{user.platformCapabilities.includes('PlatformAdmin') && <span className="platform-badge">Platform Admin</span>}<span className="membership-count">{workspace.memberships.filter((membership) => membership.userId === user.id && membership.active).length} teams</span><button type="button" className="row-action" onClick={() => onEditUser(user.id)}>Edit</button></div>)}<div className="membership-editor"><span className="section-kicker">ASSIGN USER TO TEAM</span><div className="inline-form"><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>{workspace.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>{workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as TeamRole)}><option>TeamLead</option><option>Member</option><option>Viewer</option></select><Button onClick={() => onMembership({ userId: selectedUserId, teamId: selectedTeamId, role: selectedRole })}>Assign</Button></div></div></div><div className="admin-section-heading admin-section-heading-spaced"><div><span className="section-kicker">AUDITABILITY</span><h2>Recent activity</h2></div></div><div className="audit-list card-surface">{workspace.activity.slice(0, 8).map((event) => <div className="audit-row" key={event.id}><span className={`audit-icon audit-${event.type}`}>{event.type === 'transfer' ? '⇄' : event.type === 'membership' ? '♙' : '•'}</span><div><strong>{event.action}</strong><span>{event.detail}</span></div><time>{formatDate(event.createdAt)} · {formatTime(event.createdAt)}</time></div>)}</div></section><aside className="admin-side"><div className="admin-callout"><span className="callout-symbol">✦</span><span className="section-kicker">{isLocalPocBuild ? 'LOCAL POC MODE' : 'ENTRA ID DIRECTORY'}</span><h2>{isLocalPocBuild ? 'One app-owned source of truth.' : 'One directory identity, one app profile.'}</h2><p>{isLocalPocBuild ? 'Users are local profiles for testing. Authentication can be connected later without changing memberships or authorization rules.' : 'Users are linked to Entra ID by object ID through Microsoft Graph. Memberships and application roles remain managed here.'}</p></div><div className="settings-card card-surface"><span className="section-kicker">LEGACY AGE SETTINGS</span><h3>Compatibility settings retained</h3><p>These thresholds remain available for older records and reports. Active Issue health, filters, highlighting, and escalation now use total meetings.</p><div className="settings-fields"><label>Aging after (days)<input type="number" min="1" value={settings.agingDays} onChange={(event) => setSettings({ ...settings, agingDays: Number(event.target.value) })} /></label><label>Stale after (days)<input type="number" min="2" value={settings.staleDays} onChange={(event) => setSettings({ ...settings, staleDays: Number(event.target.value) })} /></label><label>Critical after (days)<input type="number" min="3" value={settings.criticalDays} onChange={(event) => setSettings({ ...settings, criticalDays: Number(event.target.value) })} /></label></div><Button onClick={() => onSaveSettings(settings)}>Save legacy thresholds</Button></div></aside></div></>;
}

function TeamTree({ workspace, team, depth, onToggleType, onEdit }: { workspace: Workspace; team: Team; depth: number; onToggleType: (teamId: string, nodeType: TeamNodeType) => void; onEdit: (teamId: string) => void }) {
  const children = workspace.teams.filter((item) => item.parentTeamId === team.id);
  const enabledSections = meetingSectionsFor(team).length;
  return <div className="team-tree-node"><div className="team-tree-row" style={{ paddingLeft: `${16 + depth * 26}px` }}><span className="tree-branch">{children.length ? '⌄' : '•'}</span><span className="team-mark" style={{ backgroundColor: team.accent }}>{team.initials}</span><div><strong>{team.name}</strong><small>{team.memberCount} members · {team.nodeType} · {cadenceLabel(team.meetingCadence)} · {enabledSections} L10 sections · {team.escalationUserIds.length} escalation levels</small></div><button className="node-type-toggle" onClick={() => onToggleType(team.id, team.nodeType === 'operational' ? 'grouping' : 'operational')}>{team.nodeType === 'operational' ? 'Operational' : 'Grouping only'}</button><button className="row-action" onClick={() => onEdit(team.id)}>Configure</button></div>{children.map((child) => <TeamTree key={child.id} workspace={workspace} team={child} depth={depth + 1} onToggleType={onToggleType} onEdit={onEdit} />)}</div>;
}

function ProfileView({ workspace, onSave }: { workspace: Workspace; onSave: (input: Pick<Partial<User>, 'name' | 'email' | 'avatarDataUrl'>) => void }) {
  const user = workspace.currentUser;
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [avatarDataUrl, setAvatarDataUrl] = useState(user.avatarDataUrl ?? '');
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAvatarError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError('Choose an image smaller than 5 MB so it can be compressed safely.');
      return;
    }
    try {
      setAvatarError(null);
      setAvatarDataUrl(await compressAvatar(file));
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : 'The avatar could not be compressed.');
    }
  };
  return <><PageHeader eyebrow="YOUR PROFILE" title="Make your presence visible." description="Your avatar appears anywhere a Rock, Task, To-Do, Issue, or meeting has an accountable person." /><div className="profile-layout"><section className="profile-card card-surface"><div className="profile-hero"><Avatar user={{ ...user, name, email, avatarDataUrl }} size="lg" /><div><span className="section-kicker">LOCAL PROFILE</span><h2>{name}</h2><p>{email}</p></div></div><form className="profile-form" onSubmit={(event) => { event.preventDefault(); onSave({ name: name.trim(), email: email.trim(), avatarDataUrl: avatarDataUrl || undefined }); }}><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Profile picture<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} /><small>Images are resized to 256px and compressed before storage · max 256 KB</small>{avatarError && <small className="field-error">{avatarError}</small>}</label><div className="profile-actions"><Button type="submit">Save profile</Button></div></form></section><aside className="profile-side card-surface"><span className="section-kicker">ACCESS</span><h2>{user.platformCapabilities.includes('PlatformAdmin') ? 'Platform Administrator' : 'Team member'}</h2><p>Team memberships determine which workspaces you can access. Platform administration is a separate capability and does not automatically reveal work data.</p><div className="profile-memberships">{workspace.memberships.filter((membership) => membership.userId === user.id && membership.active).map((membership) => <div key={membership.id}><span>{teamFor(workspace, membership.teamId).name}</span><StatusPill status={membership.role} label={membership.role} /></div>)}</div></aside></div></>;
}

function NotificationPanel({ workspace, notifications, onRead, onClose }: { workspace: Workspace; notifications: Workspace['notifications']; onRead: (id: string) => void; onClose: () => void }) {
  return <div className="notification-panel card-surface"><div className="notification-panel-head"><div><span className="section-kicker">INBOX</span><h2>Notifications</h2></div><button className="icon-button" onClick={onClose} aria-label="Close notifications">×</button></div>{notifications.length === 0 ? <EmptyState title="You are all caught up" detail="Transfer decisions and other notices will appear here." /> : notifications.map((notification) => <div className="notification-row" key={notification.id}><span className="notification-symbol">{notification.type === 'issue-transfer-requested' ? '⇄' : notification.type === 'team-message' ? '✉' : notification.type === 'issue-escalation' ? '!' : '•'}</span><div><strong>{notification.title}</strong><p>{notification.message}</p><small>{formatDate(notification.createdAt)} · {formatTime(notification.createdAt)}</small></div><button className="row-action" onClick={() => onRead(notification.id)}>Mark read</button></div>)}</div>;
}

function NoWorkspaceAccess() {
  return <div className="no-workspace-access card-surface"><span className="empty-state-icon">◉</span><h2>No team workspace assigned</h2><p>Your profile is active, but an administrator has not assigned you to a team yet.</p></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-state-icon">✦</span><strong>{title}</strong><span>{detail}</span></div>;
}

function ModalShell({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button><span className="modal-symbol">✦</span><h2 id="modal-title">{title}</h2><p>{description}</p>{children}</div></div>;
}

function ModalActions({ onClose, submitLabel }: { onClose: () => void; submitLabel: string }) {
  return <div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">{submitLabel} →</Button></div>;
}

function RichTextEditor({ name, value, disabled, placeholder }: { name: string; value: string; disabled: boolean; placeholder: string }) {
  const [html, setHtml] = useState(() => sanitizeTodoNotes(value));
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => setHtml(sanitizeTodoNotes(value)), [value]);
  const format = (command: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList') => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command);
    setHtml(sanitizeTodoNotes(editorRef.current?.innerHTML));
  };
  return <div className={`rich-text-editor ${disabled ? 'rich-text-editor-disabled' : ''}`}><div className="rich-text-toolbar" aria-label="Notes formatting"><button type="button" onMouseDown={(event) => { event.preventDefault(); format('bold'); }} disabled={disabled} aria-label="Bold"><strong>B</strong></button><button type="button" onMouseDown={(event) => { event.preventDefault(); format('italic'); }} disabled={disabled} aria-label="Italic"><em>I</em></button><button type="button" onMouseDown={(event) => { event.preventDefault(); format('insertUnorderedList'); }} disabled={disabled} aria-label="Bulleted list">• list</button><button type="button" onMouseDown={(event) => { event.preventDefault(); format('insertOrderedList'); }} disabled={disabled} aria-label="Numbered list">1. list</button></div><div ref={editorRef} className="rich-text-input" contentEditable={!disabled} suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: html }} data-placeholder={placeholder} onInput={(event) => setHtml(sanitizeTodoNotes(event.currentTarget.innerHTML))} /><input type="hidden" name={name} value={html} /></div>;
}

function RichTextViewer({ value }: { value: string }) {
  return <div className="rich-text-viewer" dangerouslySetInnerHTML={{ __html: sanitizeTodoNotes(value) }} />;
}

function TodoChecklist({ workspace, todo, readOnly, onAdd, onUpdate, onDelete }: { workspace: Workspace; todo: Todo; readOnly: boolean; onAdd: (todoId: string, text: string, supporterId?: string) => void; onUpdate: (todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>) => void; onDelete: (todoId: string, itemId: string) => void }) {
  const teamUsers = workspace.users.filter((user) => user.active && workspace.memberships.some((membership) => membership.teamId === todo.teamId && membership.userId === user.id && membership.active));
  const [draft, setDraft] = useState('');
  const [draftSupporterId, setDraftSupporterId] = useState(todo.ownerId);
  useEffect(() => {
    if (!teamUsers.some((user) => user.id === draftSupporterId)) setDraftSupporterId(todo.ownerId);
  }, [draftSupporterId, teamUsers, todo.ownerId]);
  const add = () => {
    if (!draft.trim() || readOnly) return;
    onAdd(todo.id, draft.trim(), draftSupporterId);
    setDraft('');
    setDraftSupporterId(todo.ownerId);
  };
  const completed = todo.checklist.filter((item) => item.completed).length;
  return <section className="todo-checklist"><div className="todo-checklist-heading"><div><span className="section-kicker">CHECKLIST</span><strong>Support the commitment</strong></div><span>{completed}/{todo.checklist.length || 0}</span></div>{todo.checklist.length > 0 && <div className="todo-checklist-list">{todo.checklist.map((item) => <ChecklistRow key={item.id} workspace={workspace} todo={todo} item={item} teamUsers={teamUsers} readOnly={readOnly} onUpdate={onUpdate} onDelete={onDelete} />)}</div>}{todo.checklist.length === 0 && <p className="todo-checklist-empty">Break this To-Do into small steps and assign a Supporter to each one.</p>}{!readOnly && <div className="todo-checklist-add"><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="Add a checklist step" aria-label="New checklist step" /><select value={draftSupporterId} onChange={(event) => setDraftSupporterId(event.target.value)} aria-label="Supporter for new checklist step">{teamUsers.map((user) => <option key={user.id} value={user.id}>{user.id === todo.ownerId ? `${user.name} · Owner` : user.name}</option>)}</select><Button variant="secondary" onClick={add} disabled={!draft.trim()}>Add step</Button></div>}</section>;
}

function ChecklistRow({ workspace, todo, item, teamUsers, readOnly, onUpdate, onDelete }: { workspace: Workspace; todo: Todo; item: TodoChecklistItem; teamUsers: User[]; readOnly: boolean; onUpdate: (todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>) => void; onDelete: (todoId: string, itemId: string) => void }) {
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.id, item.text]);
  const supporter = userFor(workspace, item.supporterId);
  const saveText = () => {
    if (text.trim() && text.trim() !== item.text) onUpdate(todo.id, item.id, { text: text.trim() });
    else if (!text.trim()) setText(item.text);
  };
  return <div className={`todo-checklist-row ${item.completed ? 'todo-checklist-row-complete' : ''}`}><button type="button" className={`todo-checkbox ${item.completed ? 'checked' : ''}`} onClick={() => onUpdate(todo.id, item.id, { completed: !item.completed })} disabled={readOnly} aria-label={`${item.completed ? 'Reopen' : 'Complete'} ${item.text}`}>{item.completed ? '✓' : ''}</button><input className="todo-checklist-text" value={text} onChange={(event) => setText(event.target.value)} onBlur={saveText} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} disabled={readOnly} aria-label="Checklist step" /><details className="supporter-popover"><summary className="supporter-chip"><Avatar user={supporter} size="sm" /><span>{supporter.name}</span><small>Supporter</small></summary>{!readOnly && <div className="supporter-menu">{teamUsers.map((user) => <button type="button" key={user.id} onClick={() => onUpdate(todo.id, item.id, { supporterId: user.id })}>{user.name}{user.id === item.supporterId ? ' ✓' : ''}</button>)}</div>}</details><button type="button" className="checklist-delete" onClick={() => onDelete(todo.id, item.id)} disabled={readOnly} aria-label={`Delete ${item.text}`}>×</button></div>;
}

function LinkedIssuePanel({ workspace, issueId }: { workspace: Workspace; issueId?: string }) {
  if (!issueId) return null;
  const issue = workspace.issues.find((candidate) => candidate.id === issueId);
  if (!issue) return <section className="linked-issue-panel"><span className="section-kicker">LINKED ISSUE</span><p>The source Issue is not available in this workspace.</p></section>;
  return <section className="linked-issue-panel"><div className="linked-issue-heading"><div><span className="section-kicker">LINKED ISSUE · READ ONLY</span><strong>{issue.title}</strong></div><span className="linked-chip">Issue context</span></div><dl className="linked-issue-grid"><div><dt>Original Context</dt><dd>{issue.detail || '—'}</dd></div><div><dt>Historical Context</dt><dd>{issue.idsNote || 'No history recorded.'}</dd></div><div><dt>Status</dt><dd><StatusPill status={issue.status} /></dd></div><div><dt>Owner</dt><dd>{userFor(workspace, issue.ownerId ?? issue.raisedById).name}</dd></div><div><dt>Priority</dt><dd>P{issue.priority}</dd></div><div><dt>Horizon</dt><dd>{issue.horizon === 'short-term' ? 'Short-term' : 'Long-term'}</dd></div><div><dt>Meeting health</dt><dd><AgePill issue={issue} /></dd></div><div><dt>Days old</dt><dd>{ageLabel(issue)}</dd></div><div><dt>Escalation</dt><dd>{issue.meetingBand === 'red' ? 'Escalated at four meetings' : 'Not escalated'}</dd></div><div><dt>Provenance</dt><dd>Created from the {teamFor(workspace, issue.sourceTeamId).name} Issue list.</dd></div></dl></section>;
}

function UserOptions({ workspace, name, defaultValue }: { workspace: Workspace; name: string; defaultValue?: string }) {
  return <select name={name} defaultValue={defaultValue ?? workspace.currentUser.id}>{workspace.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>;
}

function TodoModal({ workspace, team, onClose, onSubmit }: { workspace: Workspace; team: Team; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a To-Do" description={`Create a clear seven-day commitment for ${team.name}.`} onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Commitment<input name="title" placeholder="What will be done?" autoFocus required /></label><label>Notes<RichTextEditor name="notes" value="" disabled={false} placeholder="Add useful context, decisions, or the next step." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><label>Due date<input name="dueDate" type="date" defaultValue={workspaceToday} required /></label><ModalActions onClose={onClose} submitLabel="Add To-Do" /></form></ModalShell>;
}

function ScorecardMetricModal({ workspace, team, metric, onClose, onSubmit }: { workspace: Workspace; team: Team; metric?: ScorecardMetric; onClose: () => void; onSubmit: (input: Pick<ScorecardMetric, 'label' | 'target' | 'unit' | 'ownerId'>) => void }) {
  const teamUsers = workspace.memberships.filter((membership) => membership.teamId === team.id && membership.active).map((membership) => workspace.users.find((user) => user.id === membership.userId)).filter((user): user is User => Boolean(user));
  return <ModalShell title={metric ? 'Edit measurable definition' : 'Add a measurable'} description={`Set the fixed target and accountable owner for ${team.name}. Weekly actuals and statuses are entered separately.`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ label: String(form.get('label') ?? '').trim(), target: String(form.get('target') ?? '').trim(), unit: String(form.get('unit') ?? '').trim(), ownerId: String(form.get('ownerId') ?? '') }); }}><label>Measurable label<input name="label" defaultValue={metric?.label} autoFocus required placeholder="What number tells the team it is on track?" /></label><div className="form-grid"><label>Fixed target<input name="target" defaultValue={metric?.target} required placeholder="e.g. 90% or < 2" /></label><label>Unit<input name="unit" defaultValue={metric?.unit} required placeholder="e.g. on-time" /></label></div><label>Owner<select name="ownerId" defaultValue={metric?.ownerId ?? teamUsers[0]?.id ?? workspace.currentUser.id} required>{teamUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><small className="form-help">Targets belong to the definition. Record the actual result and selected status for each week on the Scorecard.</small><ModalActions onClose={onClose} submitLabel={metric ? 'Save definition' : 'Add measurable'} /></form></ModalShell>;
}

function ScorecardResultModal({ metric, result, weekStartDate, onClose, onSubmit }: { metric: ScorecardMetric; result?: ScorecardResult; weekStartDate: string; onClose: () => void; onSubmit: (input: Pick<ScorecardResult, 'actual' | 'status'>) => void }) {
  return <ModalShell title={`${result ? 'Edit' : 'Enter'} weekly result`} description={`${metric.label} · week of ${formatDate(weekStartDate)} · target ${metric.target} ${metric.unit}`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ actual: String(form.get('actual') ?? '').trim(), status: String(form.get('status') ?? 'on-track') as ScorecardResult['status'] }); }}><label>Actual value<input name="actual" defaultValue={result?.actual} autoFocus required placeholder="Enter the team’s result" /></label><label>Status<select name="status" defaultValue={result?.status ?? 'on-track'}><option value="on-track">On track</option><option value="off-track">Off track</option></select></label><small className="form-help">Trend is calculated from the prior week when both actual values are numeric. Status remains the team’s explicit weekly selection.</small><ModalActions onClose={onClose} submitLabel={result ? 'Save result' : 'Enter result'} /></form></ModalShell>;
}

function TodoEditModal({ workspace, todo, readOnly, onClose, onSubmit, onChecklistAdd, onChecklistUpdate, onChecklistDelete }: { workspace: Workspace; todo: Todo; readOnly: boolean; onClose: () => void; onSubmit: (input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>) => void; onChecklistAdd: (todoId: string, text: string, supporterId?: string) => void; onChecklistUpdate: (todoId: string, itemId: string, input: Partial<Pick<TodoChecklistItem, 'text' | 'completed' | 'supporterId'>>) => void; onChecklistDelete: (todoId: string, itemId: string) => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    const form = new FormData(event.currentTarget);
    onSubmit({ title: String(form.get('title') ?? '').trim(), notes: String(form.get('notes') ?? ''), ownerId: String(form.get('ownerId') ?? ''), dueDate: String(form.get('dueDate') ?? ''), status: String(form.get('status') ?? todo.status) as TodoStatus });
  };
  return <ModalShell title="Open To-Do" description={readOnly ? 'This To-Do is shown for reference. Closed or read-only meeting records cannot be edited.' : 'Add working notes, adjust the owner or due date, and keep the commitment visible to the team.'} onClose={onClose}><form className="modal-form" onSubmit={submit}><fieldset className="modal-fieldset" disabled={readOnly}><label>Commitment<input name="title" defaultValue={todo.title} autoFocus required /></label><label>Notes{readOnly ? <RichTextViewer value={todo.notes} /> : <RichTextEditor name="notes" value={todo.notes} disabled={false} placeholder="Add context, progress, or the next step." />}</label><label>Owner<UserOptions workspace={workspace} name="ownerId" defaultValue={todo.ownerId} /></label><div className="form-grid"><label>Due date<input name="dueDate" type="date" defaultValue={todo.dueDate} required /></label><label>Status<select name="status" defaultValue={todo.status}><option value="open">Open</option><option value="done">Done</option><option value="not-done">Not done</option></select></label></div><div className="todo-rollover-callout"><strong>Moved forward {todo.carryForwardCount} times</strong>{' '}<span>{todo.flagged ? 'This To-Do has become an Issue for IDS.' : 'Changing this due date to a later date records an automatic rollover. Completed To-Dos never accrue rollovers.'}</span></div></fieldset><TodoChecklist workspace={workspace} todo={todo} readOnly={readOnly} onAdd={onChecklistAdd} onUpdate={onChecklistUpdate} onDelete={onChecklistDelete} /><LinkedIssuePanel workspace={workspace} issueId={todo.sourceIssueId} /><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Close</Button>{!readOnly && <Button type="submit">Save To-Do →</Button>}</div></form></ModalShell>;
}

function ResolveIssueModal({ issue, onClose, onSubmit }: { issue: Issue; onClose: () => void; onSubmit: (input: SolveIssueInput) => void }) {
  const [createFollowUpTodo, setCreateFollowUpTodo] = useState(true);
  return <ModalShell title="Solve Issue" description={`Record the resolution for “${issue.title}”. The decision is appended to Historical Context.`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ createFollowUpTodo, resolutionNote: String(form.get('resolutionNote') ?? '').trim() || undefined }); }}><label className="checkbox-label"><input type="checkbox" checked={createFollowUpTodo} onChange={(event) => setCreateFollowUpTodo(event.target.checked)} /> Create follow-up To-Do <small>Owner: you · due in 7 days</small></label><label>Resolution note<textarea name="resolutionNote" rows={5} autoFocus placeholder="What did the team decide? Include whether the commitment needs follow-up." /></label><small className="form-help">Solving without a follow-up To-Do records that choice in the Issue history.</small><ModalActions onClose={onClose} submitLabel="Solve Issue" /></form></ModalShell>;
}

function IssueModal({ workspace, onClose, onSubmit }: { workspace: Workspace; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Capture an Issue" description="Name the problem, decision, idea, or opportunity. The team can solve short-term Issues in IDS when the time is right." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Issue title<input name="title" placeholder="What needs solving?" autoFocus required /></label><label>Original Context<textarea name="detail" rows={4} placeholder="Add enough context for the team to recognise the Issue." /></label><div className="form-grid"><label>Horizon<select name="horizon" defaultValue="short-term"><option value="short-term">Short-term · feed L10</option><option value="long-term">Long-term · future planning</option></select></label><label>Priority<select name="priority" defaultValue="1"><option value="1">1 · highest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · lowest</option></select></label></div><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><ModalActions onClose={onClose} submitLabel="Add to Issues" /></form></ModalShell>;
}

function RockEditModal({ workspace, rock, onClose, onSubmit }: { workspace: Workspace; rock: Rock; onClose: () => void; onSubmit: (input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'dueDate' | 'priority'>>) => void }) {
  return <ModalShell title="Edit Rock details" description="Improve the outcome description or add notes without changing its quarterly identity." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ title: String(form.get('title') ?? '').trim(), description: String(form.get('description') ?? '').trim(), notes: String(form.get('notes') ?? '').trim(), ownerId: String(form.get('ownerId') ?? workspace.currentUser.id), priority: String(form.get('priority') ?? rock.priority) as Rock['priority'], dueDate: String(form.get('dueDate') ?? rock.dueDate) }); }}><label>Rock title<input name="title" defaultValue={rock.title} autoFocus required /></label><label>Description<textarea name="description" defaultValue={rock.description} rows={4} required /></label><label>Notes<textarea name="notes" defaultValue={rock.notes} rows={6} placeholder="Add the context the team needs after creation." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" defaultValue={rock.ownerId} /></label><label>Priority<select name="priority" defaultValue={rock.priority}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Due date<input name="dueDate" type="date" defaultValue={rock.dueDate} required /></label><ModalActions onClose={onClose} submitLabel="Save Rock" /></form></ModalShell>;
}

function IssueEditModal({ workspace, issue, meetingId, readOnly, onClose, onSubmit }: { workspace: Workspace; issue: Issue; meetingId?: string; readOnly: boolean; onClose: () => void; onSubmit: (input: Partial<Pick<Issue, 'title' | 'detail' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, meetingNote?: string) => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    const form = new FormData(event.currentTarget);
    const ownerId = String(form.get('ownerId') ?? '').trim();
    onSubmit({ title: String(form.get('title') ?? '').trim(), detail: String(form.get('detail') ?? '').trim(), priority: Number(form.get('priority') ?? issue.priority), horizon: String(form.get('horizon') ?? issue.horizon) as IssueHorizon, ownerId: ownerId || undefined, idsNote: String(form.get('idsNote') ?? '').trim() }, meetingId ? String(form.get('meetingNote') ?? '').trim() : undefined);
  };
  return <ModalShell title={meetingId ? 'Open Issue during IDS' : 'Edit Issue details'} description={readOnly ? 'This Issue is shown for reference. Closed or read-only meeting records cannot be edited.' : meetingId ? 'Capture notes for this meeting. They are added to the Issue history and meeting recap.' : 'Keep the Issue context current as the team learns more.'} onClose={onClose}><form className="modal-form" onSubmit={submit}><fieldset className="modal-fieldset" disabled={readOnly}><label>Issue title<input name="title" defaultValue={issue.title} autoFocus required /></label><label>Original Context<textarea name="detail" defaultValue={issue.detail} rows={5} required /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue={String(issue.priority)}><option value="1">1 · highest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · lowest</option></select></label><label>Horizon<select name="horizon" defaultValue={issue.horizon}><option value="short-term">Short-term · feed L10</option><option value="long-term">Long-term · future planning</option></select></label></div><label>Owner<UserOptions workspace={workspace} name="ownerId" defaultValue={issue.ownerId ?? issue.raisedById} /></label><label>Historical Context<textarea name="idsNote" defaultValue={issue.idsNote ?? ''} rows={5} placeholder="Keep the running Issue history visible." /></label>{meetingId && <label className="meeting-note-field">This meeting’s IDS notes<textarea name="meetingNote" rows={5} placeholder="What did the team identify, discuss, decide, or defer today?" /></label>}</fieldset><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Close</Button>{!readOnly && <Button type="submit">Save Issue →</Button>}</div></form></ModalShell>;
}

function RockModal({ workspace, onClose, onSubmit }: { workspace: Workspace; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a Rock" description="Define one important quarterly outcome with one accountable owner." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Rock title<input name="title" placeholder="What must be true by quarter end?" autoFocus required /></label><label>Description<textarea name="description" rows={3} placeholder="Describe the outcome." /></label><label>Notes<textarea name="notes" rows={2} placeholder="Add working notes or guardrails." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Due date<input name="dueDate" type="date" defaultValue="2026-09-30" required /></label></div><ModalActions onClose={onClose} submitLabel="Add Rock" /></form></ModalShell>;
}

function TaskModal({ workspace, rock, onClose, onSubmit }: { workspace: Workspace; rock: Rock; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a Rock Task" description={`Break “${rock.title}” into a dated, accountable step.`} onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Task title<input name="title" placeholder="What is the next visible step?" autoFocus required /></label><label>Notes<textarea name="notes" rows={3} placeholder="Add task context." /></label><label>Assignee<UserOptions workspace={workspace} name="assigneeId" /></label><div className="form-grid"><label>Assigned date<input name="assignedAt" type="date" defaultValue={workspaceToday} required /></label><label>Start date<input name="startDate" type="date" defaultValue={workspaceToday} required /></label></div><label>Due date<input name="dueDate" type="date" defaultValue={rock.dueDate} required /></label><ModalActions onClose={onClose} submitLabel="Add Task" /></form></ModalShell>;
}

function TaskEditModal({ workspace, task, readOnly, onClose, onSubmit, onDelete }: { workspace: Workspace; task: RockTask; readOnly: boolean; onClose: () => void; onSubmit: (input: Partial<Pick<RockTask, 'title' | 'notes' | 'assigneeId' | 'assignedAt' | 'startDate' | 'dueDate' | 'status'>>) => void; onDelete: () => void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    const form = new FormData(event.currentTarget);
    onSubmit({ title: String(form.get('title') ?? '').trim(), notes: String(form.get('notes') ?? '').trim(), assigneeId: String(form.get('assigneeId') ?? ''), assignedAt: String(form.get('assignedAt') ?? ''), startDate: String(form.get('startDate') ?? ''), dueDate: String(form.get('dueDate') ?? ''), status: String(form.get('status') ?? task.status) as RockTaskStatus });
  };
  return <ModalShell title="Open Rock Task" description={readOnly ? 'This milestone is shown for reference. Read-only workspaces cannot edit or delete it.' : 'Update the accountable person, dates, notes, or status for this milestone.'} onClose={onClose}><form className="modal-form" onSubmit={submit}><fieldset className="modal-fieldset" disabled={readOnly}><label>Task title<input name="title" defaultValue={task.title} autoFocus required /></label><label>Notes<textarea name="notes" defaultValue={task.notes} rows={5} placeholder="Add task context." /></label><label>Assignee<UserOptions workspace={workspace} name="assigneeId" defaultValue={task.assigneeId} /></label><div className="form-grid"><label>Assigned date<input name="assignedAt" type="date" defaultValue={task.assignedAt} required /></label><label>Start date<input name="startDate" type="date" defaultValue={task.startDate} required /></label></div><div className="form-grid"><label>Due date<input name="dueDate" type="date" defaultValue={task.dueDate} required /></label><label>Status<select name="status" defaultValue={task.status}><option value="open">Open</option><option value="in-progress">In progress</option><option value="done">Done</option></select></label></div></fieldset>{task.linkedTodoId && <div className="task-linked-callout">This milestone is linked to a To-Do. Saving keeps the owner, due date, and completion status synchronized. Deleting the milestone keeps that To-Do as a standalone commitment.</div>}<div className="modal-actions task-edit-actions">{!readOnly && <Button variant="danger" onClick={onDelete}>Delete task</Button>}<span className="task-edit-spacer" aria-hidden="true" /><Button variant="secondary" onClick={onClose}>Close</Button>{!readOnly && <Button type="submit">Save task →</Button>}</div></form></ModalShell>;
}

function TransferModal({ workspace, issue, onClose, onSubmit }: { workspace: Workspace; issue: Issue; onClose: () => void; onSubmit: (destinationTeamId: string, note: string) => void }) {
  const destinations = workspace.teams.filter((team) => team.active && team.nodeType === 'operational' && team.id !== issue.teamId);
  return <ModalShell title="Send Issue to another team" description="The destination team will receive an in-app notice and must accept or reject the handoff." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit(String(form.get('destinationTeamId')), String(form.get('note') ?? '').trim()); }}><div className="transfer-preview"><AgePill issue={issue} /><strong>{issue.title}</strong><span>Original team: {teamFor(workspace, issue.teamId).name}</span></div><label>Destination team<select name="destinationTeamId" required defaultValue=""> <option value="" disabled>Select a team</option>{destinations.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Handoff note<textarea name="note" rows={3} placeholder="Why does this team need to decide it?" /></label><ModalActions onClose={onClose} submitLabel="Request transfer" /></form></ModalShell>;
}

function RejectModal({ transfer, issue, onClose, onSubmit }: { transfer: IssueTransfer; issue?: Issue; onClose: () => void; onSubmit: (message: string) => void }) {
  return <ModalShell title="Reject this transfer" description={`Explain why ${issue?.title ?? 'this Issue'} cannot be accepted by your team. The Issue will return to its source team unassigned.`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(String(new FormData(event.currentTarget).get('message') ?? '').trim()); }}><label>Rejection message<textarea name="message" rows={5} autoFocus placeholder="What does the source team need to know?" required /></label><ModalActions onClose={onClose} submitLabel="Reject and unassign" /></form></ModalShell>;
}

function TeamModal({ workspace, onClose, onSubmit }: { workspace: Workspace; onClose: () => void; onSubmit: (input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }) => void }) {
  return <ModalShell title="Create a team workspace" description="Every new node can own its own Rocks, To-Dos, Issues, and L10, or act as grouping-only." onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const shortName = String(form.get('shortName')); onSubmit({ name: String(form.get('name')), shortName, description: String(form.get('description')), parentTeamId: String(form.get('parentTeamId') || '') || null, nodeType: String(form.get('nodeType')) as TeamNodeType, meetingCadence: String(form.get('meetingCadence')) as Team['meetingCadence'], meetingDay: String(form.get('meetingDay')), meetingTime: String(form.get('meetingTime')), accent: '#4c8f86', initials: initialsFor(shortName), meetingSections: defaultMeetingSections(), escalationUserIds: [] }); }}>
      <label>Team name<input name="name" autoFocus required placeholder="e.g. Customer Success" /></label>
      <label>Short name<input name="shortName" required placeholder="e.g. CS" /></label>
      <label>Description<textarea name="description" rows={3} /></label>
      <label>Parent node<select name="parentTeamId" defaultValue="leadership">{workspace.teams.filter((team) => team.active).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Node type<select name="nodeType" defaultValue="operational"><option value="operational">Operational workspace</option><option value="grouping">Grouping only</option></select></label>
      <div className="form-grid">
        <label>Meeting cadence<select name="meetingCadence" defaultValue="weekly"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <label>Meeting day / date<input name="meetingDay" defaultValue="Friday" required /></label>
        <label>Meeting time<input name="meetingTime" defaultValue="9:00 AM" required /></label>
      </div>
      <small className="form-help">For monthly meetings, enter a day number (1–31). The current occurrence can be moved to an exact date from the L10 screen.</small>
      <ModalActions onClose={onClose} submitLabel="Create team" />
    </form>
  </ModalShell>;
}

function MeetingScheduleModal({ team, meeting, onClose, onSubmit }: { team: Team; meeting: Workspace['meetings'][number]; onClose: () => void; onSubmit: (input: { scheduledDate: string; scheduledTime: string }) => void }) {
  return <ModalShell title="Reschedule this meeting" description={`Change this ${cadenceLabel(team.meetingCadence).toLowerCase()} L10 occurrence without changing the team’s recurring cadence.`} onClose={onClose}>
    <form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ scheduledDate: String(form.get('scheduledDate') ?? ''), scheduledTime: String(form.get('scheduledTime') ?? '') }); }}>
      <label>Meeting date<input name="scheduledDate" type="date" defaultValue={meeting.scheduledDate ?? meeting.weekStartDate ?? ''} required /></label>
      <label>Meeting time<input name="scheduledTime" defaultValue={meeting.scheduledTime ?? team.meetingTime} placeholder="e.g. 9:00 AM" required /></label>
      <small className="form-help">Use this when the meeting was missed or needs a one-off time change. Future meetings continue on the {cadenceLabel(team.meetingCadence).toLowerCase()} cadence.</small>
      <ModalActions onClose={onClose} submitLabel="Save date & time" />
    </form>
  </ModalShell>;
}

function MeetingSkipModal({ meeting, onClose, onSubmit }: { meeting: Workspace['meetings'][number]; onClose: () => void; onSubmit: (reason: MeetingSkipReason, note: string) => void }) {
  return <ModalShell title="Skip this meeting" description="The occurrence will stay in history as skipped and the team’s recurring cadence will continue." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit(String(form.get('reason')) as MeetingSkipReason, String(form.get('note') ?? '').trim()); }}><label>Reason<select name="reason" defaultValue="public-holiday"><option value="public-holiday">Public holiday</option><option value="annual-leave">Annual leave</option><option value="other">Other</option></select></label><label>Note <span className="form-label-note">optional</span><textarea name="note" rows={4} placeholder="Add context for the team’s history." /></label><small className="form-help">Skipped meetings do not create an AI summary.</small><ModalActions onClose={onClose} submitLabel="Skip meeting" /></form></ModalShell>;
}

function TeamEditModal({ workspace, team, onClose, onSubmit }: { workspace: Workspace; team: Team; onClose: () => void; onSubmit: (input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingCadence' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) => void }) {
  const sections = defaultMeetingSections().map((section) => team.meetingSections.find((configured) => configured.id === section.id) ?? section);
  const recipients = workspace.users.filter((user) => user.active);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('section-ids', 'on');
    form.set('section-conclude', 'on');
    const shortName = String(form.get('shortName') ?? '');
    const meetingSections = sections.map((section) => ({
      ...section,
      enabled: form.get(`section-${section.id}`) === 'on',
      duration: Number(form.get(`duration-${section.id}`) ?? section.duration),
    }));
    const escalationUserIds = [0, 1, 2].map((level) => String(form.get(`escalation-${level}`) ?? '')).filter(Boolean);
    onSubmit({
      name: String(form.get('name') ?? ''),
      shortName,
      description: String(form.get('description') ?? ''),
      parentTeamId: String(form.get('parentTeamId') || '') || null,
      nodeType: String(form.get('nodeType')) as TeamNodeType,
      meetingCadence: String(form.get('meetingCadence')) as Team['meetingCadence'],
      meetingDay: String(form.get('meetingDay') ?? ''),
      meetingTime: String(form.get('meetingTime') ?? ''),
      initials: initialsFor(shortName),
      meetingSections,
      escalationUserIds,
    });
  };
  return <ModalShell title={`Configure ${team.name}`} description="Set the team’s meeting cadence, L10 structure, and escalation path for unresolved Issues." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Team name<input name="name" defaultValue={team.name} autoFocus required /></label><label>Short name<input name="shortName" defaultValue={team.shortName} required /></label><label>Description<textarea name="description" defaultValue={team.description} rows={3} /></label><label>Parent node<select name="parentTeamId" defaultValue={team.parentTeamId ?? ''}>{team.id === 'leadership' && <option value="">Hierarchy root</option>}{workspace.teams.filter((candidate) => candidate.active && candidate.id !== team.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label>Node type<select name="nodeType" defaultValue={team.nodeType}><option value="operational">Operational workspace</option><option value="grouping">Grouping only</option></select></label><div className="form-grid"><label>Meeting cadence<select name="meetingCadence" defaultValue={team.meetingCadence}><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Meeting day / date<input name="meetingDay" defaultValue={team.meetingDay} /></label><label>Meeting time<input name="meetingTime" defaultValue={team.meetingTime} /></label></div><small className="form-help">For monthly meetings, enter a day number (1–31). Change the current occurrence’s exact date from the L10 screen.</small><div className="config-form-section"><span className="section-kicker">L10 STRUCTURE</span><p className="form-help">Turn off sections this team does not need. IDS and Conclude remain enabled so the meeting has a resolution and record.</p><div className="meeting-config-list">{sections.map((section) => { const required = section.id === 'ids' || section.id === 'conclude'; return <div className="meeting-config-row" key={section.id}><label className="checkbox-label"><input name={`section-${section.id}`} type="checkbox" defaultChecked={section.enabled || required} disabled={required} /> <span>{section.label}{required ? ' · required' : ''}</span></label><label className="duration-field">Minutes<input name={`duration-${section.id}`} type="number" min="1" max="180" defaultValue={section.duration} /></label></div>; })}</div></div><div className="config-form-section"><span className="section-kicker">ESCALATION HIERARCHY</span><p className="form-help">Recipients are notified in order when an Issue reaches its escalation point. Leave unused levels blank.</p><div className="escalation-config-list">{[0, 1, 2].map((level) => <label key={level}>Level {level + 1}<select name={`escalation-${level}`} defaultValue={team.escalationUserIds[level] ?? ''}><option value="">No recipient</option>{recipients.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>)}</div></div><ModalActions onClose={onClose} submitLabel="Save team settings" /></form></ModalShell>;
}

function UserModal({ user, onClose, onSubmit }: { user?: User; onClose: () => void; onSubmit: (input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }) => void }) {
  const editing = Boolean(user);
  const title = editing ? 'Edit user profile' : isLocalPocBuild ? 'Create local user profile' : 'Create Entra-linked user';
  const description = editing
    ? isLocalPocBuild ? 'Update this app-owned profile. Team memberships and work history stay unchanged.' : 'Update the profile details. A changed email must still resolve to the same Entra directory identity.'
    : isLocalPocBuild ? 'The local POC stores an app-owned profile for testing.' : 'Enter the user’s Entra sign-in email. Microsoft Graph will resolve the directory object ID and link it to this application profile.';
  return <ModalShell title={title} description={description} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ name: String(form.get('name') ?? '').trim(), email: String(form.get('email') ?? '').trim(), accent: user?.accent ?? '#6787b7', platformAdmin: form.get('platformAdmin') === 'on' }); }}><label>Name<input name="name" autoFocus required defaultValue={user?.name} placeholder="Full name" /></label><label>Email<input name="email" type="email" required defaultValue={user?.email} placeholder="person@example.com" /></label><label className="checkbox-label"><input name="platformAdmin" type="checkbox" defaultChecked={user?.platformCapabilities.includes('PlatformAdmin')} /> Platform Admin capability</label><ModalActions onClose={onClose} submitLabel={editing ? 'Save user' : isLocalPocBuild ? 'Create profile' : 'Create linked profile'} /></form></ModalShell>;
}

export default App;
