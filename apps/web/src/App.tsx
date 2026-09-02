import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, FormEvent, ReactNode } from 'react';
import { workspaceApi, WorkspaceApiError } from './api';
import { initialWorkspace, workspaceToday } from './data';
import { defaultMeetingSections, meetingSectionsFor } from './types';
import type {
  CompanyOverview,
  EnvironmentAccess,
  EnvironmentId,
  EnvironmentSession,
  Issue,
  IssueAgeBand,
  IssueAgeSettings,
  IssueHorizon,
  IssueTransfer,
  MeetingSection,
  Rock,
  RockStatus,
  RockTask,
  RockTaskStatus,
  ScorecardMetric,
  Team,
  TeamMessage,
  MeetingSectionConfig,
  TeamMembership,
  TeamNodeType,
  TeamRole,
  Todo,
  TodoStatus,
  User,
  ViewId,
  Workspace,
} from './types';

const clone = <T,>(value: T): T => structuredClone(value);

const navLabels: Record<ViewId, string> = {
  overview: 'My week', company: 'Company overview', meeting: 'Live L10', rocks: 'Rocks', todos: 'To-Dos', issues: 'Issues', messages: 'Team messages', scorecard: 'Scorecard', admin: 'Admin', profile: 'Profile',
};

const userFor = (workspace: Workspace, id?: string): User => workspace.users.find((user) => user.id === id) ?? {
  id: id ?? 'unassigned', name: 'Unassigned', initials: '?', email: '', accent: '#8b96a8', active: true, platformCapabilities: [], createdAt: '', updatedAt: '',
};

const emptyTeam: Team = { id: 'unassigned', name: 'No team assigned', shortName: 'No team', description: '', parentTeamId: null, nodeType: 'grouping', memberCount: 0, meetingDay: '', meetingTime: '', accent: '#8b96a8', initials: '—', active: false, meetingSections: defaultMeetingSections(), escalationUserIds: [] };
const teamFor = (workspace: Workspace, id?: string | null) => workspace.teams.find((team) => team.id === id) ?? workspace.teams[0] ?? emptyTeam;

const roleFor = (workspace: Workspace, teamId: string) => workspace.memberships.find((membership) => membership.teamId === teamId && membership.userId === workspace.currentUser.id && membership.active)?.role;
const canWrite = (workspace: Workspace, teamId: string) => ['OrgAdmin', 'TeamLead', 'Member'].includes(roleFor(workspace, teamId) ?? '');
const hasCompanyRead = (workspace: Workspace) => Boolean(roleFor(workspace, 'leadership'));
const isPlatformAdmin = (workspace: Workspace) => workspace.currentUser.platformCapabilities.includes('PlatformAdmin') || workspace.memberships.some((membership) => membership.teamId === 'leadership' && membership.userId === workspace.currentUser.id && membership.role === 'OrgAdmin' && membership.active);

function statusLabel(status: string) {
  return ({ 'on-track': 'On track', 'off-track': 'Off track', complete: 'Complete', open: 'Open', done: 'Done', 'not-done': 'Not done', 'in-ids': 'In IDS', solved: 'Solved', 'in-progress': 'In progress' } as Record<string, string>)[status] ?? status;
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

function ageClass(band: IssueAgeBand) {
  return `age-${band}`;
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
  const [secondsLeft, setSecondsLeft] = useState(300);
  const [companyOverview, setCompanyOverview] = useState<CompanyOverview | null>(null);
  const environmentGeneration = useRef(0);

  const accessibleTeams = useMemo(() => {
    const isLeadershipMember = workspace.memberships.some((membership) => membership.teamId === 'leadership' && membership.userId === workspace.currentUser.id && membership.active);
    if (isLeadershipMember) return workspace.teams.filter((team) => team.active);
    const assignedTeamIds = new Set(workspace.memberships.filter((membership) => membership.userId === workspace.currentUser.id && membership.active).map((membership) => membership.teamId));
    return workspace.teams.filter((team) => team.active && assignedTeamIds.has(team.id));
  }, [workspace.currentUser.id, workspace.memberships, workspace.teams]);
  const accessibleTeamId = accessibleTeams.some((team) => team.id === selectedTeamId) ? selectedTeamId : accessibleTeams[0]?.id ?? '';
  const hasWorkspaceAccess = accessibleTeams.length > 0;
  const activeTeam = teamFor(workspace, accessibleTeamId);
  const currentRole = roleFor(workspace, activeTeam.id);
  const readOnly = !hasWorkspaceAccess || !canWrite(workspace, activeTeam.id);
  const teamMeetings = workspace.meetings.filter((meeting) => meeting.teamId === activeTeam.id);
  const currentMeeting = (meetingClosed ? [...teamMeetings].filter((meeting) => meeting.status === 'closed').sort((left, right) => (right.closedAt ?? '').localeCompare(left.closedAt ?? ''))[0] : teamMeetings.find((meeting) => meeting.status !== 'closed')) ?? teamMeetings[0] ?? workspace.meetings[0];
  const activeAgenda = useMemo(() => meetingSectionsFor(activeTeam), [activeTeam]);
  const activeIssues = useMemo(() => hasWorkspaceAccess ? workspace.issues.filter((issue) => issue.teamId === activeTeam.id && issue.assignmentState !== 'redirected') : [], [hasWorkspaceAccess, workspace.issues, activeTeam.id]);
  const activeRocks = useMemo(() => hasWorkspaceAccess ? workspace.rocks.filter((rock) => rock.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.rocks, activeTeam.id]);
  const activeTodos = useMemo(() => hasWorkspaceAccess ? workspace.todos.filter((todo) => todo.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.todos, activeTeam.id]);
  const activeMetrics = useMemo(() => hasWorkspaceAccess ? workspace.metrics.filter((metric) => metric.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.metrics, activeTeam.id]);
  const activeHeadlines = useMemo(() => hasWorkspaceAccess ? workspace.headlines.filter((headline) => headline.teamId === activeTeam.id) : [], [hasWorkspaceAccess, workspace.headlines, activeTeam.id]);
  const pendingForTeam = hasWorkspaceAccess ? workspace.transfers.filter((transfer) => transfer.status === 'pending' && transfer.destinationTeamId === activeTeam.id) : [];
  const pendingFromTeam = hasWorkspaceAccess ? workspace.transfers.filter((transfer) => transfer.status === 'pending' && transfer.sourceTeamId === activeTeam.id) : [];
  const activeMessages = hasWorkspaceAccess ? workspace.messages.filter((message) => message.toTeamId === activeTeam.id || message.fromTeamId === activeTeam.id) : [];
  const unreadNotifications = workspace.notifications.filter((notification) => notification.recipientUserId === workspace.currentUser.id && !notification.readAt);

  useEffect(() => {
    if (accessibleTeamId && selectedTeamId !== accessibleTeamId) setSelectedTeamId(accessibleTeamId);
  }, [accessibleTeamId, selectedTeamId]);

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
    if (!meetingRunning) return undefined;
    const interval = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          setMeetingRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [meetingRunning]);

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
    if (section && !meetingRunning) setSecondsLeft(section.duration * 60);
  }, [activeAgenda, meetingSection, meetingRunning]);

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
    setMeetingSection('segue');
    setSecondsLeft(300);
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
    if (view !== 'meeting') setMeetingClosed(false);
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

  const moveTodoForward = (todo: Todo) => {
    const nextDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    void refresh(workspaceApi.moveTodoForward(todo.id, nextDate, todo.version), todo.carryForwardCount >= 3 ? `${todo.title} became an Issue for IDS.` : `${todo.title} moved to ${formatDate(nextDate)}.`);
  };

  const startIssue = async (issue: Issue) => {
    const saved = await refresh(workspaceApi.startIssue(issue.id), `${issue.title} is ready for IDS.`);
    if (saved) {
      setMeetingSection('ids');
      navigate('meeting');
    }
  };

  const solveIssue = (issue: Issue) => {
    void refresh(workspaceApi.solveIssue(issue.id), 'Issue solved. A follow-up To-Do was added.');
  };

  const flagMetric = (metric: ScorecardMetric) => {
    if (activeIssues.some((issue) => issue.title === `Scorecard: ${metric.label}`)) {
      notify('That metric is already on the Issues list.');
      return;
    }
    void refresh(workspaceApi.addIssue({ title: `Scorecard: ${metric.label}`, detail: `${metric.label} is ${metric.actual} against a target of ${metric.target} ${metric.unit}.`, category: 'Scorecard', teamId: activeTeam.id, raisedById: workspace.currentUser.id, horizon: 'short-term' }), 'Metric added to the Issues list for IDS.');
  };

  const closeMeeting = async (recap: string, rating: number) => {
    const saved = await refresh(workspaceApi.closeMeeting(activeTeam.id, recap, rating), 'Meeting closed. Your recap is saved to history.');
    if (saved) {
      setMeetingRunning(false);
      setMeetingClosed(true);
    }
  };

  const changeTeam = (teamId: string) => {
    if (!accessibleTeams.some((team) => team.id === teamId)) return;
    setSelectedTeamId(teamId);
    setMeetingClosed(false);
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
    if (await refresh(workspaceApi.addIssue({ title, detail: String(form.get('detail') ?? '').trim() || 'Captured from the team workspace for discussion.', category: String(form.get('category') ?? 'General'), horizon: String(form.get('horizon') ?? 'short-term') as IssueHorizon, priority: Number(form.get('priority') ?? 1), teamId: activeTeam.id, raisedById: workspace.currentUser.id, ownerId: String(form.get('ownerId') ?? workspace.currentUser.id) }), 'Issue added to the list.')) setModal(null);
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

  const renderView = () => {
    const common = { workspace, team: activeTeam, readOnly, onNavigate: navigate };
    switch (activeView) {
      case 'company':
        return <CompanyView {...common} overview={companyOverview} />;
      case 'meeting':
        return <MeetingView {...common} agenda={activeAgenda} rocks={activeRocks} todos={activeTodos} issues={activeIssues} metrics={activeMetrics} headlines={activeHeadlines} meeting={currentMeeting} section={meetingSection} secondsLeft={secondsLeft} running={meetingRunning} closed={meetingClosed || currentMeeting.status === 'closed'} pendingTransfers={pendingForTeam} pendingSourceTransfers={pendingFromTeam} onSelectSection={setMeetingSection} onToggleRunning={() => setMeetingRunning((running) => !running)} onUpdateRock={updateRockStatus} onUpdateTodo={updateTodoStatus} onMoveTodo={moveTodoForward} onStartIssue={startIssue} onOpenIssue={(issueId) => setModal({ type: 'issue-detail', issueId, meetingId: currentMeeting.id })} onSolveIssue={solveIssue} onFlagMetric={flagMetric} onAccept={acceptTransfer} onReject={(id) => setModal({ type: 'reject', transferId: id })} onCancel={cancelTransfer} onClose={closeMeeting} />;
      case 'rocks':
        return <RocksView {...common} rocks={activeRocks} onUpdateRock={updateRockStatus} onEditRock={(rockId) => setModal({ type: 'edit-rock', rockId })} onAdd={() => setModal({ type: 'rock' })} onAddTask={(rockId) => setModal({ type: 'task', rockId })} onConvertTask={(taskId) => void refresh(workspaceApi.convertRockTaskToTodo(taskId), 'Task linked to a new To-Do.')} onUpdateTask={(taskId, input) => void refresh(workspaceApi.updateRockTask(taskId, input), 'Rock Task updated.')} />;
      case 'todos':
        return <TodosView {...common} todos={activeTodos} onUpdateTodo={updateTodoStatus} onEditTodo={(todoId) => setModal({ type: 'todo-detail', todoId })} onMoveTodo={moveTodoForward} onAdd={() => setModal({ type: 'todo' })} />;
      case 'issues':
        return <IssuesView {...common} issues={activeIssues} onStartIssue={startIssue} onSolveIssue={solveIssue} onEditIssue={(issueId) => setModal({ type: 'issue-detail', issueId })} onAdd={() => setModal({ type: 'issue' })} onTransfer={(issueId) => setModal({ type: 'transfer', issueId })} />;
      case 'messages':
        return <MessagesView {...common} messages={activeMessages} onCompose={() => setModal({ type: 'message' })} onOpen={(messageId) => { const message = workspace.messages.find((item) => item.id === messageId); if (message?.status === 'unread') void refresh(workspaceApi.markMessageRead(messageId)); setModal({ type: 'message-detail', messageId }); }} onCreateIssue={(messageId) => setModal({ type: 'message-issue', messageId })} />;
      case 'scorecard':
        return <ScorecardView {...common} metrics={activeMetrics} onFlagMetric={flagMetric} />;
      case 'admin':
        return <AdminView workspace={workspace} environmentAccess={environmentAccess} onToggleEnvironmentAccess={updateEnvironmentAccess} onCreateTeam={() => setModal({ type: 'team' })} onCreateUser={() => setModal({ type: 'user' })} onUpdateTeam={(teamId, input) => void refresh(workspaceApi.updateTeam(teamId, input), 'Team settings updated.')} onEditTeam={(teamId) => setModal({ type: 'edit-team', teamId })} onMembership={(input) => void refresh(workspaceApi.upsertMembership(input), 'Team assignment updated.')} onSaveSettings={(settings) => void refresh(workspaceApi.updateAgeSettings(settings), 'Issue aging settings updated.')} />;
      case 'profile':
        return <ProfileView workspace={workspace} onSave={(input) => void refresh(workspaceApi.updateProfile(input), 'Profile updated.')} />;
      case 'overview':
      default:
        return <OverviewView {...common} rocks={activeRocks} todos={activeTodos} issues={activeIssues} metrics={activeMetrics} headlines={activeHeadlines} meeting={currentMeeting} pendingTransfers={pendingForTeam} pendingSourceTransfers={pendingFromTeam} onStartMeeting={() => navigate('meeting')} onUpdateTodo={updateTodoStatus} onUpdateRock={updateRockStatus} onStartIssue={startIssue} onAccept={acceptTransfer} onReject={(id) => setModal({ type: 'reject', transferId: id })} onCancel={cancelTransfer} />;
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
      {modal?.type === 'todo-detail' && <TodoEditModal workspace={workspace} todo={workspace.todos.find((todo) => todo.id === modal.todoId)!} onClose={() => setModal(null)} onSubmit={async (input) => { const todo = workspace.todos.find((item) => item.id === modal.todoId); if (todo && await refresh(workspaceApi.updateTodo(todo.id, input, todo.version), 'To-Do details saved.')) setModal(null); }} onMoveForward={async (dueDate) => { const todo = workspace.todos.find((item) => item.id === modal.todoId); if (todo && await refresh(workspaceApi.moveTodoForward(todo.id, dueDate, todo.version), todo.carryForwardCount >= 3 ? `${todo.title} became an Issue for IDS.` : 'To-Do moved forward.')) setModal(null); }} />}
      {modal?.type === 'issue' && <IssueModal workspace={workspace} onClose={() => setModal(null)} onSubmit={handleCreateIssue} />}
      {modal?.type === 'rock' && <RockModal workspace={workspace} onClose={() => setModal(null)} onSubmit={handleCreateRock} />}
      {modal?.type === 'edit-rock' && <RockEditModal workspace={workspace} rock={workspace.rocks.find((rock) => rock.id === modal.rockId)!} onClose={() => setModal(null)} onSubmit={async (input) => { const rock = workspace.rocks.find((item) => item.id === modal.rockId); if (rock && await refresh(workspaceApi.updateRock(rock.id, input, rock.version), 'Rock details saved.')) setModal(null); }} />}
      {modal?.type === 'issue-detail' && <IssueEditModal workspace={workspace} issue={workspace.issues.find((issue) => issue.id === modal.issueId)!} meetingId={modal.meetingId} onClose={() => setModal(null)} onSubmit={async (input, meetingNote) => { const issue = workspace.issues.find((item) => item.id === modal.issueId); if (!issue) return; try { let next = await workspaceApi.updateIssue(issue.id, input, issue.version); if (meetingNote?.trim() && modal.meetingId) { const updated = next.issues.find((item) => item.id === issue.id); next = await workspaceApi.addMeetingIssueNote(issue.id, modal.meetingId, meetingNote, updated?.version); } setWorkspace(next); notify('Issue details and IDS notes saved.'); setModal(null); } catch (error) { notify(error instanceof WorkspaceApiError ? error.message : 'That Issue update could not be saved.'); } }} />}
      {modal?.type === 'task' && <TaskModal workspace={workspace} rock={workspace.rocks.find((rock) => rock.id === modal.rockId)!} onClose={() => setModal(null)} onSubmit={(event) => handleCreateTask(event, modal.rockId)} />}
      {modal?.type === 'transfer' && <TransferModal workspace={workspace} issue={workspace.issues.find((issue) => issue.id === modal.issueId)!} onClose={() => setModal(null)} onSubmit={async (destination, note) => { const issue = workspace.issues.find((item) => item.id === modal.issueId); if (await refresh(workspaceApi.requestIssueTransfer(modal.issueId, destination, note, issue?.version), 'Issue transfer requested.')) setModal(null); }} />}
      {modal?.type === 'reject' && <RejectModal transfer={workspace.transfers.find((transfer) => transfer.id === modal.transferId)!} issue={workspace.issues.find((issue) => issue.id === workspace.transfers.find((transfer) => transfer.id === modal.transferId)?.issueId)} onClose={() => setModal(null)} onSubmit={async (message) => { const transfer = workspace.transfers.find((item) => item.id === modal.transferId); if (await refresh(workspaceApi.rejectIssueTransfer(modal.transferId, message, transfer?.version), 'Issue returned to the source team unassigned.')) setModal(null); }} />}
      {modal?.type === 'team' && <TeamModal workspace={workspace} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.createTeam(input), 'Team created.')) setModal(null); }} />}
      {modal?.type === 'edit-team' && <TeamEditModal workspace={workspace} team={workspace.teams.find((team) => team.id === modal.teamId)!} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.updateTeam(modal.teamId, input), 'Team settings updated.')) setModal(null); }} />}
      {modal?.type === 'user' && <UserModal onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.createUser(input), 'Local user created.')) setModal(null); }} />}
      {modal?.type === 'message' && <MessageModal workspace={workspace} fromTeam={activeTeam} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.sendTeamMessage(input), 'Message sent to the team.')) setModal(null); }} />}
      {modal?.type === 'message-detail' && <MessageDetailModal workspace={workspace} message={workspace.messages.find((message) => message.id === modal.messageId)!} canCreateIssue={canWrite(workspace, activeTeam.id) && workspace.messages.find((message) => message.id === modal.messageId)?.toTeamId === activeTeam.id} onClose={() => setModal(null)} onCreateIssue={() => setModal({ type: 'message-issue', messageId: modal.messageId })} />}
      {modal?.type === 'message-issue' && <MessageIssueModal workspace={workspace} message={workspace.messages.find((message) => message.id === modal.messageId)!} onClose={() => setModal(null)} onSubmit={async (input) => { if (await refresh(workspaceApi.createIssueFromMessage(modal.messageId, input), 'Issue created from the team message.')) setModal(null); }} />}
    </div>
  );
}

type ModalState =
  | { type: 'todo' }
  | { type: 'todo-detail'; todoId: string }
  | { type: 'issue' }
  | { type: 'issue-detail'; issueId: string; meetingId?: string }
  | { type: 'rock' }
  | { type: 'edit-rock'; rockId: string }
  | { type: 'task'; rockId: string }
  | { type: 'transfer'; issueId: string }
  | { type: 'reject'; transferId: string }
  | { type: 'message' }
  | { type: 'message-detail'; messageId: string }
  | { type: 'message-issue'; messageId: string }
  | { type: 'team' }
  | { type: 'edit-team'; teamId: string }
  | { type: 'user' }
  | null;

function EnvironmentGate({ error }: { error?: string }) {
  return <div className="environment-gate"><div className="environment-gate-card"><span className="section-kicker">AUTHENTICATED WORKSPACE</span><h1>{error ? 'Workspace unavailable' : 'Loading your workspace'}</h1><p>{error ?? 'Checking your environment access and loading the Live workspace.'}</p>{error && <button className="button button-secondary" onClick={() => window.location.reload()}>Try again</button>}</div></div>;
}

function EnvironmentSwitcher({ session, onChange }: { session: EnvironmentSession; onChange: (environment: EnvironmentId) => void }) {
  const selected = session.currentEnvironment === 'test' ? 'Test' : 'Live';
  const showSelect = session.availableEnvironments.length > 1 || session.currentEnvironment === 'test';
  return <div className={`environment-switcher environment-${session.currentEnvironment}`}><span className="environment-badge-dot" /><span className="environment-badge-label">{selected}</span>{showSelect && <label><span className="sr-only">Choose environment</span><select value={session.currentEnvironment} onChange={(event) => onChange(event.target.value as EnvironmentId)}><option value="live">Live</option>{session.availableEnvironments.some((environment) => environment.id === 'test') && <option value="test">Test</option>}</select><span className="select-arrow">⌄</span></label>}</div>;
}

function Sidebar({ workspace, team, activeView, onView, open }: { workspace: Workspace; team: Team; activeView: ViewId; onView: (view: ViewId) => void; open: boolean }) {
  const items: Array<{ id: ViewId; label: string; icon: string; group?: string }> = [
    { id: 'overview', label: 'My week', icon: '⌂' },
    ...(hasCompanyRead(workspace) ? [{ id: 'company' as ViewId, label: 'Company overview', icon: '◎' }] : []),
    { id: 'meeting', label: 'Live L10', icon: '◷' },
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
  const tone = status === 'on-track' || status === 'complete' || status === 'done' || status === 'solved' ? 'positive' : status === 'off-track' || status === 'not-done' || status === 'unassigned' ? 'negative' : status === 'in-ids' || status === 'pending-transfer' ? 'blue' : 'warning';
  return <span className={`status-pill status-${tone}`}><span className="status-dot" />{label ?? statusLabel(status)}</span>;
}

function AgePill({ issue }: { issue: Issue }) {
  const ageProgress = `${Math.min(100, Math.max(0, issue.ageInDays / 30 * 100))}%`;
  return <span className={`age-pill ${ageClass(issue.ageBand)}`} style={{ '--age-progress': ageProgress } as CSSProperties}><span className="age-dot" />{ageLabel(issue)}</span>;
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

function TransferNotice({ workspace, teamId, pendingTransfers, pendingSourceTransfers, editable, onAccept, onReject, onCancel }: { workspace: Workspace; teamId: string; pendingTransfers: IssueTransfer[]; pendingSourceTransfers: IssueTransfer[]; editable: boolean; onAccept: (transferId: string) => void; onReject: (transferId: string) => void; onCancel: (transferId: string) => void }) {
  if (!pendingTransfers.length && !pendingSourceTransfers.length) return null;
  return <section className="transfer-notices"><div className="transfer-notice-heading"><span className="notice-symbol">⇄</span><div><span className="section-kicker">TEAM HANDOFFS</span><h2>Incoming Issues need a decision.</h2></div></div>{pendingTransfers.map((transfer) => { const issue = workspace.issues.find((item) => item.id === transfer.issueId); if (!issue) return null; const source = teamFor(workspace, transfer.sourceTeamId); return <div className="transfer-row" key={transfer.id}><div className="transfer-row-copy"><strong>{issue.title}</strong><span>{source.name} sent this Issue here · {ageLabel(issue)} old</span></div>{editable ? <div className="transfer-row-actions"><Button variant="secondary" onClick={() => onReject(transfer.id)}>Reject</Button><Button onClick={() => onAccept(transfer.id)}>Accept</Button></div> : <span className="read-only-label">Decision restricted to team editors</span>}</div>; })}{pendingSourceTransfers.map((transfer) => { const issue = workspace.issues.find((item) => item.id === transfer.issueId); if (!issue) return null; const destination = teamFor(workspace, transfer.destinationTeamId); return <div className="transfer-row transfer-row-pending" key={transfer.id}><div className="transfer-row-copy"><strong>Waiting for {destination.name}</strong><span>{issue.title} · sent {formatDate(transfer.requestedAt)}</span></div>{editable && <Button variant="quiet" onClick={() => onCancel(transfer.id)}>Cancel transfer</Button>}</div>; })}<small className="notice-footnote">{pendingTransfers.length ? editable ? 'Any team editor can decide. The first decision wins.' : 'A TeamLead or Member must decide. You can review the request.' : `The Issue remains in ${teamFor(workspace, teamId).name} until the destination responds.`}</small></section>;
}

function OverviewView({ workspace, team, readOnly, rocks, todos, issues, metrics, headlines, meeting, pendingTransfers, pendingSourceTransfers, onStartMeeting, onUpdateTodo, onUpdateRock, onStartIssue, onAccept, onReject, onCancel, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; rocks: Rock[]; todos: Todo[]; issues: Issue[]; metrics: ScorecardMetric[]; headlines: Workspace['headlines']; meeting: Workspace['meetings'][number]; pendingTransfers: IssueTransfer[]; pendingSourceTransfers: IssueTransfer[]; onStartMeeting: () => void; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onUpdateRock: (rock: Rock) => void; onStartIssue: (issue: Issue) => void; onAccept: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void; onNavigate: (view: ViewId) => void }) {
  const mine = todos.filter((todo) => todo.ownerId === workspace.currentUser.id);
  const openMine = mine.filter((todo) => todo.status !== 'done');
  const activeIssues = issues.filter((issue) => issue.status !== 'solved');
  const onTrackRocks = rocks.filter((rock) => rock.status !== 'off-track').length;
  const completedTodos = todos.filter((todo) => todo.status === 'done').length;
  const offTrackMetrics = metrics.filter((metric) => metric.status === 'off-track').length;
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · ${workspace.quarter.label}`} title={`Good morning, ${workspace.currentUser.name.split(' ')[0]}.`} description={readOnly ? 'Review the team pulse and company context. Editing is limited to your assigned teams.' : 'Here’s what needs your attention before the team meets.'} actions={<><Button variant="secondary" onClick={() => onNavigate('issues')}>Review Issues ↗</Button><Button onClick={onStartMeeting}>Start L10 →</Button></>} /><TransferNotice workspace={workspace} teamId={team.id} pendingTransfers={pendingTransfers} pendingSourceTransfers={pendingSourceTransfers} editable={!readOnly} onAccept={onAccept} onReject={onReject} onCancel={onCancel} /><section className="overview-top-grid"><article className="quarter-hero card-surface"><div className="hero-content"><span className="eyebrow eyebrow-light">{workspace.quarter.label} · OPERATING RHYTHM</span><h2>{workspace.quarter.theme}</h2><p>One quarter. Fewer priorities. More traction.</p><div className="hero-progress"><div className="progress-label"><span>Quarter progress</span><strong>67%</strong></div><ProgressBar value={67} /></div><div className="hero-foot"><span><span className="live-dot" /> {workspace.quarter.daysRemaining} days remaining</span><span>{formatDate(workspace.quarter.startDate)} — {formatDate(workspace.quarter.endDate)}</span></div></div><div className="hero-rings" aria-hidden="true"><span /><span /><span /></div></article><article className="next-meeting-card card-surface"><div className="card-topline"><span className="card-kicker"><span className="meeting-live-dot" /> NEXT MEETING</span><span className="card-menu">•••</span></div><h3>{meeting.label}</h3><div className="meeting-time"><span className="calendar-icon">▣</span><div><strong>{meeting.dateLabel}</strong><span>{team.memberCount} people · 90 minutes</span></div></div><div className="meeting-card-footer"><AvatarStack workspace={workspace} ids={meeting.attendeeIds} /><Button variant="quiet" onClick={onStartMeeting}>Open agenda →</Button></div></article></section><section className="stat-grid"><button className="stat-card card-surface" onClick={() => onNavigate('rocks')}><div className="stat-card-head"><span className="stat-icon stat-icon-brand">◇</span><span className="stat-trend positive-text">Quarter</span></div><strong className="stat-number">{onTrackRocks}<small>/{rocks.length}</small></strong><span className="stat-label">Rocks on track</span><ProgressBar value={rocks.length ? onTrackRocks / rocks.length * 100 : 0} /></button><button className="stat-card card-surface" onClick={() => onNavigate('todos')}><div className="stat-card-head"><span className="stat-icon stat-icon-teal">✓</span><span className="stat-trend positive-text">Weekly</span></div><strong className="stat-number">{completedTodos}<small>/{todos.length}</small></strong><span className="stat-label">To-Dos complete</span><ProgressBar value={todos.length ? completedTodos / todos.length * 100 : 0} tone="teal" /></button><button className="stat-card card-surface" onClick={() => onNavigate('issues')}><div className="stat-card-head"><span className="stat-icon stat-icon-lavender">!</span><span className="stat-trend warning-text">{offTrackMetrics ? `${offTrackMetrics} scorecard flag` : 'All metrics clear'}</span></div><strong className="stat-number">{activeIssues.length}<small> active</small></strong><span className="stat-label">Issues to solve</span><div className="issue-dots"><span /><span /><span /><span className="dot-muted" /></div></button></section><section className="content-grid"><div className="main-column"><SectionHeading kicker="ACCOUNTABILITY" title="Your week" action="View all To-Dos →" onClick={() => onNavigate('todos')} /><div className="commitment-card card-surface"><div className="commitment-card-head"><div><h3>My commitments</h3><p>{openMine.length} open items need your attention</p></div><span className="completion-ring"><strong>{mine.filter((todo) => todo.status === 'done').length}</strong><small>/ {mine.length}</small></span></div><div className="todo-list">{openMine.slice(0, 4).map((todo) => <TodoRow key={todo.id} workspace={workspace} todo={todo} readOnly={readOnly} onToggle={() => onUpdateTodo(todo)} />)}{openMine.length === 0 && <EmptyState title="A clear week" detail={mine.length ? 'All your visible To-Dos are complete.' : 'You have no open To-Dos assigned to you.'} />}</div></div><SectionHeading kicker="QUARTERLY PRIORITIES" title="Rocks to watch" action="Open Rock sheet →" onClick={() => onNavigate('rocks')} /><div className="rocks-watch-card card-surface">{rocks.filter((rock) => rock.status !== 'complete').slice(0, 3).map((rock) => <RockRow key={rock.id} workspace={workspace} rock={rock} readOnly={readOnly} onUpdate={() => onUpdateRock(rock)} />)}</div></div><div className="side-column"><SectionHeading kicker="TEAM PULSE" title="At a glance" /><div className="pulse-card card-surface"><div className="pulse-score"><span className="pulse-score-number">{meeting.lastRating.toFixed(1)}</span><span className="pulse-score-label">last meeting rating</span><span className="pulse-score-trend">Team rhythm</span></div><div className="pulse-bars"><PulseBar label="Rocks" value={onTrackRocks / Math.max(1, rocks.length) * 100} /><PulseBar label="To-Dos" value={completedTodos / Math.max(1, todos.length) * 100} color="teal" /><PulseBar label="Scorecard" value={(metrics.length - offTrackMetrics) / Math.max(1, metrics.length) * 100} color="lavender" /></div><div className="pulse-footer"><span><span className="pulse-check">✓</span> {readOnly ? 'Company visibility active' : 'Team is preparing'}</span></div></div><SectionHeading kicker="IDS QUEUE" title="Top Issues" action="See all →" onClick={() => onNavigate('issues')} /><div className="issues-preview card-surface">{activeIssues.filter((issue) => issue.horizon === 'short-term').slice(0, 3).map((issue) => <IssuePreview key={issue.id} workspace={workspace} issue={issue} readOnly={readOnly} onClick={() => onStartIssue(issue)} />)}{activeIssues.filter((issue) => issue.horizon === 'short-term').length === 0 && <EmptyState title="No short-term Issues" detail="The weekly IDS queue is clear." />}</div>{headlines[0] && <div className="headline-card"><div className="headline-accent" /><div><span className="section-kicker">LATEST HEADLINE</span><h3>{headlines[0].title}</h3><p>{headlines[0].detail}</p><span className="headline-author"><Avatar user={userFor(workspace, headlines[0].authorId)} size="sm" /> {userFor(workspace, headlines[0].authorId).name}</span></div></div>}</div></section></>;
}

function SectionHeading({ kicker, title, action, onClick }: { kicker: string; title: string; action?: string; onClick?: () => void }) {
  return <div className="section-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>{action && <button className="text-button" onClick={onClick}>{action}</button>}</div>;
}

function TodoRow({ workspace, todo, readOnly = false, onToggle }: { workspace: Workspace; todo: Todo; readOnly?: boolean; onToggle: () => void }) {
  return <div className={`todo-row ${todo.status === 'done' ? 'todo-done' : ''}`}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={onToggle} disabled={readOnly} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><div className="todo-row-copy"><strong>{todo.title}</strong><span>{todo.origin}</span></div><div className="todo-row-meta"><Avatar user={userFor(workspace, todo.ownerId)} size="sm" /><span className={todo.status === 'not-done' ? 'due-overdue' : ''}>{formatDate(todo.dueDate)}</span></div></div>;
}

function RockRow({ workspace, rock, readOnly = false, onUpdate }: { workspace: Workspace; rock: Rock; readOnly?: boolean; onUpdate: () => void }) {
  return <div className="rock-row"><div className="rock-row-main"><div className="rock-title-line"><span className={`priority-marker priority-${rock.priority}`} /><strong>{rock.title}</strong><StatusPill status={rock.status} /></div><div className="rock-row-progress"><ProgressBar value={rock.progress} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{rock.progress}% · {rock.tasks.filter((task) => task.status === 'done').length}/{rock.tasks.length} Tasks</span></div></div><div className="rock-row-owner"><Avatar user={userFor(workspace, rock.ownerId)} size="sm" /><span>{userFor(workspace, rock.ownerId).name.split(' ')[0]}</span><button className="row-action" onClick={onUpdate} disabled={readOnly}>{rock.status === 'off-track' ? 'Recover' : 'Update'} →</button></div></div>;
}

function PulseBar({ label, value, color = 'brand' }: { label: string; value: number; color?: 'brand' | 'coral' | 'teal' | 'lavender' }) {
  return <div className="pulse-bar"><div><span>{label}</span><strong>{Math.round(value)}%</strong></div><ProgressBar value={value} tone={color} /></div>;
}

function IssuePreview({ workspace, issue, readOnly = false, onClick }: { workspace: Workspace; issue: Issue; readOnly?: boolean; onClick: () => void }) {
  return <button className="issue-preview-row" onClick={onClick} disabled={readOnly}><span className="issue-number">{issue.priority}</span><span className="issue-preview-copy"><strong>{issue.title}</strong><span><AgePill issue={issue} /> · {issue.category}</span></span><span className="issue-chevron">›</span></button>;
}

function CompanyView({ workspace, overview, onNavigate }: { workspace: Workspace; overview: CompanyOverview | null; onNavigate: (view: ViewId) => void }) {
  const [teamFilter, setTeamFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ageFilter, setAgeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  if (!overview) return <><PageHeader eyebrow="COMPANY · READ ONLY" title="Loading company overview." description="Preparing the cross-team operating picture." /><div className="loading-card card-surface">Loading the Leadership view…</div></>;
  const filteredIssues = overview.issues.filter((issue) => (teamFilter === 'all' || issue.teamId === teamFilter) && (ownerFilter === 'all' || issue.ownerId === ownerFilter) && (statusFilter === 'all' || issueStatusClass(issue) === statusFilter) && (ageFilter === 'all' || issue.ageBand === ageFilter) && (priorityFilter === 'all' || String(issue.priority) === priorityFilter));
  const selectedTeam = selectedTeamId ? teamFor(workspace, selectedTeamId) : null;
  const selectedItems = selectedTeamId ? { issues: overview.issues.filter((issue) => issue.teamId === selectedTeamId), rocks: overview.rocks.filter((rock) => rock.teamId === selectedTeamId), todos: overview.todos.filter((todo) => todo.teamId === selectedTeamId) } : null;
  return <><PageHeader eyebrow="LEADERSHIP · COMPANY VISIBILITY" title="See the whole operating system." description="Read-only rollups across every operational team, with direct-team and descendant totals kept separate." actions={<Button variant="secondary" onClick={() => onNavigate('issues')}>Open current team Issues →</Button>} /><div className="company-hero card-surface"><div><span className="section-kicker">COMPANY OVERVIEW</span><h2>{overview.issues.filter((issue) => issue.status !== 'solved').length} active Issues across {workspace.teams.length} workspaces.</h2><p>Use age and status to see where a conversation needs to happen before the next L10.</p></div><div className="company-orbit"><strong>{overview.rocks.filter((rock) => rock.status !== 'off-track').length}</strong><span>Rocks on track</span></div></div><div className="company-rollup-grid">{workspace.teams.map((team) => { const rollup = overview.teams.find((item) => item.teamId === team.id); if (!rollup) return null; return <button key={team.id} className={`company-team-card card-surface ${selectedTeamId === team.id ? 'company-team-selected' : ''}`} onClick={() => setSelectedTeamId(team.id)}><div className="company-team-top"><span className="team-mark" style={{ backgroundColor: team.accent }}>{team.initials}</span><span className="node-type">{team.nodeType}</span></div><strong>{team.name}</strong><small>{teamPath(workspace, team.id)}</small><div className="company-team-stats"><span><b>{rollup.direct.issues.total}</b> direct Issues</span><span><b>{rollup.descendants.issues}</b> child Issues</span><span><b>{rollup.direct.rocks.offTrack}</b> off-track Rocks</span></div></button>; })}</div><div className="company-workbench card-surface"><div className="company-filters"><label>Team<select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}><option value="all">All teams</option>{workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Owner<select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">All owners</option>{workspace.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="in-ids">In IDS</option><option value="unassigned">Unassigned</option><option value="solved">Solved</option></select></label><label>Age<select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}><option value="all">Any age</option><option value="fresh">Fresh</option><option value="aging">Aging</option><option value="stale">Stale</option><option value="critical">Critical</option></select></label><label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">Any priority</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label></div><div className="company-table-head"><div><span className="section-kicker">ISSUE HEALTH</span><h2>Company Issues</h2></div><span>{filteredIssues.length} visible</span></div><div className="company-table">{filteredIssues.map((issue) => <div className="company-table-row" key={`${issue.teamId}-${issue.id}`}><span className="issue-number">{issue.priority}</span><div><strong>{issue.title}</strong><small>{teamPath(workspace, issue.teamId)} · {issue.horizon === 'short-term' ? 'Short-term' : 'Long-term'}</small></div><span><Avatar user={userFor(workspace, issue.ownerId)} size="sm" />{userFor(workspace, issue.ownerId).name}</span><AgePill issue={issue} /><StatusPill status={issueStatusClass(issue)} /></div>)}{filteredIssues.length === 0 && <EmptyState title="No Issues match these filters" detail="Try widening the status, owner, or age selection." />}</div></div>{selectedItems && selectedTeam && <div className="detail-drawer card-surface"><div className="detail-drawer-head"><div><span className="section-kicker">READ-ONLY TEAM DETAIL</span><h2>{selectedTeam.name}</h2><p>{teamPath(workspace, selectedTeam.id)}</p></div><button className="icon-button" onClick={() => setSelectedTeamId(null)} aria-label="Close detail">×</button></div><div className="detail-drawer-grid"><div><strong>{selectedItems.issues.length}</strong><span>Issues</span></div><div><strong>{selectedItems.rocks.length}</strong><span>Rocks</span></div><div><strong>{selectedItems.todos.length}</strong><span>To-Dos</span></div></div><div className="drawer-list">{selectedItems.issues.slice(0, 5).map((issue) => <div key={issue.id}><span>{issue.title}</span><AgePill issue={issue} /></div>)}</div></div>}</>;
}

function MeetingView({ workspace, team, readOnly, agenda, rocks, todos, issues, metrics, headlines, meeting, section, secondsLeft, running, closed, pendingTransfers, pendingSourceTransfers, onSelectSection, onToggleRunning, onUpdateRock, onUpdateTodo, onMoveTodo, onOpenIssue, onStartIssue, onSolveIssue, onFlagMetric, onAccept, onReject, onCancel, onClose, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; agenda: MeetingSectionConfig[]; rocks: Rock[]; todos: Todo[]; issues: Issue[]; metrics: ScorecardMetric[]; headlines: Workspace['headlines']; meeting: Workspace['meetings'][number]; section: MeetingSection; secondsLeft: number; running: boolean; closed: boolean; pendingTransfers: IssueTransfer[]; pendingSourceTransfers: IssueTransfer[]; onSelectSection: (section: MeetingSection) => void; onToggleRunning: () => void; onUpdateRock: (rock: Rock) => void; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onMoveTodo: (todo: Todo) => void; onOpenIssue: (issueId: string) => void; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onFlagMetric: (metric: ScorecardMetric) => void; onAccept: (id: string) => void; onReject: (id: string) => void; onCancel: (id: string) => void; onClose: (recap: string, rating: number) => void; onNavigate: (view: ViewId) => void }) {
  const [recap, setRecap] = useState(meeting.recap);
  const [rating, setRating] = useState(meeting.lastRating || 8);
  const currentIndex = Math.max(0, agenda.findIndex((item) => item.id === section));
  const shortIssues = issues.filter((issue) => issue.horizon === 'short-term' && issue.status !== 'solved');
  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');
  const next = () => onSelectSection(agenda[Math.min(agenda.length - 1, currentIndex + 1)].id);
  return <><div className="meeting-page-header"><div><span className="eyebrow">{team.name.toUpperCase()} · {workspace.quarter.label}</span><h1>{closed ? 'Meeting complete.' : 'Run the room.'}</h1><p>{closed ? 'The meeting record is saved. The team can now execute the recap.' : 'Keep the reporting crisp. Put the real work where it belongs: IDS.'}</p></div><div className="meeting-header-actions"><div className={`meeting-status ${closed ? 'meeting-status-closed' : ''}`}><span className="meeting-status-dot" />{closed ? 'Closed' : running ? 'In progress' : 'Ready to start'}</div><Button variant="secondary" onClick={() => onNavigate('overview')}>Exit meeting</Button></div></div><TransferNotice workspace={workspace} teamId={team.id} pendingTransfers={pendingTransfers} pendingSourceTransfers={pendingSourceTransfers} editable={!readOnly} onAccept={onAccept} onReject={onReject} onCancel={onCancel} /><div className="meeting-workspace"><aside className="agenda-rail card-surface"><div className="agenda-rail-head"><div><span className="section-kicker">WEEKLY RHYTHM</span><h2>{meeting.label}</h2></div><span className="agenda-date">{meeting.dateLabel}</span></div><div className="agenda-list">{agenda.map((item, index) => <button key={item.id} className={`agenda-item ${item.id === section ? 'agenda-item-active' : ''} ${index < currentIndex || closed ? 'agenda-item-done' : ''}`} onClick={() => onSelectSection(item.id)}><span className="agenda-index">{index < currentIndex || closed ? '✓' : String(index + 1).padStart(2, '0')}</span><span className="agenda-item-copy"><strong>{item.label}</strong><small>{item.duration} min</small></span></button>)}</div><div className="agenda-rail-bottom"><span className="section-kicker">ATTENDEES</span><div className="attendee-line"><AvatarStack workspace={workspace} ids={meeting.attendeeIds} /><span>{meeting.attendeeIds.length} people invited</span></div></div></aside><section className="meeting-stage card-surface"><div className="meeting-stage-toolbar"><div className="stage-location"><span className="stage-number">{currentIndex + 1}</span><div><span className="section-kicker">NOW IN</span><strong>{agenda[currentIndex]?.label}</strong></div></div><div className="meeting-timer"><span className="timer-label">TIME BOX</span><strong className={secondsLeft < 60 ? 'timer-warning' : ''}>{minutes}:{seconds}</strong><button className={`timer-toggle ${running ? 'timer-pause' : ''}`} onClick={onToggleRunning} aria-label={running ? 'Pause timer' : 'Start timer'}>{running ? 'Ⅱ' : '▶'}</button></div></div><div className="meeting-stage-body"><MeetingSectionContent section={section} workspace={workspace} team={team} rocks={rocks} todos={todos} issues={shortIssues} metrics={metrics} headlines={headlines} recap={recap} setRecap={setRecap} rating={rating} setRating={setRating} readOnly={readOnly} onUpdateRock={onUpdateRock} onUpdateTodo={onUpdateTodo} onMoveTodo={onMoveTodo} onOpenIssue={onOpenIssue} onStartIssue={onStartIssue} onSolveIssue={onSolveIssue} onFlagMetric={onFlagMetric} /></div><div className="meeting-stage-footer"><button className="footer-nav-button" onClick={() => onSelectSection(agenda[Math.max(0, currentIndex - 1)].id)} disabled={currentIndex === 0}>← Previous</button><div className="footer-progress"><ProgressBar value={(currentIndex + 1) / agenda.length * 100} /><span>{currentIndex + 1} of {agenda.length}</span></div>{section === 'conclude' && !closed ? <Button onClick={() => onClose(recap, rating)} disabled={readOnly}>Close meeting ✓</Button> : <button className="footer-nav-button footer-nav-next" onClick={next} disabled={currentIndex === agenda.length - 1}>Next section →</button>}</div></section></div></>;
}

function MeetingSectionContent({ section, workspace, team, rocks, todos, issues, metrics, headlines, recap, setRecap, rating, setRating, readOnly, onUpdateRock, onUpdateTodo, onMoveTodo, onOpenIssue, onStartIssue, onSolveIssue, onFlagMetric }: { section: MeetingSection; workspace: Workspace; team: Team; rocks: Rock[]; todos: Todo[]; issues: Issue[]; metrics: ScorecardMetric[]; headlines: Workspace['headlines']; recap: string; setRecap: (value: string) => void; rating: number; setRating: (value: number) => void; readOnly: boolean; onUpdateRock: (rock: Rock) => void; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onMoveTodo: (todo: Todo) => void; onOpenIssue: (issueId: string) => void; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onFlagMetric: (metric: ScorecardMetric) => void }) {
  if (section === 'segue') return <div className="meeting-intro"><span className="intro-orbit">✦</span><span className="section-kicker">SEGUE · 5 MINUTES</span><h2>Leave the noise at the door.</h2><p>Each person shares a personal and professional best from the week. Be present, be brief, and get the room ready to solve.</p><div className="check-in-grid"><div><span>01</span><strong>Personal best</strong><small>What gave you energy?</small></div><div><span>02</span><strong>Professional best</strong><small>What moved the work?</small></div><div><span>03</span><strong>Room check</strong><small>What needs our focus?</small></div></div></div>;
  if (section === 'scorecard') return <div className="meeting-section-content"><SectionIntro kicker="SCORECARD · 5 MINUTES" title="Report the number, not the story." description="Call out anything off track. If it needs discussion, add it to IDS." /><div className="meeting-metric-table">{metrics.map((metric) => <div className="metric-row" key={metric.id}><div className="metric-name"><span className={`metric-status-dot metric-${metric.status}`} /><strong>{metric.label}</strong><small><Avatar user={userFor(workspace, metric.ownerId)} size="sm" />{userFor(workspace, metric.ownerId).name}</small></div><div className="metric-values"><span>Target <b>{metric.target}</b> {metric.unit}</span><span>Actual <b>{metric.actual}</b> {metric.unit}</span></div><StatusPill status={metric.status} />{metric.status === 'off-track' && !readOnly && <button className="row-action row-action-small" onClick={() => onFlagMetric(metric)}>Add to IDS</button>}</div>)}</div></div>;
  if (section === 'rock-review') return <div className="meeting-section-content"><SectionIntro kicker="ROCK REVIEW · 5 MINUTES" title="Are we on track?" description="Every Rock gets a clear status. Off-track Rocks can become Issues." /><div className="meeting-rock-list">{rocks.map((rock) => <div className="meeting-rock-row" key={rock.id}><div className="meeting-rock-info"><strong>{rock.title}</strong><span><Avatar user={userFor(workspace, rock.ownerId)} size="sm" />{userFor(workspace, rock.ownerId).name} · due {formatDate(rock.dueDate)}</span></div><div className="meeting-rock-progress"><ProgressBar value={rock.progress} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{rock.progress}%</span></div><button className={`quick-status-button ${rock.status}`} onClick={() => onUpdateRock(rock)} disabled={readOnly}><span className="status-dot" />{statusLabel(rock.status)}</button></div>)}</div></div>;
  if (section === 'headlines') return <div className="meeting-section-content"><SectionIntro kicker="CUSTOMER & EMPLOYEE HEADLINES · 5 MINUTES" title="Share what changed." description="Wins, concerns, and context help the team see the whole picture before IDS." /><div className="headline-meeting-grid">{headlines.map((headline) => <article className="headline-meeting-card" key={headline.id}><div className="headline-card-label"><span>{headline.type === 'win' ? '↗' : '!'}</span>{headline.type === 'win' ? 'Win' : 'Concern'}<span className="headline-time">{formatDate(headline.createdAt)}</span></div><h3>{headline.title}</h3><p>{headline.detail}</p><span className="headline-author"><Avatar user={userFor(workspace, headline.authorId)} size="sm" />{userFor(workspace, headline.authorId).name}</span></article>)}</div></div>;
  if (section === 'todo-review') return <div className="meeting-section-content"><SectionIntro kicker="TO-DO REVIEW · 5 MINUTES" title="Did we do what we said?" description="Mark commitments done or not done. A recurring miss is an Issue, not a secret." /><div className="meeting-todo-table">{todos.map((todo) => <div className="meeting-todo-row" key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdateTodo(todo)} disabled={readOnly}>{todo.status === 'done' ? '✓' : ''}</button><div className="meeting-todo-copy"><strong>{todo.title}</strong><span><Avatar user={userFor(workspace, todo.ownerId)} size="sm" />{userFor(workspace, todo.ownerId).name} · due {formatDate(todo.dueDate)} · moved {todo.carryForwardCount}×</span></div><StatusPill status={todo.flagged ? 'not-done' : todo.status} label={todo.flagged ? 'Flagged' : undefined} />{todo.status !== 'done' && !readOnly && <button className="row-action row-action-small" onClick={() => onMoveTodo(todo)}>Move forward</button>}</div>)}</div></div>;
  if (section === 'ids') return <div className="meeting-section-content"><SectionIntro kicker="IDS · 60 MINUTES" title="Solve the real issue." description={`There are ${issues.length} short-term Issues in this team's queue. Identify, discuss, and solve the highest-value problem.`} /><div className="ids-meeting-list">{issues.map((issue) => <div className="ids-meeting-row" key={issue.id}><span className="issue-number">{issue.priority}</span><button className="ids-meeting-copy" onClick={() => onOpenIssue(issue.id)}><strong>{issue.title}</strong><small><AgePill issue={issue} /> · {issue.category} · {issue.meetingsPassed} meetings passed</small></button><div className="ids-meeting-actions"><Button variant="quiet" onClick={() => onOpenIssue(issue.id)}>Open issue</Button>{issue.status !== 'in-ids' && <Button variant="secondary" onClick={() => onStartIssue(issue)} disabled={readOnly}>Start IDS</Button>}{issue.status !== 'solved' && <Button onClick={() => onSolveIssue(issue)} disabled={readOnly}>Solve ✓</Button>}</div></div>)}{issues.length === 0 && <EmptyState title="The IDS queue is clear" detail="Capture an Issue from the workspace when the next one appears." />}</div></div>;
  if (section === 'conclude') return <div className="meeting-section-content conclude-content"><span className="conclude-symbol">✓</span><span className="section-kicker">CONCLUDE · 5 MINUTES</span><h2>Leave with clarity.</h2><p>Recap the decisions, confirm every To-Do has an owner and due date, and rate the meeting.</p><label className="recap-field">Final recap<textarea value={recap} onChange={(event) => setRecap(event.target.value)} placeholder="What did the team decide?" rows={4} disabled={readOnly} /></label><div className="rating-field"><span className="section-kicker">MEETING RATING</span><div className="rating-options">{[6, 7, 8, 9, 10].map((value) => <button key={value} className={rating === value ? 'rating-selected' : ''} onClick={() => setRating(value)} disabled={readOnly}>{value}</button>)}</div></div></div>;
  return <div className="meeting-intro"><span className="intro-orbit">✦</span><span className="section-kicker">{team.name.toUpperCase()} L10</span><h2>Start with the room.</h2><p>The weekly rhythm gives the team a shared place to report, solve, and commit.</p></div>;
}

function SectionIntro({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <div className="section-intro-row"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div></div>;
}

function RocksView({ workspace, team, readOnly, rocks, onUpdateRock, onEditRock, onAdd, onAddTask, onConvertTask, onUpdateTask, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; rocks: Rock[]; onUpdateRock: (rock: Rock) => void; onEditRock: (rockId: string) => void; onAdd: () => void; onAddTask: (rockId: string) => void; onConvertTask: (taskId: string) => void; onUpdateTask: (taskId: string, input: Partial<Pick<RockTask, 'status'>>) => void; onNavigate: (view: ViewId) => void }) {
  const [expandedId, setExpandedId] = useState<string | undefined>(rocks[0]?.id);
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · QUARTERLY PRIORITIES`} title="Make the important work visible." description="Rocks are quarterly outcomes. Expand one to see the accountable owner, notes, and the Tasks that move it forward." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Use in L10</Button>{!readOnly && <Button onClick={onAdd}>Add Rock ＋</Button>}</>} /><div className="rocks-summary-strip card-surface"><div><span className="section-kicker">TOTAL ROCKS</span><strong>{rocks.length}</strong><span>this quarter</span></div><div><span className="section-kicker">ON TRACK</span><strong className="positive-text">{rocks.filter((rock) => rock.status === 'on-track').length}</strong><span>with a clear path</span></div><div><span className="section-kicker">ATTENTION</span><strong className="negative-text">{rocks.filter((rock) => rock.status === 'off-track').length}</strong><span>need a conversation</span></div><div className="rocks-summary-progress"><div className="progress-label"><span>Average progress</span><strong>{Math.round(rocks.reduce((sum, rock) => sum + rock.progress, 0) / Math.max(1, rocks.length))}%</strong></div><ProgressBar value={rocks.reduce((sum, rock) => sum + rock.progress, 0) / Math.max(1, rocks.length)} /></div></div><div className="rock-sheet-list">{rocks.map((rock, index) => <RockCard key={rock.id} workspace={workspace} rock={rock} index={index} expanded={expandedId === rock.id} readOnly={readOnly} onToggle={() => setExpandedId(expandedId === rock.id ? undefined : rock.id)} onEdit={() => onEditRock(rock.id)} onUpdateStatus={() => onUpdateRock(rock)} onAddTask={() => onAddTask(rock.id)} onConvertTask={onConvertTask} onUpdateTask={onUpdateTask} />)}{rocks.length === 0 && <EmptyState title="No Rocks yet" detail="Create the first quarterly priority for this team." />}</div></>;
}

function RockCard({ workspace, rock, index, expanded, readOnly, onToggle, onEdit, onUpdateStatus, onAddTask, onConvertTask, onUpdateTask }: { workspace: Workspace; rock: Rock; index: number; expanded: boolean; readOnly: boolean; onToggle: () => void; onEdit: () => void; onUpdateStatus: () => void; onAddTask: () => void; onConvertTask: (taskId: string) => void; onUpdateTask: (taskId: string, input: Partial<Pick<RockTask, 'status'>>) => void }) {
  return <article className={`rock-card card-surface ${rock.status === 'off-track' ? 'rock-card-alert' : ''} ${expanded ? 'rock-card-expanded' : ''}`}><button className="rock-card-toggle" onClick={onToggle} aria-expanded={expanded}><span className="rock-card-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{rock.title}</h2><p>{rock.description}</p></div><StatusPill status={rock.status} /><span className="expand-chevron">{expanded ? '⌃' : '⌄'}</span></button><div className="rock-card-progress"><div className="progress-label"><span>Progress</span><strong>{rock.progress}%</strong></div><ProgressBar value={rock.progress} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><div className="rock-card-milestones"><span>{rock.tasks.filter((task) => task.status === 'done').length} of {rock.tasks.length} Tasks complete</span><span>Due {formatDate(rock.dueDate)}</span></div></div><div className="rock-card-footer"><span><Avatar user={userFor(workspace, rock.ownerId)} size="sm" /> <strong>{userFor(workspace, rock.ownerId).name}</strong></span><div className="rock-card-actions">{!readOnly && <button className="row-action" onClick={onEdit}>Edit details</button>}<button className="row-action" onClick={onUpdateStatus} disabled={readOnly}>{rock.status === 'off-track' ? 'Mark on track' : rock.status === 'complete' ? 'Reopen' : 'Update status'} →</button></div></div>{expanded && <div className="rock-detail"><div className="rock-detail-notes"><div className="rock-detail-notes-head"><span className="section-kicker">ROCK NOTES</span>{!readOnly && <button className="row-action" onClick={onEdit}>Edit notes</button>}</div><p>{rock.notes || 'No notes added yet.'}</p></div><div className="task-header"><div><span className="section-kicker">TASKS / MILESTONES</span><h3>Steps toward the outcome</h3></div>{!readOnly && <Button variant="secondary" onClick={onAddTask}>Add Task ＋</Button>}</div><div className="task-list">{rock.tasks.map((task) => <TaskRow key={task.id} workspace={workspace} task={task} readOnly={readOnly} onConvert={() => onConvertTask(task.id)} onToggle={() => onUpdateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' })} />)}{rock.tasks.length === 0 && <EmptyState title="No Tasks yet" detail="Break this Rock into a small number of dated steps." />}</div></div>}</article>;
}

function TaskRow({ workspace, task, readOnly, onConvert, onToggle }: { workspace: Workspace; task: RockTask; readOnly: boolean; onConvert: () => void; onToggle: () => void }) {
  return <div className={`task-row ${task.status === 'done' ? 'task-done' : ''}`}><button className={`todo-checkbox ${task.status === 'done' ? 'checked' : ''}`} onClick={onToggle} disabled={readOnly} aria-label={`Mark ${task.title} ${task.status === 'done' ? 'open' : 'done'}`}>{task.status === 'done' ? '✓' : ''}</button><div className="task-copy"><strong>{task.title}</strong><p>{task.notes || 'No task notes.'}</p><small><Avatar user={userFor(workspace, task.assigneeId)} size="sm" />{userFor(workspace, task.assigneeId).name} · assigned {formatDate(task.assignedAt)} · due {formatDate(task.dueDate)}</small></div>{task.linkedTodoId ? <span className="linked-chip">Linked To-Do</span> : !readOnly && <button className="row-action" onClick={onConvert}>Make To-Do →</button>}</div>;
}

function TodosView({ workspace, team, readOnly, todos, onUpdateTodo, onEditTodo, onMoveTodo, onAdd, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; todos: Todo[]; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onEditTodo: (todoId: string) => void; onMoveTodo: (todo: Todo) => void; onAdd: () => void; onNavigate: (view: ViewId) => void }) {
  const [filter, setFilter] = useState<'all' | 'open' | 'mine'>('all');
  const visible = todos.filter((todo) => filter === 'all' || (filter === 'open' ? todo.status !== 'done' : todo.ownerId === workspace.currentUser.id));
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · TEAM COMMITMENTS`} title="Keep the promises visible." description="To-Dos are clear commitments for the next seven days, owned by a person and visible to the team." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Open L10 agenda</Button>{!readOnly && <Button onClick={onAdd}>Add To-Do ＋</Button>}</>} /><div className="todo-summary-grid"><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-teal">✓</span><div><strong>{todos.filter((todo) => todo.status === 'done').length}/{todos.length}</strong><span>complete</span></div><ProgressBar value={todos.length ? todos.filter((todo) => todo.status === 'done').length / todos.length * 100 : 0} tone="teal" /></div><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-coral">◷</span><div><strong>{todos.filter((todo) => todo.status !== 'done').length}</strong><span>still open</span></div><span className="summary-help">Review before the next L10.</span></div><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-lavender">AK</span><div><strong>{todos.filter((todo) => todo.ownerId === workspace.currentUser.id).length}</strong><span>assigned to you</span></div><span className="summary-help">Your visible commitments.</span></div></div><div className="table-card card-surface"><div className="table-card-header"><div><span className="section-kicker">WEEKLY COMMITMENTS</span><h2>Team To-Dos</h2></div><div className="table-filters"><button className={filter === 'all' ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter('all')}>All <span>{todos.length}</span></button><button className={filter === 'open' ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter('open')}>Open</button><button className={filter === 'mine' ? 'filter-chip filter-chip-active' : 'filter-chip'} onClick={() => setFilter('mine')}>Mine</button></div></div><div className="todo-table"><div className="table-header"><span /><span>COMMITMENT</span><span>OWNER</span><span>ORIGIN</span><span>DUE</span><span>STATUS</span><span /></div>{visible.map((todo) => <div className={`table-row ${todo.flagged ? 'table-row-flagged' : ''}`} key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdateTodo(todo)} disabled={readOnly} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><button className={`table-primary table-primary-button ${todo.status === 'done' ? 'todo-done' : ''}`} onClick={() => onEditTodo(todo.id)}><strong>{todo.title}</strong><small>{todo.linkedRockTaskId ? 'Linked Rock Task' : todo.origin}{todo.flagged ? ` · flagged after ${todo.carryForwardCount} moves` : ''}</small></button><span className="table-person"><Avatar user={userFor(workspace, todo.ownerId)} size="sm" />{userFor(workspace, todo.ownerId).name}</span><span className="table-origin">{todo.origin}</span><span className={`table-due ${todo.status === 'not-done' ? 'due-overdue' : ''}`}>{formatDate(todo.dueDate)}</span><StatusPill status={todo.flagged ? 'not-done' : todo.status} label={todo.flagged ? 'Flagged' : undefined} />{!readOnly && todo.status !== 'done' && <button className="row-action row-action-small" onClick={() => onMoveTodo(todo)}>Move forward</button>}</div>)}{visible.length === 0 && <div className="empty-table"><EmptyState title="No To-Dos match" detail="Change the filter or add a new team commitment." /></div>}</div></div></>;
}

function IssuesView({ workspace, team, readOnly, issues, onStartIssue, onSolveIssue, onEditIssue, onAdd, onTransfer, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; issues: Issue[]; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onEditIssue: (issueId: string) => void; onAdd: () => void; onTransfer: (issueId: string) => void; onNavigate: (view: ViewId) => void }) {
  const [horizon, setHorizon] = useState<IssueHorizon>('short-term');
  const [selectedId, setSelectedId] = useState(issues.find((issue) => issue.horizon === horizon)?.id ?? issues[0]?.id);
  const visible = issues.filter((issue) => issue.horizon === horizon);
  const selectedIssue = visible.find((issue) => issue.id === selectedId) ?? visible[0];
  const open = issues.filter((issue) => issue.status !== 'solved');
  const unassigned = issues.filter((issue) => issue.assignmentState === 'unassigned');
  useEffect(() => { if (visible.length && !visible.some((issue) => issue.id === selectedId)) setSelectedId(visible[0].id); }, [horizon, issues, selectedId, visible]);
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · STANDALONE ISSUES`} title="Solve the right problem." description="Capture Issues when they appear. The team workspace owns the list; the L10 is one place to solve it." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Open live IDS</Button>{!readOnly && <Button onClick={onAdd}>Capture Issue ＋</Button>}</>} /><div className="issues-stat-row"><div><span className="section-kicker">ACTIVE ISSUES</span><strong>{open.length}</strong><span>visible to the team</span></div><div><span className="section-kicker">AGING / STALE</span><strong className="warning-text">{issues.filter((issue) => issue.ageBand === 'aging' || issue.ageBand === 'stale').length}</strong><span>need attention</span></div><div><span className="section-kicker">UNASSIGNED</span><strong className="negative-text">{unassigned.length}</strong><span>source team triage</span></div><div className="issues-stat-note"><span>⌁</span><p>Short-term Issues feed this week’s IDS. Long-term Issues stay visible for future planning.</p></div></div><div className="issue-horizon-tabs"><button className={horizon === 'short-term' ? 'horizon-tab-active' : ''} onClick={() => setHorizon('short-term')}>Short-term <span>{issues.filter((issue) => issue.horizon === 'short-term').length}</span></button><button className={horizon === 'long-term' ? 'horizon-tab-active' : ''} onClick={() => setHorizon('long-term')}>Long-term <span>{issues.filter((issue) => issue.horizon === 'long-term').length}</span></button></div><div className="issues-workbench card-surface"><div className="issues-list-panel"><div className="workbench-panel-head"><div><span className="section-kicker">OLDEST FIRST</span><h2>{horizon === 'short-term' ? 'Weekly Issues' : 'Long-term Issues'}</h2></div><span className="sort-label">Priority · age</span></div>{visible.map((issue) => <button className={`workbench-issue-row ${selectedIssue?.id === issue.id ? 'workbench-issue-selected' : ''} ${issue.status === 'solved' ? 'workbench-issue-solved' : ''}`} key={issue.id} onClick={() => setSelectedId(issue.id)}><span className="issue-number">{issue.priority}</span><span className="workbench-issue-copy"><strong>{issue.title}</strong><small>{issue.category} · <AgePill issue={issue} /></small></span><StatusPill status={issueStatusClass(issue)} /></button>)}{visible.length === 0 && <EmptyState title="No Issues in this horizon" detail="Capture the next problem or idea when it appears." />}</div><IssueDetail workspace={workspace} team={team} issue={selectedIssue} readOnly={readOnly} onEditIssue={onEditIssue} onStartIssue={onStartIssue} onSolveIssue={onSolveIssue} onTransfer={onTransfer} /></div></>;
}

function IssueDetail({ workspace, team, issue, readOnly, onEditIssue, onStartIssue, onSolveIssue, onTransfer }: { workspace: Workspace; team: Team; issue?: Issue; readOnly: boolean; onEditIssue: (issueId: string) => void; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onTransfer: (issueId: string) => void }) {
  if (!issue) return <div className="issue-detail-panel"><EmptyState title="Choose an Issue" detail="Select an item from the list to see its context." /></div>;
  const transfer = workspace.transfers.find((item) => item.issueId === issue.id && item.status === 'pending');
  const issueTransfers = workspace.transfers.filter((item) => item.issueId === issue.id).sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  const sourceTeam = teamFor(workspace, issue.sourceTeamId);
  return <div className="issue-detail-panel"><div className="detail-panel-head"><StatusPill status={issueStatusClass(issue)} /><span className="detail-category">{issue.category} · {issue.horizon === 'short-term' ? 'Short-term' : 'Long-term'}</span><AgePill issue={issue} /></div><div className="detail-title-row"><h2>{issue.title}</h2>{!readOnly && <button className="row-action" onClick={() => onEditIssue(issue.id)}>Edit details</button>}</div><p className="issue-detail-copy">{issue.detail}</p>{issue.linkedRockId && <div className="linked-record"><span>Linked Rock</span><strong>{workspace.rocks.find((rock) => rock.id === issue.linkedRockId)?.title ?? 'Quarterly priority'}</strong><span>↗</span></div>}<div className="issue-detail-note"><span className="section-kicker">IDS PROMPT</span><p>{issue.idsNote ?? 'What is the decision this team needs to make?'}</p></div>{issue.escalationState !== 'not-scheduled' && <div className={`escalation-callout escalation-${issue.escalationState}`}><strong>{issue.escalationState === 'scheduled' ? 'Escalation scheduled' : issue.escalationState === 'escalated' ? 'Escalated' : 'Escalation due'}</strong><span>{issue.meetingsPassed} meetings passed{issue.escalationDueAt ? ` · ${issue.escalationState === 'scheduled' ? `due ${formatDate(issue.escalationDueAt)}` : `since ${formatDate(issue.escalationDueAt)}`}` : ''}{issue.escalatedToUserId ? ` · routed to ${userFor(workspace, issue.escalatedToUserId).name}` : ''}</span></div>}{issue.assignmentState === 'unassigned' && <div className="unassigned-callout"><strong>Unassigned after transfer rejection</strong><span>Choose a new destination team to put this Issue back into motion.</span></div>}{transfer && <div className="pending-callout"><strong>Transfer pending</strong><span>Waiting for {teamFor(workspace, transfer.destinationTeamId).name}. The source team can cancel this request.</span></div>}<div className="issue-detail-meta"><span><Avatar user={userFor(workspace, issue.ownerId ?? issue.raisedById)} size="sm" /> {issue.ownerId ? `Owner: ${userFor(workspace, issue.ownerId).name}` : 'Unassigned'}</span><span>Created {formatDate(issue.createdAt)} · {ageLabel(issue)} old</span></div>{issue.status !== 'solved' && !readOnly && <div className="detail-actions"><Button variant="secondary" onClick={() => onStartIssue(issue)} disabled={issue.horizon === 'long-term' || issue.assignmentState === 'pending-transfer'}>{issue.status === 'in-ids' ? 'Continue in IDS' : 'Start IDS'} →</Button><Button onClick={() => onSolveIssue(issue)} disabled={issue.assignmentState === 'pending-transfer'}>Mark solved ✓</Button>{!transfer && <Button variant="quiet" onClick={() => onTransfer(issue.id)}>Send to another team ⇄</Button>}</div>}{issue.status === 'solved' && <div className="solved-banner"><span>✓</span><div><strong>Solved and removed from the active list</strong><small>The original creation date and decision history remain preserved.</small></div></div>}{issueTransfers.length > 0 && <div className="issue-history"><span className="section-kicker">ISSUE HISTORY</span>{issueTransfers.map((item) => <div className="issue-history-row" key={item.id}><div><strong>{item.status === 'pending' ? 'Transfer pending' : `Transfer ${item.status}`}</strong><small>{teamFor(workspace, item.sourceTeamId).name} → {teamFor(workspace, item.destinationTeamId).name} · {formatDate(item.requestedAt)}</small></div>{item.rejectionMessage && <span>{item.rejectionMessage}</span>}</div>)}</div>}<div className="issue-provenance"><span>Originated in {sourceTeam.name}</span><span>Version {issue.version}</span></div></div>;
}

function MessagesView({ workspace, team, readOnly, messages, onCompose, onOpen, onCreateIssue }: { workspace: Workspace; team: Team; readOnly: boolean; messages: TeamMessage[]; onCompose: () => void; onOpen: (messageId: string) => void; onCreateIssue: (messageId: string) => void }) {
  const incoming = messages.filter((message) => message.toTeamId === team.id);
  const sent = messages.filter((message) => message.fromTeamId === team.id);
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · TEAM MESSAGES`} title="Keep teams in the loop." description="Send context to another team without moving an Issue. The receiving team can turn a message into a fully editable Issue when it needs IDS." actions={!readOnly ? <Button onClick={onCompose}>New message ＋</Button> : undefined} /><div className="message-summary-grid"><div className="message-summary-card card-surface"><span className="summary-icon summary-icon-coral">✉</span><div><strong>{incoming.filter((message) => message.status === 'unread').length}</strong><span>unread messages</span></div><small>Context waiting for this team.</small></div><div className="message-summary-card card-surface"><span className="summary-icon summary-icon-teal">↗</span><div><strong>{sent.length}</strong><span>sent by this team</span></div><small>Keep handoffs lightweight.</small></div><div className="message-summary-card card-surface"><span className="summary-icon summary-icon-lavender">!</span><div><strong>{messages.filter((message) => message.convertedIssueId).length}</strong><span>converted to Issues</span></div><small>Messages remain linked for provenance.</small></div></div><div className="messages-layout"><MessageList workspace={workspace} title="Received by this team" empty="No messages are waiting for this team." messages={incoming} onOpen={onOpen} onCreateIssue={(message) => onCreateIssue(message.id)} canCreateIssue={!readOnly} /><MessageList workspace={workspace} title="Sent by this team" empty="No messages sent yet." messages={sent} onOpen={onOpen} canCreateIssue={false} /></div></>;
}

function MessageList({ workspace, title, empty, messages, onOpen, onCreateIssue, canCreateIssue }: { workspace: Workspace; title: string; empty: string; messages: TeamMessage[]; onOpen: (messageId: string) => void; onCreateIssue?: (message: TeamMessage) => void; canCreateIssue: boolean }) {
  return <section className="message-list-card card-surface"><div className="table-card-header"><div><span className="section-kicker">INBOX</span><h2>{title}</h2></div><span>{messages.length}</span></div><div className="message-list">{messages.map((message) => <div className={`message-row ${message.status === 'unread' ? 'message-row-unread' : ''}`} key={message.id}><button className="message-open-button" onClick={() => onOpen(message.id)}><span className="message-symbol">{message.status === 'unread' ? '●' : '○'}</span><span className="message-copy"><strong>{message.subject}</strong><small>{teamName(workspace, message.fromTeamId)} → {teamName(workspace, message.toTeamId)} · {formatDate(message.createdAt)}</small><span>{message.body}</span></span></button><div className="message-row-actions">{message.convertedIssueId ? <span className="linked-chip">Issue created</span> : canCreateIssue && onCreateIssue ? <button className="row-action row-action-small" onClick={() => onCreateIssue(message)}>Create Issue</button> : null}</div></div>)}{messages.length === 0 && <EmptyState title={empty} detail="Messages preserve context without changing ownership." />}</div></section>;
}

function teamName(workspace: Workspace, teamId: string) {
  return workspace.teams.find((team) => team.id === teamId)?.shortName ?? teamId;
}

function MessageModal({ workspace, fromTeam, onClose, onSubmit }: { workspace: Workspace; fromTeam: Team; onClose: () => void; onSubmit: (input: Pick<TeamMessage, 'fromTeamId' | 'toTeamId' | 'subject' | 'body'>) => void }) {
  const destinations = workspace.teams.filter((team) => team.active && team.nodeType === 'operational' && team.id !== fromTeam.id);
  return <ModalShell title="Send a team message" description={`Share context from ${fromTeam.name}. Messages do not transfer Issue ownership.`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ fromTeamId: fromTeam.id, toTeamId: String(form.get('toTeamId')), subject: String(form.get('subject') ?? ''), body: String(form.get('body') ?? '') }); }}><label>To team<select name="toTeamId" required defaultValue=""><option value="" disabled>Select a team</option>{destinations.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select></label><label>Subject<input name="subject" required autoFocus placeholder="What does the other team need to know?" /></label><label>Message<textarea name="body" rows={6} required placeholder="Add context, a question, or a request." /></label><ModalActions onClose={onClose} submitLabel="Send message" /></form></ModalShell>;
}

function MessageDetailModal({ workspace, message, canCreateIssue, onClose, onCreateIssue }: { workspace: Workspace; message: TeamMessage; canCreateIssue: boolean; onClose: () => void; onCreateIssue: () => void }) {
  return <ModalShell title={message.subject} description={`${teamName(workspace, message.fromTeamId)} → ${teamName(workspace, message.toTeamId)} · ${formatDate(message.createdAt)}`} onClose={onClose}><div className="message-detail-modal"><p>{message.body}</p>{message.convertedIssueId ? <div className="linked-record"><span>Linked Issue</span><strong>{message.convertedIssueId}</strong></div> : canCreateIssue && message.toTeamId !== message.fromTeamId && <Button onClick={onCreateIssue}>Create Issue from message →</Button>}</div></ModalShell>;
}

function MessageIssueModal({ workspace, message, onClose, onSubmit }: { workspace: Workspace; message: TeamMessage; onClose: () => void; onSubmit: (input: Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId'>) => void }) {
  return <ModalShell title="Create Issue from message" description="The message has prefilled the Issue. Edit the fields before it enters this team’s Issues list." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ title: String(form.get('title') ?? '').trim(), detail: String(form.get('detail') ?? '').trim(), category: String(form.get('category') ?? 'General'), priority: Number(form.get('priority') ?? 2), horizon: String(form.get('horizon') ?? 'short-term') as IssueHorizon, ownerId: String(form.get('ownerId') ?? workspace.currentUser.id) }); }}><label>Issue title<input name="title" defaultValue={message.subject} autoFocus required /></label><label>Context<textarea name="detail" defaultValue={message.body} rows={6} required /></label><div className="form-grid"><label>Category<input name="category" defaultValue="Cross-team message" /></label><label>Priority<select name="priority" defaultValue="2"><option value="1">1 · highest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · lowest</option></select></label></div><label>Horizon<select name="horizon" defaultValue="short-term"><option value="short-term">Short-term · feed L10</option><option value="long-term">Long-term · future planning</option></select></label><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><ModalActions onClose={onClose} submitLabel="Create editable Issue" /></form></ModalShell>;
}

function ScorecardView({ workspace, team, readOnly, metrics, onFlagMetric, onNavigate }: { workspace: Workspace; team: Team; readOnly: boolean; metrics: ScorecardMetric[]; onFlagMetric: (metric: ScorecardMetric) => void; onNavigate: (view: ViewId) => void }) {
  const onTrack = metrics.filter((metric) => metric.status === 'on-track').length;
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · WEEKLY NUMBERS`} title="Let the numbers speak." description="The Scorecard is an early-warning system. Capture the story as an Issue when the team needs to solve it." actions={<><Button variant="secondary" onClick={() => onNavigate('meeting')}>Use in L10</Button>{!readOnly && <Button onClick={() => onNavigate('admin')}>Manage measurables →</Button>}</>} /><div className="scorecard-hero card-surface"><div><span className="section-kicker">WEEKLY SCORECARD</span><h2>{onTrack} of {metrics.length} measurables are on track.</h2><p>One number is asking for the room’s attention. Capture it as an Issue when you’re ready.</p></div><div className="scorecard-orbit"><span>{Math.round(onTrack / Math.max(1, metrics.length) * 100)}%</span><small>healthy</small></div></div><div className="metric-table card-surface"><div className="metric-table-head"><div><span className="section-kicker">TEAM SCORECARD</span><h2>Weekly measurables</h2></div><span className="last-updated">Updated today</span></div>{metrics.map((metric) => <div className="metric-row scorecard-metric-row" key={metric.id}><div className="metric-name"><span className={`metric-status-dot metric-${metric.status}`} /><strong>{metric.label}</strong><small><Avatar user={userFor(workspace, metric.ownerId)} size="sm" />{userFor(workspace, metric.ownerId).name}</small></div><div className="metric-values"><span>Target <b>{metric.target}</b> {metric.unit}</span><span>Actual <b>{metric.actual}</b> {metric.unit}</span></div><div className="metric-trend"><span className={`trend-arrow trend-${metric.trend}`}>{metric.trend === 'up' ? '↗' : metric.trend === 'down' ? '↘' : '→'}</span>{metric.trendLabel}</div><StatusPill status={metric.status} />{metric.status === 'off-track' && !readOnly && <button className="row-action row-action-small" onClick={() => onFlagMetric(metric)}>Add to IDS</button>}</div>)}{metrics.length === 0 && <EmptyState title="No measurables yet" detail="Set up the first weekly number for this team." />}</div></>;
}

function AdminView({ workspace, environmentAccess, onToggleEnvironmentAccess, onCreateTeam, onCreateUser, onUpdateTeam, onEditTeam, onMembership, onSaveSettings }: { workspace: Workspace; environmentAccess: EnvironmentAccess[] | null; onToggleEnvironmentAccess: (userId: string, testAllowed: boolean) => void; onCreateTeam: () => void; onCreateUser: () => void; onUpdateTeam: (teamId: string, input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) => void; onEditTeam: (teamId: string) => void; onMembership: (input: Pick<TeamMembership, 'userId' | 'teamId' | 'role'>) => void; onSaveSettings: (settings: IssueAgeSettings) => void }) {
  const [settings, setSettings] = useState(workspace.settings);
  const [selectedUserId, setSelectedUserId] = useState(workspace.users[0]?.id ?? '');
  const [selectedTeamId, setSelectedTeamId] = useState(workspace.teams[0]?.id ?? '');
  const [selectedRole, setSelectedRole] = useState<TeamRole>('Member');
  return <><PageHeader eyebrow="PLATFORM ADMINISTRATION" title="Keep the operating system healthy." description="Manage the hierarchy, local user profiles, per-team access, aging settings, and the audit trail. Platform administration does not grant work-data access." /><div className="admin-grid"><section className="admin-main"><div className="admin-section-heading"><div><span className="section-kicker">TEAM HIERARCHY</span><h2>Operational workspaces</h2></div><Button onClick={onCreateTeam}>Add team ＋</Button></div><div className="hierarchy-card card-surface">{workspace.teams.filter((team) => !team.parentTeamId).map((team) => <TeamTree key={team.id} workspace={workspace} team={team} depth={0} onToggleType={(id, nodeType) => onUpdateTeam(id, { nodeType })} onEdit={onEditTeam} />)}</div>{environmentAccess && <div className="environment-access-card card-surface"><div className="admin-section-heading"><div><span className="section-kicker">ENVIRONMENT ACCESS</span><h2>Test workspace allowlist</h2></div><span className="admin-inline-note">Managed from Live</span></div><p>Granting access exposes the separate Test database only. Live memberships and roles are unchanged.</p><div className="environment-access-list">{environmentAccess.map((access) => <label className="environment-access-row" key={access.userId}><span><strong>{access.name}</strong><small>{access.email}</small></span><input type="checkbox" checked={access.testAllowed} onChange={(event) => onToggleEnvironmentAccess(access.userId, event.target.checked)} /><span>{access.testAllowed ? 'Test enabled' : 'No Test access'}</span></label>)}</div></div>}<div className="admin-section-heading admin-section-heading-spaced"><div><span className="section-kicker">LOCAL DIRECTORY</span><h2>Users and assignments</h2></div><Button variant="secondary" onClick={onCreateUser}>Add local user ＋</Button></div><div className="user-directory card-surface">{workspace.users.map((user) => <div className="user-directory-row" key={user.id}><Avatar user={user} size="md" /><div className="user-directory-copy"><strong>{user.name}</strong><span>{user.email}</span></div>{user.platformCapabilities.includes('PlatformAdmin') && <span className="platform-badge">Platform Admin</span>}<span className="membership-count">{workspace.memberships.filter((membership) => membership.userId === user.id && membership.active).length} teams</span></div>)}<div className="membership-editor"><span className="section-kicker">ASSIGN USER TO TEAM</span><div className="inline-form"><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>{workspace.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>{workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as TeamRole)}><option>TeamLead</option><option>Member</option><option>Viewer</option></select><Button onClick={() => onMembership({ userId: selectedUserId, teamId: selectedTeamId, role: selectedRole })}>Assign</Button></div></div></div><div className="admin-section-heading admin-section-heading-spaced"><div><span className="section-kicker">AUDITABILITY</span><h2>Recent activity</h2></div></div><div className="audit-list card-surface">{workspace.activity.slice(0, 8).map((event) => <div className="audit-row" key={event.id}><span className={`audit-icon audit-${event.type}`}>{event.type === 'transfer' ? '⇄' : event.type === 'membership' ? '♙' : '•'}</span><div><strong>{event.action}</strong><span>{event.detail}</span></div><time>{formatDate(event.createdAt)} · {formatTime(event.createdAt)}</time></div>)}</div></section><aside className="admin-side"><div className="admin-callout"><span className="callout-symbol">✦</span><span className="section-kicker">LOCAL POC MODE</span><h2>One app-owned source of truth.</h2><p>Users are local profiles for testing. Authentication can be connected later without changing memberships or authorization rules.</p></div><div className="settings-card card-surface"><span className="section-kicker">ISSUE AGING</span><h3>When should an Issue ask for attention?</h3><p>These thresholds apply to every team and preserve the original creation date after transfers.</p><div className="settings-fields"><label>Aging after (days)<input type="number" min="1" value={settings.agingDays} onChange={(event) => setSettings({ ...settings, agingDays: Number(event.target.value) })} /></label><label>Stale after (days)<input type="number" min="2" value={settings.staleDays} onChange={(event) => setSettings({ ...settings, staleDays: Number(event.target.value) })} /></label><label>Critical after (days)<input type="number" min="3" value={settings.criticalDays} onChange={(event) => setSettings({ ...settings, criticalDays: Number(event.target.value) })} /></label></div><Button onClick={() => onSaveSettings(settings)}>Save thresholds</Button></div></aside></div></>;
}

function TeamTree({ workspace, team, depth, onToggleType, onEdit }: { workspace: Workspace; team: Team; depth: number; onToggleType: (teamId: string, nodeType: TeamNodeType) => void; onEdit: (teamId: string) => void }) {
  const children = workspace.teams.filter((item) => item.parentTeamId === team.id);
  const enabledSections = meetingSectionsFor(team).length;
  return <div className="team-tree-node"><div className="team-tree-row" style={{ paddingLeft: `${16 + depth * 26}px` }}><span className="tree-branch">{children.length ? '⌄' : '•'}</span><span className="team-mark" style={{ backgroundColor: team.accent }}>{team.initials}</span><div><strong>{team.name}</strong><small>{team.memberCount} members · {team.nodeType} · {enabledSections} L10 sections · {team.escalationUserIds.length} escalation levels</small></div><button className="node-type-toggle" onClick={() => onToggleType(team.id, team.nodeType === 'operational' ? 'grouping' : 'operational')}>{team.nodeType === 'operational' ? 'Operational' : 'Grouping only'}</button><button className="row-action" onClick={() => onEdit(team.id)}>Configure</button></div>{children.map((child) => <TeamTree key={child.id} workspace={workspace} team={child} depth={depth + 1} onToggleType={onToggleType} onEdit={onEdit} />)}</div>;
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

function UserOptions({ workspace, name, defaultValue }: { workspace: Workspace; name: string; defaultValue?: string }) {
  return <select name={name} defaultValue={defaultValue ?? workspace.currentUser.id}>{workspace.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select>;
}

function TodoModal({ workspace, team, onClose, onSubmit }: { workspace: Workspace; team: Team; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a To-Do" description={`Create a clear seven-day commitment for ${team.name}.`} onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Commitment<input name="title" placeholder="What will be done?" autoFocus required /></label><label>Notes<textarea name="notes" rows={3} placeholder="Add useful context." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><label>Due date<input name="dueDate" type="date" defaultValue="2026-09-05" required /></label><ModalActions onClose={onClose} submitLabel="Add To-Do" /></form></ModalShell>;
}

function TodoEditModal({ workspace, todo, onClose, onSubmit, onMoveForward }: { workspace: Workspace; todo: Todo; onClose: () => void; onSubmit: (input: Partial<Pick<Todo, 'title' | 'notes' | 'ownerId' | 'dueDate' | 'status'>>) => void; onMoveForward: (dueDate: string) => void }) {
  return <ModalShell title="Open To-Do" description="Add working notes, adjust the owner or due date, and keep the commitment visible to the team." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ title: String(form.get('title') ?? '').trim(), notes: String(form.get('notes') ?? '').trim(), ownerId: String(form.get('ownerId') ?? ''), dueDate: String(form.get('dueDate') ?? ''), status: String(form.get('status') ?? todo.status) as TodoStatus }); }}><label>Commitment<input name="title" defaultValue={todo.title} autoFocus required /></label><label>Notes<textarea name="notes" defaultValue={todo.notes} rows={6} placeholder="Add context, progress, or the next step." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" defaultValue={todo.ownerId} /></label><div className="form-grid"><label>Due date<input name="dueDate" type="date" defaultValue={todo.dueDate} required /></label><label>Status<select name="status" defaultValue={todo.status}><option value="open">Open</option><option value="done">Done</option><option value="not-done">Not done</option></select></label></div><div className="todo-rollover-callout"><strong>Moved forward {todo.carryForwardCount} times</strong><span>{todo.flagged ? 'This To-Do has become an Issue for IDS.' : 'After the fourth move it is automatically flagged and converted into an Issue.'}</span></div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button>{todo.status !== 'done' && <Button variant="quiet" onClick={() => onMoveForward(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))}>Move forward</Button>}<Button type="submit">Save To-Do →</Button></div></form></ModalShell>;
}

function IssueModal({ workspace, onClose, onSubmit }: { workspace: Workspace; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Capture an Issue" description="Name the problem, decision, idea, or opportunity. The team can solve short-term Issues in IDS when the time is right." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Issue title<input name="title" placeholder="What needs solving?" autoFocus required /></label><label>Context<textarea name="detail" rows={4} placeholder="Add enough context for the team to recognise the Issue." /></label><div className="form-grid"><label>Horizon<select name="horizon" defaultValue="short-term"><option value="short-term">Short-term · feed L10</option><option value="long-term">Long-term · future planning</option></select></label><label>Priority<select name="priority" defaultValue="1"><option value="1">1 · highest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · lowest</option></select></label></div><label>Category<select name="category" defaultValue="General"><option>General</option><option>Process</option><option>Customer</option><option>Alignment</option><option>People</option><option>Security</option></select></label><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><ModalActions onClose={onClose} submitLabel="Add to Issues" /></form></ModalShell>;
}

function RockEditModal({ workspace, rock, onClose, onSubmit }: { workspace: Workspace; rock: Rock; onClose: () => void; onSubmit: (input: Partial<Pick<Rock, 'title' | 'description' | 'notes' | 'ownerId' | 'progress' | 'dueDate' | 'priority'>>) => void }) {
  return <ModalShell title="Edit Rock details" description="Improve the outcome description or add notes without changing its quarterly identity." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ title: String(form.get('title') ?? '').trim(), description: String(form.get('description') ?? '').trim(), notes: String(form.get('notes') ?? '').trim(), ownerId: String(form.get('ownerId') ?? workspace.currentUser.id), progress: Number(form.get('progress') ?? rock.progress), priority: String(form.get('priority') ?? rock.priority) as Rock['priority'], dueDate: String(form.get('dueDate') ?? rock.dueDate) }); }}><label>Rock title<input name="title" defaultValue={rock.title} autoFocus required /></label><label>Description<textarea name="description" defaultValue={rock.description} rows={4} required /></label><label>Notes<textarea name="notes" defaultValue={rock.notes} rows={6} placeholder="Add the context the team needs after creation." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" defaultValue={rock.ownerId} /></label><div className="form-grid"><label>Progress (%)<input name="progress" type="number" min="0" max="100" defaultValue={rock.progress} /></label><label>Priority<select name="priority" defaultValue={rock.priority}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div><label>Due date<input name="dueDate" type="date" defaultValue={rock.dueDate} required /></label><ModalActions onClose={onClose} submitLabel="Save Rock" /></form></ModalShell>;
}

function IssueEditModal({ workspace, issue, meetingId, onClose, onSubmit }: { workspace: Workspace; issue: Issue; meetingId?: string; onClose: () => void; onSubmit: (input: Partial<Pick<Issue, 'title' | 'detail' | 'category' | 'priority' | 'horizon' | 'ownerId' | 'idsNote'>>, meetingNote?: string) => void }) {
  return <ModalShell title={meetingId ? 'Open Issue during IDS' : 'Edit Issue details'} description={meetingId ? 'Capture notes for this meeting. They are added to the Issue history and meeting recap.' : 'Keep the Issue context current as the team learns more.'} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const ownerId = String(form.get('ownerId') ?? '').trim(); onSubmit({ title: String(form.get('title') ?? '').trim(), detail: String(form.get('detail') ?? '').trim(), category: String(form.get('category') ?? 'General').trim(), priority: Number(form.get('priority') ?? issue.priority), horizon: String(form.get('horizon') ?? issue.horizon) as IssueHorizon, ownerId: ownerId || undefined, idsNote: String(form.get('idsNote') ?? '').trim() }, meetingId ? String(form.get('meetingNote') ?? '').trim() : undefined); }}><label>Issue title<input name="title" defaultValue={issue.title} autoFocus required /></label><label>Context<textarea name="detail" defaultValue={issue.detail} rows={5} required /></label><div className="form-grid"><label>Category<input name="category" defaultValue={issue.category} required /></label><label>Priority<select name="priority" defaultValue={String(issue.priority)}><option value="1">1 · highest</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 · lowest</option></select></label></div><label>Horizon<select name="horizon" defaultValue={issue.horizon}><option value="short-term">Short-term · feed L10</option><option value="long-term">Long-term · future planning</option></select></label><label>Owner<UserOptions workspace={workspace} name="ownerId" defaultValue={issue.ownerId ?? issue.raisedById} /></label><label>Issue IDS context<textarea name="idsNote" defaultValue={issue.idsNote ?? ''} rows={4} placeholder="Keep the decision prompt current." /></label>{meetingId && <label className="meeting-note-field">This meeting’s IDS notes<textarea name="meetingNote" rows={5} placeholder="What did the team identify, discuss, decide, or defer today?" /></label>}<ModalActions onClose={onClose} submitLabel="Save Issue" /></form></ModalShell>;
}

function RockModal({ workspace, onClose, onSubmit }: { workspace: Workspace; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a Rock" description="Define one important quarterly outcome with one accountable owner." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Rock title<input name="title" placeholder="What must be true by quarter end?" autoFocus required /></label><label>Description<textarea name="description" rows={3} placeholder="Describe the outcome." /></label><label>Notes<textarea name="notes" rows={2} placeholder="Add working notes or guardrails." /></label><label>Owner<UserOptions workspace={workspace} name="ownerId" /></label><div className="form-grid"><label>Priority<select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Due date<input name="dueDate" type="date" defaultValue="2026-09-30" required /></label></div><ModalActions onClose={onClose} submitLabel="Add Rock" /></form></ModalShell>;
}

function TaskModal({ workspace, rock, onClose, onSubmit }: { workspace: Workspace; rock: Rock; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a Rock Task" description={`Break “${rock.title}” into a dated, accountable step.`} onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Task title<input name="title" placeholder="What is the next visible step?" autoFocus required /></label><label>Notes<textarea name="notes" rows={3} placeholder="Add task context." /></label><label>Assignee<UserOptions workspace={workspace} name="assigneeId" /></label><div className="form-grid"><label>Assigned date<input name="assignedAt" type="date" defaultValue={workspaceToday} required /></label><label>Start date<input name="startDate" type="date" defaultValue={workspaceToday} required /></label></div><label>Due date<input name="dueDate" type="date" defaultValue={rock.dueDate} required /></label><ModalActions onClose={onClose} submitLabel="Add Task" /></form></ModalShell>;
}

function TransferModal({ workspace, issue, onClose, onSubmit }: { workspace: Workspace; issue: Issue; onClose: () => void; onSubmit: (destinationTeamId: string, note: string) => void }) {
  const destinations = workspace.teams.filter((team) => team.active && team.nodeType === 'operational' && team.id !== issue.teamId);
  return <ModalShell title="Send Issue to another team" description="The destination team will receive an in-app notice and must accept or reject the handoff." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit(String(form.get('destinationTeamId')), String(form.get('note') ?? '').trim()); }}><div className="transfer-preview"><AgePill issue={issue} /><strong>{issue.title}</strong><span>Original team: {teamFor(workspace, issue.teamId).name}</span></div><label>Destination team<select name="destinationTeamId" required defaultValue=""> <option value="" disabled>Select a team</option>{destinations.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Handoff note<textarea name="note" rows={3} placeholder="Why does this team need to decide it?" /></label><ModalActions onClose={onClose} submitLabel="Request transfer" /></form></ModalShell>;
}

function RejectModal({ transfer, issue, onClose, onSubmit }: { transfer: IssueTransfer; issue?: Issue; onClose: () => void; onSubmit: (message: string) => void }) {
  return <ModalShell title="Reject this transfer" description={`Explain why ${issue?.title ?? 'this Issue'} cannot be accepted by your team. The Issue will return to its source team unassigned.`} onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); onSubmit(String(new FormData(event.currentTarget).get('message') ?? '').trim()); }}><label>Rejection message<textarea name="message" rows={5} autoFocus placeholder="What does the source team need to know?" required /></label><ModalActions onClose={onClose} submitLabel="Reject and unassign" /></form></ModalShell>;
}

function TeamModal({ workspace, onClose, onSubmit }: { workspace: Workspace; onClose: () => void; onSubmit: (input: Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials'> & { meetingSections?: MeetingSectionConfig[]; escalationUserIds?: string[] }) => void }) {
  return <ModalShell title="Create a team workspace" description="Every new node can own its own Rocks, To-Dos, Issues, and L10, or act as grouping-only." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ name: String(form.get('name')), shortName: String(form.get('shortName')), description: String(form.get('description')), parentTeamId: String(form.get('parentTeamId') || '') || null, nodeType: String(form.get('nodeType')) as TeamNodeType, meetingDay: String(form.get('meetingDay')), meetingTime: String(form.get('meetingTime')), accent: '#4c8f86', initials: initialsFor(String(form.get('shortName'))), meetingSections: defaultMeetingSections(), escalationUserIds: [] }); }}><label>Team name<input name="name" autoFocus required placeholder="e.g. Customer Success" /></label><label>Short name<input name="shortName" required placeholder="e.g. CS" /></label><label>Description<textarea name="description" rows={3} /></label><label>Parent node<select name="parentTeamId" defaultValue="leadership">{workspace.teams.filter((team) => team.active).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Node type<select name="nodeType" defaultValue="operational"><option value="operational">Operational workspace</option><option value="grouping">Grouping only</option></select></label><div className="form-grid"><label>Meeting day<input name="meetingDay" defaultValue="Friday" /></label><label>Meeting time<input name="meetingTime" defaultValue="9:00 AM" /></label></div><small className="form-help">After creation, configure the team’s L10 sections and escalation hierarchy from the team settings.</small><ModalActions onClose={onClose} submitLabel="Create team" /></form></ModalShell>;
}

function TeamEditModalLegacy({ workspace, team, onClose, onSubmit }: { workspace: Workspace; team: Team; onClose: () => void; onSubmit: (input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) => void }) {
  const sections = defaultMeetingSections().map((section) => team.meetingSections.find((configured) => configured.id === section.id) ?? section);
  const recipients = workspace.users.filter((user) => user.active);
  return <ModalShell title={`Configure ${team.name}`} description="Set the team’s L10 structure and the escalation path used for Issues that remain unsolved." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const shortName = String(form.get('shortName')); const meetingSections = sections.map((section) => ({ ...section, enabled: form.get(`section-${section.id}`) === 'on', duration: Number(form.get(`duration-${section.id}`) ?? section.duration) })); const escalationUserIds = [0, 1, 2].map((level) => String(form.get(`escalation-${level}`) ?? '')).filter(Boolean); onSubmit({ name: String(form.get('name')), shortName, description: String(form.get('description')), parentTeamId: String(form.get('parentTeamId') || '') || null, nodeType: String(form.get('nodeType')) as TeamNodeType, meetingDay: String(form.get('meetingDay')), meetingTime: String(form.get('meetingTime')), initials: initialsFor(shortName), meetingSections, escalationUserIds }); }}><label>Team name<input name="name" defaultValue={team.name} autoFocus required /></label><label>Short name<input name="shortName" defaultValue={team.shortName} required /></label><label>Description<textarea name="description" defaultValue={team.description} rows={3} /></label><label>Parent node<select name="parentTeamId" defaultValue={team.parentTeamId ?? ''}>{team.id === 'leadership' && <option value="">Hierarchy root</option>}{workspace.teams.filter((candidate) => candidate.active && candidate.id !== team.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label>Node type<select name="nodeType" defaultValue={team.nodeType}><option value="operational">Operational workspace</option><option value="grouping">Grouping only</option></select></label><div className="form-grid"><label>Meeting day<input name="meetingDay" defaultValue={team.meetingDay} /></label><label>Meeting time<input name="meetingTime" defaultValue={team.meetingTime} /></label></div><div className="config-form-section"><span className="section-kicker">L10 STRUCTURE</span><p className="form-help">Turn off sections this team does not need. Conclude and IDS remain available for a complete meeting record.</p><div className="meeting-config-list">{sections.map((section) => <div className="meeting-config-row" key={section.id}><label className="checkbox-label"><input name={`section-${section.id}`} type="checkbox" defaultChecked={section.enabled || section.id === 'conclude' || section.id === 'ids'} disabled={section.id === 'conclude' || section.id === 'ids'} /> <span>{section.label}</span></label><label className="duration-field">Minutes<input name={`duration-${section.id}`} type="number" min="1" max="180" defaultValue={section.duration} /></label></div>)}</div></div><div className="config-form-section"><span className="section-kicker">ESCALATION HIERARCHY</span><p className="form-help">Recipients are notified in order when an Issue reaches its escalation point. Leave unused levels blank.</p><div className="escalation-config-list">{[0, 1, 2].map((level) => <label key={level}>Level {level + 1}<select name={`escalation-${level}`} defaultValue={team.escalationUserIds[level] ?? ''}><option value="">No recipient</option>{recipients.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>)}</div></div><ModalActions onClose={onClose} submitLabel="Save team settings" /></form></ModalShell>;
}

function TeamEditModal({ workspace, team, onClose, onSubmit }: { workspace: Workspace; team: Team; onClose: () => void; onSubmit: (input: Partial<Pick<Team, 'name' | 'shortName' | 'description' | 'parentTeamId' | 'nodeType' | 'meetingDay' | 'meetingTime' | 'accent' | 'initials' | 'meetingSections' | 'escalationUserIds'>>) => void }) {
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
      meetingDay: String(form.get('meetingDay') ?? ''),
      meetingTime: String(form.get('meetingTime') ?? ''),
      initials: initialsFor(shortName),
      meetingSections,
      escalationUserIds,
    });
  };
  return <ModalShell title={`Configure ${team.name}`} description="Set the team’s L10 structure and the escalation path used for Issues that remain unsolved." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Team name<input name="name" defaultValue={team.name} autoFocus required /></label><label>Short name<input name="shortName" defaultValue={team.shortName} required /></label><label>Description<textarea name="description" defaultValue={team.description} rows={3} /></label><label>Parent node<select name="parentTeamId" defaultValue={team.parentTeamId ?? ''}>{team.id === 'leadership' && <option value="">Hierarchy root</option>}{workspace.teams.filter((candidate) => candidate.active && candidate.id !== team.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label>Node type<select name="nodeType" defaultValue={team.nodeType}><option value="operational">Operational workspace</option><option value="grouping">Grouping only</option></select></label><div className="form-grid"><label>Meeting day<input name="meetingDay" defaultValue={team.meetingDay} /></label><label>Meeting time<input name="meetingTime" defaultValue={team.meetingTime} /></label></div><div className="config-form-section"><span className="section-kicker">L10 STRUCTURE</span><p className="form-help">Turn off sections this team does not need. IDS and Conclude remain enabled so the meeting has a resolution and record.</p><div className="meeting-config-list">{sections.map((section) => { const required = section.id === 'ids' || section.id === 'conclude'; return <div className="meeting-config-row" key={section.id}><label className="checkbox-label"><input name={`section-${section.id}`} type="checkbox" defaultChecked={section.enabled || required} disabled={required} /> <span>{section.label}{required ? ' · required' : ''}</span></label><label className="duration-field">Minutes<input name={`duration-${section.id}`} type="number" min="1" max="180" defaultValue={section.duration} /></label></div>; })}</div></div><div className="config-form-section"><span className="section-kicker">ESCALATION HIERARCHY</span><p className="form-help">Recipients are notified in order when an Issue reaches its escalation point. Leave unused levels blank.</p><div className="escalation-config-list">{[0, 1, 2].map((level) => <label key={level}>Level {level + 1}<select name={`escalation-${level}`} defaultValue={team.escalationUserIds[level] ?? ''}><option value="">No recipient</option>{recipients.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>)}</div></div><ModalActions onClose={onClose} submitLabel="Save team settings" /></form></ModalShell>;
}

function UserModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: Pick<User, 'name' | 'email' | 'accent'> & { platformAdmin?: boolean }) => void }) {
  return <ModalShell title="Create local user profile" description="This POC creates an app-owned profile only. Authentication and external identity linking will be added later." onClose={onClose}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSubmit({ name: String(form.get('name')), email: String(form.get('email')), accent: '#6787b7', platformAdmin: form.get('platformAdmin') === 'on' }); }}><label>Name<input name="name" autoFocus required placeholder="Full name" /></label><label>Email<input name="email" type="email" required placeholder="person@example.com" /></label><label className="checkbox-label"><input name="platformAdmin" type="checkbox" /> Platform Admin capability</label><ModalActions onClose={onClose} submitLabel="Create profile" /></form></ModalShell>;
}

export default App;
