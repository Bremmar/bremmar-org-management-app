import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { workspaceApi } from './api';
import { initialWorkspace } from './data';
import {
  agendaSections,
  type Headline,
  type Issue,
  type MeetingSection,
  type Rock,
  type RockStatus,
  type ScorecardMetric,
  type Team,
  type Todo,
  type TodoStatus,
  type ViewId,
  type Workspace,
} from './types';

const people: Record<string, { name: string; initials: string; accent: string }> = {
  'ava-khan': { name: 'Ava Khan', initials: 'AK', accent: '#007E32' },
  'marcus-lee': { name: 'Marcus Lee', initials: 'ML', accent: '#6787b7' },
  'priya-shah': { name: 'Priya Shah', initials: 'PS', accent: '#9c7baf' },
  'daniel-cho': { name: 'Daniel Cho', initials: 'DC', accent: '#4c8f86' },
  'maria-ortiz': { name: 'Maria Ortiz', initials: 'MO', accent: '#d0a15b' },
  'jon-bell': { name: 'Jon Bell', initials: 'JB', accent: '#6b63ad' },
};

const viewLabels: Record<ViewId, string> = {
  overview: 'My week',
  meeting: 'Live L10',
  rocks: 'Rocks',
  todos: 'To-Dos',
  issues: 'Issues',
  scorecard: 'Scorecard',
  admin: 'Admin',
};

const navItems: Array<{ id: ViewId; label: string; icon: string; group?: string }> = [
  { id: 'overview', label: 'My week', icon: '⌂' },
  { id: 'meeting', label: 'Live L10', icon: '◷' },
  { id: 'rocks', label: 'Rocks', icon: '◇', group: 'WORKSPACE' },
  { id: 'todos', label: 'To-Dos', icon: '✓' },
  { id: 'issues', label: 'Issues', icon: '!' },
  { id: 'scorecard', label: 'Scorecard', icon: '◒' },
  { id: 'admin', label: 'Admin', icon: '⚙', group: 'ORGANISATION' },
];

const clone = <T,>(value: T): T => structuredClone(value);

function personFor(id: string) {
  return people[id] ?? { name: 'Unassigned', initials: '?', accent: '#8b96a8' };
}

function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = Math.max(0, seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function statusTone(status: string): 'positive' | 'warning' | 'negative' | 'neutral' | 'blue' {
  if (status === 'on-track' || status === 'complete' || status === 'done' || status === 'solved') return 'positive';
  if (status === 'off-track' || status === 'not-done') return 'negative';
  if (status === 'in-ids') return 'blue';
  return 'warning';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    'on-track': 'On track',
    'off-track': 'Off track',
    complete: 'Complete',
    open: 'Open',
    done: 'Done',
    'not-done': 'Not done',
    'in-ids': 'In IDS',
    solved: 'Solved',
  };
  return labels[status] ?? status;
}

function Avatar({ id, size = 'md' }: { id: string; size?: 'sm' | 'md' | 'lg' }) {
  const person = personFor(id);
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ backgroundColor: person.accent }}
      title={person.name}
      aria-label={person.name}
    >
      {person.initials}
    </span>
  );
}

function AvatarStack({ ids }: { ids: string[] }) {
  return (
    <span className="avatar-stack" aria-label={`${ids.length} attendees`}>
      {ids.slice(0, 4).map((id) => <Avatar key={id} id={id} size="sm" />)}
      {ids.length > 4 && <span className="avatar avatar-sm avatar-more">+{ids.length - 4}</span>}
    </span>
  );
}

function StatusPill({ status, label }: { status: string; label?: string }) {
  return <span className={`status-pill status-${statusTone(status)}`}><span className="status-dot" />{label ?? statusLabel(status)}</span>;
}

function ProgressBar({ value, tone = 'brand' }: { value: number; tone?: 'brand' | 'coral' | 'teal' | 'lavender' }) {
  return <div className={`progress-track progress-${tone}`}><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>;
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className="glyph" aria-hidden="true">{children}</span>;
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() => clone(initialWorkspace));
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [selectedTeamId, setSelectedTeamId] = useState('leadership');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [modal, setModal] = useState<'todo' | 'issue' | null>(null);
  const [meetingSection, setMeetingSection] = useState<MeetingSection>('segue');
  const [meetingRunning, setMeetingRunning] = useState(false);
  const [meetingClosed, setMeetingClosed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(300);

  const activeTeam = workspace.teams.find((team) => team.id === selectedTeamId) ?? workspace.teams[0];
  const teamRocks = useMemo(() => workspace.rocks.filter((rock) => rock.teamId === activeTeam.id), [workspace.rocks, activeTeam.id]);
  const teamTodos = useMemo(() => workspace.todos.filter((todo) => todo.teamId === activeTeam.id), [workspace.todos, activeTeam.id]);
  const teamIssues = useMemo(() => workspace.issues.filter((issue) => issue.teamId === activeTeam.id), [workspace.issues, activeTeam.id]);
  const teamMetrics = useMemo(() => workspace.metrics.filter((metric) => metric.teamId === activeTeam.id), [workspace.metrics, activeTeam.id]);
  const teamHeadlines = useMemo(() => workspace.headlines.filter((headline) => headline.teamId === activeTeam.id), [workspace.headlines, activeTeam.id]);
  const currentMeeting = workspace.meetings.find((meeting) => meeting.teamId === activeTeam.id) ?? workspace.meetings[0];

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
    const section = agendaSections.find((item) => item.id === meetingSection);
    if (section && !meetingRunning) setSecondsLeft(section.duration * 60);
  }, [meetingSection, meetingRunning]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const refresh = async (operation: Promise<Workspace>, message: string) => {
    try {
      setWorkspace(await operation);
      notify(message);
    } catch {
      notify('That update could not be saved. Try again.');
    }
  };

  const updateRock = (rock: Rock) => {
    const nextStatus: RockStatus = rock.status === 'off-track' ? 'on-track' : rock.status === 'on-track' ? 'off-track' : 'on-track';
    void refresh(workspaceApi.updateRockStatus(rock.id, nextStatus), `${rock.title} marked ${statusLabel(nextStatus).toLowerCase()}.`);
  };

  const updateTodo = (todo: Todo, status?: TodoStatus) => {
    const nextStatus = status ?? (todo.status === 'done' ? 'open' : 'done');
    void refresh(workspaceApi.updateTodoStatus(todo.id, nextStatus), `${todo.title} marked ${statusLabel(nextStatus).toLowerCase()}.`);
  };

  const startIssue = (issue: Issue) => {
    void refresh(workspaceApi.startIssue(issue.id), `${issue.title} is ready for IDS.`);
    setMeetingSection('ids');
    setActiveView('meeting');
  };

  const solveIssue = (issue: Issue) => {
    void refresh(workspaceApi.solveIssue(issue.id), `Issue solved. A follow-up To-Do was added.`);
  };

  const flagMetric = (metric: ScorecardMetric) => {
    if (teamIssues.some((issue) => issue.title === `Scorecard: ${metric.label}`)) {
      notify('That metric is already on the Issues list.');
      return;
    }
    void refresh(
      workspaceApi.addIssue({
        title: `Scorecard: ${metric.label}`,
        detail: `${metric.label} is ${metric.actual} against a target of ${metric.target} ${metric.unit}.`,
        category: 'Scorecard',
        teamId: activeTeam.id,
        raisedById: workspace.currentUser.id,
      }),
      'Metric added to the Issues list for IDS.',
    );
  };

  const changeTeam = (teamId: string) => {
    setSelectedTeamId(teamId);
    setMeetingClosed(false);
    setActiveView('overview');
    setSidebarOpen(false);
  };

  const openMeeting = () => {
    setActiveView('meeting');
    setMeetingClosed(false);
    setMeetingSection('segue');
    setMeetingRunning(false);
    setSidebarOpen(false);
  };

  const closeMeeting = () => {
    setMeetingRunning(false);
    setMeetingClosed(true);
    setWorkspace((current) => ({
      ...current,
      meetings: current.meetings.map((meeting) => meeting.id === currentMeeting.id ? { ...meeting, status: 'closed', agendaProgress: 7 } : meeting),
    }));
    notify('Meeting closed. Your recap is saved to history.');
  };

  const handleCreateTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    if (!title) return;
    await refresh(
      workspaceApi.addTodo({
        title,
        dueDate: String(form.get('dueDate') ?? 'Next Monday'),
        ownerId: String(form.get('ownerId') ?? workspace.currentUser.id),
        teamId: activeTeam.id,
      }),
      'New To-Do added to the team workspace.',
    );
    setModal(null);
  };

  const handleCreateIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const detail = String(form.get('detail') ?? '').trim();
    if (!title) return;
    await refresh(
      workspaceApi.addIssue({
        title,
        detail: detail || 'Captured from the team workspace for discussion.',
        category: String(form.get('category') ?? 'General'),
        teamId: activeTeam.id,
        raisedById: workspace.currentUser.id,
      }),
      'Issue added to the list.',
    );
    setModal(null);
  };

  const renderView = () => {
    const common = { workspace, team: activeTeam, onView: setActiveView };
    switch (activeView) {
      case 'meeting':
        return (
          <MeetingView
            {...common}
            rocks={teamRocks}
            todos={teamTodos}
            issues={teamIssues}
            metrics={teamMetrics}
            headlines={teamHeadlines}
            meeting={currentMeeting}
            section={meetingSection}
            secondsLeft={secondsLeft}
            running={meetingRunning}
            closed={meetingClosed}
            onSelectSection={setMeetingSection}
            onToggleRunning={() => setMeetingRunning((running) => !running)}
            onUpdateRock={updateRock}
            onUpdateTodo={updateTodo}
            onStartIssue={startIssue}
            onSolveIssue={solveIssue}
            onFlagMetric={flagMetric}
            onClose={closeMeeting}
          />
        );
      case 'rocks':
        return <RocksView {...common} rocks={teamRocks} onUpdateRock={updateRock} />;
      case 'todos':
        return <TodosView {...common} todos={teamTodos} onUpdateTodo={updateTodo} onAdd={() => setModal('todo')} />;
      case 'issues':
        return <IssuesView {...common} issues={teamIssues} onStartIssue={startIssue} onSolveIssue={solveIssue} onAdd={() => setModal('issue')} />;
      case 'scorecard':
        return <ScorecardView {...common} metrics={teamMetrics} onFlagMetric={flagMetric} />;
      case 'admin':
        return <AdminView {...common} />;
      case 'overview':
      default:
        return (
          <OverviewView
            {...common}
            rocks={teamRocks}
            todos={teamTodos}
            issues={teamIssues}
            metrics={teamMetrics}
            headlines={teamHeadlines}
            meeting={currentMeeting}
            onStartMeeting={openMeeting}
            onUpdateTodo={updateTodo}
            onUpdateRock={updateRock}
            onStartIssue={startIssue}
          />
        );
    }
  };

  return (
    <div className="app-shell">
      <Sidebar activeView={activeView} onView={(view) => { setActiveView(view); setSidebarOpen(false); }} isOpen={isSidebarOpen} />
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen((open) => !open)} aria-label="Toggle navigation"><Glyph>☰</Glyph></button>
          <div className="breadcrumb"><img className="topbar-logo" src="/branding/bremmar-light.png" alt="Bremmar" /><span className="breadcrumb-slash">/</span><strong>{viewLabels[activeView]}</strong></div>
          <div className="topbar-actions">
            <span className="today-chip"><span className="today-dot" /> Monday · Aug 31</span>
            <button className="icon-button notification-button" aria-label="Notifications"><Glyph>◌</Glyph><span className="notification-dot" /></button>
            <Avatar id={workspace.currentUser.id} size="md" />
          </div>
        </header>
        <div className="page-content">
          <div className="workspace-context">
            <div className="team-context">
              <span className="team-context-mark" style={{ backgroundColor: activeTeam.accent }}>{activeTeam.initials}</span>
              <div><span className="context-label">Current workspace</span><strong>{activeTeam.name}</strong></div>
            </div>
            <label className="team-switcher"><span className="sr-only">Choose team</span><select value={selectedTeamId} onChange={(event) => changeTeam(event.target.value)}>{workspace.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><span className="select-arrow">⌄</span></label>
          </div>
          {renderView()}
        </div>
      </main>
      {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
      {modal === 'todo' && <TodoModal team={activeTeam} currentUserId={workspace.currentUser.id} onClose={() => setModal(null)} onSubmit={handleCreateTodo} />}
      {modal === 'issue' && <IssueModal onClose={() => setModal(null)} onSubmit={handleCreateIssue} />}
    </div>
  );
}

function Sidebar({ activeView, onView, isOpen }: { activeView: ViewId; onView: (view: ViewId) => void; isOpen: boolean }) {
  return (
    <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><img className="brand-logo brand-logo-dark" src="/branding/bremmar-dark.png" alt="Bremmar" /></div>
      <div className="sidebar-rule" />
      <div className="sidebar-nav">
        {navItems.map((item) => (
          <div key={item.id}>
            {item.group && <div className="nav-group-label">{item.group}</div>}
            <button className={`nav-item ${activeView === item.id ? 'nav-active' : ''}`} onClick={() => onView(item.id)}><Glyph>{item.icon}</Glyph><span>{item.label}</span>{item.id === 'issues' && <span className="nav-count">3</span>}</button>
          </div>
        ))}
      </div>
      <div className="sidebar-spacer" />
      <div className="quarter-mini"><div className="quarter-mini-top"><span className="nav-group-label">CURRENT QUARTER</span><span className="quarter-mini-badge">Q3</span></div><strong>Make Q3 feel lighter.</strong><div className="mini-progress"><span style={{ width: '67%' }} /></div><span className="quarter-mini-note">31 days remaining</span></div>
      <div className="sidebar-user"><Avatar id="ava-khan" size="md" /><div><strong>Ava Khan</strong><span>Team Lead</span></div><button className="sidebar-more" aria-label="Account options">•••</button></div>
    </aside>
  );
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-header-actions">{actions}</div>}</div>;
}

function Button({ children, variant = 'primary', onClick, type = 'button', className = '', disabled = false }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; onClick?: () => void; type?: 'button' | 'submit'; className?: string; disabled?: boolean }) {
  return <button type={type} className={`button button-${variant} ${className}`} onClick={onClick} disabled={disabled}>{children}</button>;
}

function OverviewView({
  workspace,
  team,
  rocks,
  todos,
  issues,
  metrics,
  headlines,
  meeting,
  onStartMeeting,
  onUpdateTodo,
  onUpdateRock,
  onStartIssue,
  onView,
}: {
  workspace: Workspace;
  team: Team;
  rocks: Rock[];
  todos: Todo[];
  issues: Issue[];
  metrics: ScorecardMetric[];
  headlines: Headline[];
  meeting: Workspace['meetings'][number];
  onStartMeeting: () => void;
  onUpdateTodo: (todo: Todo, status?: TodoStatus) => void;
  onUpdateRock: (rock: Rock) => void;
  onStartIssue: (issue: Issue) => void;
  onView: (view: ViewId) => void;
}) {
  const openTodos = todos.filter((todo) => todo.status !== 'done');
  const mine = openTodos.filter((todo) => todo.ownerId === workspace.currentUser.id);
  const onTrackRocks = rocks.filter((rock) => rock.status === 'on-track' || rock.status === 'complete').length;
  const completedTodos = todos.filter((todo) => todo.status === 'done').length;
  const activeIssues = issues.filter((issue) => issue.status !== 'solved');
  const offTrackMetrics = metrics.filter((metric) => metric.status === 'off-track').length;

  return <>
    <PageHeader eyebrow="MONDAY, AUGUST 31, 2026 · WEEK 35" title={`Good morning, ${workspace.currentUser.name.split(' ')[0]}.`} description="Here’s what needs your attention before the team meets." actions={<><Button variant="secondary" onClick={() => onView('issues')}>Review Issues <span className="button-arrow">↗</span></Button><Button onClick={onStartMeeting}>Start L10 <span className="button-arrow">→</span></Button></>} />
    <section className="overview-top-grid">
      <article className="quarter-hero card-surface">
        <div className="quarter-hero-glow" />
        <div className="hero-content"><div className="eyebrow eyebrow-light">{workspace.quarter.label} · OPERATING RHYTHM</div><h2>{workspace.quarter.theme}</h2><p>One quarter. Fewer priorities. More traction.</p><div className="hero-progress"><div className="progress-label"><span>Quarter progress</span><strong>67%</strong></div><ProgressBar value={67} tone="brand" /></div><div className="hero-foot"><span><span className="live-dot" /> {workspace.quarter.daysRemaining} days remaining</span><span>Jul 01 — Sep 30</span></div></div>
        <div className="hero-rings" aria-hidden="true"><span /><span /><span /></div>
      </article>
      <article className="next-meeting-card card-surface">
        <div className="card-topline"><span className="card-kicker"><span className="meeting-live-dot" /> NEXT MEETING</span><span className="card-menu">•••</span></div><h3>{meeting.label}</h3><div className="meeting-time"><span className="calendar-icon">▣</span><div><strong>{meeting.dateLabel}</strong><span>{team.memberCount} people · 90 minutes</span></div></div><div className="meeting-card-footer"><AvatarStack ids={meeting.attendeeIds} /><Button variant="quiet" onClick={onStartMeeting}>Open agenda <span className="button-arrow">→</span></Button></div>
      </article>
    </section>
    <section className="stat-grid">
      <button className="stat-card card-surface" onClick={() => onView('rocks')}><div className="stat-card-head"><span className="stat-icon stat-icon-brand">◇</span><span className="stat-trend positive-text">+1 this week</span></div><strong className="stat-number">{onTrackRocks}<small>/{rocks.length}</small></strong><span className="stat-label">Rocks on track</span><ProgressBar value={rocks.length ? onTrackRocks / rocks.length * 100 : 0} tone="brand" /></button>
      <button className="stat-card card-surface" onClick={() => onView('todos')}><div className="stat-card-head"><span className="stat-icon stat-icon-teal">✓</span><span className="stat-trend positive-text">{completedTodos ? '90%' : '0%'} completion</span></div><strong className="stat-number">{completedTodos}<small>/{todos.length}</small></strong><span className="stat-label">To-Dos complete</span><ProgressBar value={todos.length ? completedTodos / todos.length * 100 : 0} tone="teal" /></button>
      <button className="stat-card card-surface" onClick={() => onView('issues')}><div className="stat-card-head"><span className="stat-icon stat-icon-lavender">!</span><span className="stat-trend warning-text">{offTrackMetrics ? `${offTrackMetrics} scorecard flag` : 'All metrics clear'}</span></div><strong className="stat-number">{activeIssues.length}<small> active</small></strong><span className="stat-label">Issues to solve</span><div className="issue-dots"><span /><span /><span /><span className="dot-muted" /></div></button>
    </section>
    <section className="content-grid overview-content-grid">
      <div className="main-column">
        <div className="section-heading"><div><span className="section-kicker">ACCOUNTABILITY</span><h2>Your week</h2></div><button className="text-button" onClick={() => onView('todos')}>View all To-Dos <span>→</span></button></div>
        <div className="commitment-card card-surface">
          <div className="commitment-card-head"><div><h3>My commitments</h3><p>{mine.length} open items need your attention</p></div><span className="completion-ring"><strong>{mine.filter((todo) => todo.status === 'done').length}</strong><small>/ {mine.length}</small></span></div>
          <div className="todo-list">{mine.slice(0, 4).map((todo) => <TodoRow key={todo.id} todo={todo} onToggle={() => onUpdateTodo(todo)} />)}</div>
          {mine.length === 0 && <EmptyState title="A clear week" detail="You have no open To-Dos assigned to you." />}
        </div>
        <div className="section-heading section-heading-spaced"><div><span className="section-kicker">QUARTERLY PRIORITIES</span><h2>Rocks to watch</h2></div><button className="text-button" onClick={() => onView('rocks')}>Open Rock sheet <span>→</span></button></div>
        <div className="rocks-watch-card card-surface">{rocks.filter((rock) => rock.status !== 'complete').slice(0, 3).map((rock) => <RockRow key={rock.id} rock={rock} onUpdate={() => onUpdateRock(rock)} />)}</div>
      </div>
      <div className="side-column">
        <div className="section-heading"><div><span className="section-kicker">TEAM PULSE</span><h2>At a glance</h2></div><span className="pulse-date">Week 35</span></div>
        <div className="pulse-card card-surface"><div className="pulse-score"><span className="pulse-score-number">8.8</span><span className="pulse-score-label">last meeting rating</span><span className="pulse-score-trend">↑ 0.6 from last week</span></div><div className="pulse-bars"><PulseBar label="Rocks" value={onTrackRocks / Math.max(1, rocks.length) * 100} color="brand" /><PulseBar label="To-Dos" value={completedTodos / Math.max(1, todos.length) * 100} color="teal" /><PulseBar label="Scorecard" value={(metrics.length - offTrackMetrics) / Math.max(1, metrics.length) * 100} color="lavender" /></div><div className="pulse-footer"><span><span className="pulse-check">✓</span> Team is preparing</span><button className="icon-link" onClick={() => onView('scorecard')} aria-label="Open scorecard">↗</button></div></div>
        <div className="section-heading section-heading-spaced"><div><span className="section-kicker">IDS QUEUE</span><h2>Top issues</h2></div><button className="text-button" onClick={() => onView('issues')}>See all <span>→</span></button></div>
        <div className="issues-preview card-surface">{activeIssues.slice(0, 3).map((issue) => <IssuePreview key={issue.id} issue={issue} onClick={() => onStartIssue(issue)} />)}</div>
        <div className="headline-card"><div className="headline-accent" /><div><span className="section-kicker">LATEST HEADLINE</span><h3>{headlines[0]?.title ?? 'No headlines yet'}</h3><p>{headlines[0]?.detail ?? 'Add a customer or employee headline before the next meeting.'}</p><span className="headline-author"><Avatar id={headlines[0]?.authorId ?? workspace.currentUser.id} size="sm" /> {headlines[0] ? personFor(headlines[0].authorId).name : 'Your team'}</span></div></div>
      </div>
    </section>
  </>;
}

function TodoRow({ todo, onToggle }: { todo: Todo; onToggle: () => void }) {
  return <div className={`todo-row ${todo.status === 'done' ? 'todo-done' : ''}`}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={onToggle} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><div className="todo-row-copy"><strong>{todo.title}</strong><span>{todo.origin}</span></div><div className="todo-row-meta"><Avatar id={todo.ownerId} size="sm" /><span className={`due-label ${todo.status === 'not-done' ? 'due-overdue' : ''}`}>{todo.dueDate}</span></div></div>;
}

function RockRow({ rock, onUpdate }: { rock: Rock; onUpdate: () => void }) {
  return <div className="rock-row"><div className="rock-row-main"><div className="rock-title-line"><span className={`priority-marker priority-${rock.priority}`} /> <strong>{rock.title}</strong><StatusPill status={rock.status} /></div><div className="rock-row-progress"><ProgressBar value={rock.progress} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{rock.progress}% · {rock.milestonesDone}/{rock.milestonesTotal} milestones</span></div></div><div className="rock-row-owner"><Avatar id={rock.ownerId} size="sm" /><span>{personFor(rock.ownerId).name.split(' ')[0]}</span><button className="row-action" onClick={onUpdate}>{rock.status === 'off-track' ? 'Recover' : 'Update'} <span>→</span></button></div></div>;
}

function PulseBar({ label, value, color }: { label: string; value: number; color: 'brand' | 'coral' | 'teal' | 'lavender' }) {
  return <div className="pulse-bar"><div><span>{label}</span><strong>{Math.round(value)}%</strong></div><ProgressBar value={value} tone={color} /></div>;
}

function IssuePreview({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  return <button className="issue-preview-row" onClick={onClick}><span className="issue-number">{issue.priority.toString().padStart(2, '0')}</span><span className="issue-preview-copy"><strong>{issue.title}</strong><span>{issue.age} · {issue.category}</span></span><span className="issue-chevron">›</span></button>;
}

function MeetingView({
  workspace,
  team,
  rocks,
  todos,
  issues,
  metrics,
  headlines,
  meeting,
  section,
  secondsLeft,
  running,
  closed,
  onSelectSection,
  onToggleRunning,
  onUpdateRock,
  onUpdateTodo,
  onStartIssue,
  onSolveIssue,
  onFlagMetric,
  onClose,
  onView,
}: {
  workspace: Workspace;
  team: Team;
  rocks: Rock[];
  todos: Todo[];
  issues: Issue[];
  metrics: ScorecardMetric[];
  headlines: Headline[];
  meeting: Workspace['meetings'][number];
  section: MeetingSection;
  secondsLeft: number;
  running: boolean;
  closed: boolean;
  onSelectSection: (section: MeetingSection) => void;
  onToggleRunning: () => void;
  onUpdateRock: (rock: Rock) => void;
  onUpdateTodo: (todo: Todo, status?: TodoStatus) => void;
  onStartIssue: (issue: Issue) => void;
  onSolveIssue: (issue: Issue) => void;
  onFlagMetric: (metric: ScorecardMetric) => void;
  onClose: () => void;
  onView: (view: ViewId) => void;
}) {
  const activeIndex = agendaSections.findIndex((item) => item.id === section);
  const activeSection = agendaSections[activeIndex];
  const idsIssues = issues.filter((issue) => issue.status !== 'solved');
  const [focusedIssueId, setFocusedIssueId] = useState(idsIssues[0]?.id);
  const focusedIssue = idsIssues.find((issue) => issue.id === focusedIssueId) ?? idsIssues[0];

  const goNext = () => {
    const next = agendaSections[Math.min(agendaSections.length - 1, activeIndex + 1)];
    if (next) onSelectSection(next.id);
  };

  return <>
    <div className="meeting-page-header"><div><div className="eyebrow">{team.name.toUpperCase()} · {workspace.quarter.label}</div><h1>{closed ? 'Meeting complete.' : 'Run the room.'}</h1><p>{closed ? 'The meeting record is saved. The team can now execute the recap.' : 'Keep the reporting crisp. Put the real work where it belongs: IDS.'}</p></div><div className="meeting-header-actions"><div className={`meeting-status ${closed ? 'meeting-status-closed' : ''}`}><span className="meeting-status-dot" /> {closed ? 'Closed' : running ? 'In progress' : 'Ready to start'}</div><Button variant="secondary" onClick={() => onView('overview')}>Exit meeting</Button></div></div>
    <div className="meeting-workspace">
      <aside className="agenda-rail card-surface"><div className="agenda-rail-head"><div><span className="section-kicker">WEEKLY RHYTHM</span><h2>{meeting.label}</h2></div><span className="agenda-date">Aug 31</span></div><div className="agenda-list">{agendaSections.map((item, index) => <button key={item.id} className={`agenda-item ${item.id === section ? 'agenda-item-active' : ''} ${index < activeIndex || closed ? 'agenda-item-done' : ''}`} onClick={() => onSelectSection(item.id)}><span className="agenda-index">{index < activeIndex || closed ? '✓' : (index + 1).toString().padStart(2, '0')}</span><span className="agenda-item-copy"><strong>{item.shortLabel}</strong><small>{item.duration} min</small></span>{item.id === section && !closed && <span className="agenda-current-dot" />}</button>)}</div><div className="agenda-rail-bottom"><span className="section-kicker">ATTENDEES</span><div className="attendee-line"><AvatarStack ids={meeting.attendeeIds} /><span>{meeting.attendeeIds.length} of {team.memberCount} here</span></div><div className="agenda-tip"><span className="tip-icon">✦</span><p><strong>Facilitator note</strong>Keep updates to one sentence. Drop anything that needs a conversation into IDS.</p></div></div></aside>
      <section className="meeting-stage card-surface"><div className="meeting-stage-toolbar"><div className="stage-location"><span className="stage-number">{(activeIndex + 1).toString().padStart(2, '0')}</span><div><span className="section-kicker">CURRENT SECTION</span><strong>{activeSection.label}</strong></div></div><div className="meeting-timer"><span className="timer-label">SECTION TIME</span><strong className={secondsLeft < 60 ? 'timer-warning' : ''}>{formatClock(secondsLeft)}</strong><button className={`timer-toggle ${running ? 'timer-pause' : ''}`} onClick={onToggleRunning} aria-label={running ? 'Pause timer' : 'Start timer'}>{running ? 'Ⅱ' : '▶'}</button></div></div>
        <div className="meeting-stage-body">
          {section === 'segue' && <SegueSection onStart={onToggleRunning} running={running} />}
          {section === 'scorecard' && <MeetingScorecard metrics={metrics} onFlag={onFlagMetric} />}
          {section === 'rock-review' && <MeetingRocks rocks={rocks} onUpdate={onUpdateRock} />}
          {section === 'headlines' && <MeetingHeadlines headlines={headlines} />}
          {section === 'todo-review' && <MeetingTodos todos={todos} onUpdate={onUpdateTodo} />}
          {section === 'ids' && <MeetingIds issues={idsIssues} focusedIssue={focusedIssue} onFocus={setFocusedIssueId} onStart={onStartIssue} onSolve={onSolveIssue} />}
          {section === 'conclude' && <ConcludeSection todos={todos} issues={issues} meeting={meeting} onClose={onClose} closed={closed} />}
        </div>
        <div className="meeting-stage-footer"><button className="footer-nav-button" disabled={activeIndex === 0} onClick={() => onSelectSection(agendaSections[Math.max(0, activeIndex - 1)].id)}>← Previous</button><div className="footer-progress"><span>{closed ? 7 : activeIndex + 1} of 7 sections</span><div className="footer-progress-track"><span style={{ width: `${closed ? 100 : ((activeIndex + 1) / 7) * 100}%` }} /></div></div><button className="footer-nav-button footer-nav-next" disabled={activeIndex === agendaSections.length - 1} onClick={goNext}>Next section <span>→</span></button></div>
      </section>
    </div>
  </>;
}

function SegueSection({ onStart, running }: { onStart: () => void; running: boolean }) {
  return <div className="meeting-intro"><div className="intro-orbit"><span>✦</span></div><span className="section-kicker">SECTION 01 · 5 MINUTES</span><h2>Arrive as a team.</h2><p>Take a breath, share one personal and one professional good news, then get ready to make this meeting a 10.</p><div className="check-in-grid"><div><span className="check-in-icon">☀</span><strong>Personal</strong><span>How are you arriving?</span></div><div><span className="check-in-icon">↗</span><strong>Professional</strong><span>What’s moving forward?</span></div><div><span className="check-in-icon">◎</span><strong>Focus</strong><span>What needs the room?</span></div></div><Button variant="secondary" onClick={onStart}>{running ? 'Pause section timer' : 'Start segue timer'} <span className="button-arrow">→</span></Button></div>;
}

function MeetingScorecard({ metrics, onFlag }: { metrics: ScorecardMetric[]; onFlag: (metric: ScorecardMetric) => void }) {
  return <div className="meeting-section-content"><div className="section-intro-row"><div><span className="section-kicker">SECTION 02 · 5 MINUTES</span><h2>Are the numbers telling us something?</h2><p>Report the number, call it on or off track, and keep moving. The conversation belongs in IDS.</p></div><span className="rule-note">No discussion here</span></div><div className="metric-table meeting-metric-table">{metrics.map((metric) => <div className="metric-row" key={metric.id}><div className="metric-name"><span className={`metric-status-dot metric-${metric.status}`} /><strong>{metric.label}</strong><small>{personFor(metric.ownerId).name}</small></div><div className="metric-values"><span className="metric-target">Target <strong>{metric.target}</strong></span><span className="metric-actual">Actual <strong>{metric.actual}</strong></span></div><StatusPill status={metric.status} /><button className="row-action row-action-small" onClick={() => onFlag(metric)}>Flag for IDS</button></div>)}</div></div>;
}

function MeetingRocks({ rocks, onUpdate }: { rocks: Rock[]; onUpdate: (rock: Rock) => void }) {
  return <div className="meeting-section-content"><div className="section-intro-row"><div><span className="section-kicker">SECTION 03 · 5 MINUTES</span><h2>Are we moving the quarter?</h2><p>Each owner calls their Rock on track or off track. No explanations—just visibility.</p></div><span className="rule-note">One call each</span></div><div className="meeting-rock-list">{rocks.map((rock) => <div className="meeting-rock-row" key={rock.id}><div className="meeting-rock-info"><div className="rock-title-line"><span className={`priority-marker priority-${rock.priority}`} /><strong>{rock.title}</strong></div><span><Avatar id={rock.ownerId} size="sm" /> {personFor(rock.ownerId).name}</span></div><div className="meeting-rock-progress"><ProgressBar value={rock.progress} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><span>{rock.progress}%</span></div><button className={`quick-status-button ${rock.status}`} onClick={() => onUpdate(rock)}><span className="status-dot" />{statusLabel(rock.status)}</button></div>)}</div></div>;
}

function MeetingHeadlines({ headlines }: { headlines: Headline[] }) {
  return <div className="meeting-section-content"><div className="section-intro-row"><div><span className="section-kicker">SECTION 04 · 5 MINUTES</span><h2>What should the team know?</h2><p>Celebrate the wins. Name the concerns. If it needs a discussion, drop it into IDS.</p></div><span className="rule-note">Keep it short</span></div><div className="headline-meeting-grid">{headlines.map((headline) => <div className={`headline-meeting-card ${headline.type === 'concern' ? 'headline-concern' : ''}`} key={headline.id}><div className="headline-card-label"><span className="headline-type-icon">{headline.type === 'win' ? '✦' : '!'}</span>{headline.type === 'win' ? 'Win' : 'Concern'}<span className="headline-time">{headline.createdAt}</span></div><h3>{headline.title}</h3><p>{headline.detail}</p><span className="headline-author"><Avatar id={headline.authorId} size="sm" /> {personFor(headline.authorId).name}</span></div>)}</div></div>;
}

function MeetingTodos({ todos, onUpdate }: { todos: Todo[]; onUpdate: (todo: Todo, status?: TodoStatus) => void }) {
  const done = todos.filter((todo) => todo.status === 'done').length;
  return <div className="meeting-section-content"><div className="section-intro-row"><div><span className="section-kicker">SECTION 05 · 5 MINUTES</span><h2>Did we do what we said?</h2><p>Seven-day commitments are either done or not done. No stories required.</p></div><span className="completion-callout"><strong>{done}/{todos.length}</strong> done</span></div><div className="meeting-todo-list">{todos.map((todo) => <div className={`meeting-todo-row ${todo.status === 'done' ? 'todo-done' : ''}`} key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdate(todo)} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><div className="meeting-todo-copy"><strong>{todo.title}</strong><span>{todo.origin}</span></div><Avatar id={todo.ownerId} size="sm" /><span className={`due-label ${todo.status === 'not-done' ? 'due-overdue' : ''}`}>{todo.status === 'done' ? 'Complete' : todo.dueDate}</span></div>)}</div></div>;
}

function MeetingIds({ issues, focusedIssue, onFocus, onStart, onSolve }: { issues: Issue[]; focusedIssue?: Issue; onFocus: (id: string) => void; onStart: (issue: Issue) => void; onSolve: (issue: Issue) => void }) {
  return <div className="meeting-section-content ids-meeting-content"><div className="section-intro-row"><div><span className="section-kicker">SECTION 06 · 60 MINUTES</span><h2>Identify. Discuss. Solve.</h2><p>Work the highest-value issue until the team has a clear decision and accountable next steps.</p></div><span className="ids-counter"><strong>{issues.filter((issue) => issue.status === 'solved').length}</strong> / {issues.length} solved</span></div><div className="ids-workbench"><div className="ids-queue">{issues.map((issue) => <button key={issue.id} className={`ids-queue-item ${focusedIssue?.id === issue.id ? 'ids-queue-selected' : ''}`} onClick={() => onFocus(issue.id)}><span className="issue-number">{issue.priority.toString().padStart(2, '0')}</span><span><strong>{issue.title}</strong><small>{issue.category} · {issue.age}</small></span>{issue.status === 'in-ids' && <span className="ids-now">Now</span>}</button>)}{issues.length === 0 && <EmptyState title="No open Issues" detail="Capture the next thing that needs solving." />}</div><div className="ids-focus-panel">{focusedIssue ? <><div className="focus-panel-top"><span className="status-pill status-blue"><span className="status-dot" />{focusedIssue.status === 'in-ids' ? 'In discussion' : 'Next up'}</span><span className="focus-category">{focusedIssue.category}</span></div><h3>{focusedIssue.title}</h3><p>{focusedIssue.detail}</p><div className="ids-note-box"><span className="note-label">FACILITATOR NOTE</span><strong>{focusedIssue.idsNote ?? 'Name the root issue before jumping to the solution.'}</strong></div><div className="focus-meta"><span><Avatar id={focusedIssue.raisedById} size="sm" /> Raised by {personFor(focusedIssue.raisedById).name}</span><span>{focusedIssue.age} open</span></div><div className="focus-actions"><Button variant="secondary" onClick={() => onStart(focusedIssue)}>{focusedIssue.status === 'in-ids' ? 'Keep in IDS' : 'Start IDS'} <span className="button-arrow">→</span></Button><Button onClick={() => onSolve(focusedIssue)}>Mark solved <span className="button-arrow">✓</span></Button></div></> : <div className="empty-focus"><span>!</span><h3>Choose an Issue to work</h3><p>Start with the most important problem, not the easiest one.</p></div>}</div></div></div>;
}

function ConcludeSection({ todos, issues, meeting, onClose, closed }: { todos: Todo[]; issues: Issue[]; meeting: Workspace['meetings'][number]; onClose: () => void; closed: boolean }) {
  const openTodos = todos.filter((todo) => todo.status !== 'done').length;
  const activeIssues = issues.filter((issue) => issue.status !== 'solved').length;
  return <div className="meeting-section-content conclude-content"><div className="conclude-symbol">✦</div><span className="section-kicker">SECTION 07 · 5 MINUTES</span><h2>Leave with clarity.</h2><p>Recap the commitments, decide what needs to cascade, and rate the meeting honestly.</p><div className="conclude-grid"><div className="conclude-summary"><span className="summary-icon">✓</span><strong>{openTodos} open To-Dos</strong><span>Each needs an owner and a date</span></div><div className="conclude-summary"><span className="summary-icon">!</span><strong>{activeIssues} Issues remain</strong><span>Keep them visible for next week</span></div><div className="conclude-summary"><span className="summary-icon">↗</span><strong>{meeting.lastRating} last rating</strong><span>How did this meeting feel?</span></div></div><div className="rating-strip"><span className="section-kicker">RATE THIS MEETING</span><div className="rating-options">{[7, 8, 9, 10].map((rating) => <button key={rating} className={rating === 9 ? 'rating-selected' : ''}>{rating}</button>)}</div><span className="rating-caption">Aim for an honest 8 or better.</span></div><Button onClick={onClose} disabled={closed}>{closed ? 'Meeting record saved ✓' : 'Save & close meeting'} <span className="button-arrow">→</span></Button></div>;
}

function RocksView({ workspace, team, rocks, onUpdateRock, onView }: { workspace: Workspace; team: Team; rocks: Rock[]; onUpdateRock: (rock: Rock) => void; onView: (view: ViewId) => void }) {
  const firstActionableRock = rocks.find((rock) => rock.status !== 'complete');
  const completed = rocks.filter((rock) => rock.status === 'complete').length;
  return <><PageHeader eyebrow={`${workspace.quarter.label} · ROCK SHEET`} title="The few things that matter." description={`${team.name} has ${rocks.length} Rocks this quarter. Keep them visible, owned, and honest.`} actions={<><Button variant="secondary" onClick={() => onView('overview')}>← My week</Button><Button onClick={() => firstActionableRock && onUpdateRock(firstActionableRock)} disabled={!firstActionableRock}>Update a Rock <span className="button-arrow">→</span></Button></>} /><div className="rocks-summary-strip card-surface"><div><span className="section-kicker">QUARTER HEALTH</span><strong>{completed}/{rocks.length}</strong><span>Rocks complete</span></div><div className="summary-divider" /><div><span className="section-kicker">ON TRACK</span><strong>{rocks.filter((rock) => rock.status === 'on-track').length}</strong><span>with a clear path</span></div><div className="summary-divider" /><div><span className="section-kicker">ATTENTION</span><strong className="negative-text">{rocks.filter((rock) => rock.status === 'off-track').length}</strong><span>need a conversation</span></div><div className="rocks-summary-progress"><div className="progress-label"><span>Average progress</span><strong>{Math.round(rocks.reduce((sum, rock) => sum + rock.progress, 0) / Math.max(1, rocks.length))}%</strong></div><ProgressBar value={rocks.reduce((sum, rock) => sum + rock.progress, 0) / Math.max(1, rocks.length)} tone="brand" /></div></div><div className="rocks-page-grid"><div className="rock-sheet-list">{rocks.map((rock, index) => <article className={`rock-card card-surface ${rock.status === 'off-track' ? 'rock-card-alert' : ''}`} key={rock.id}><div className="rock-card-top"><span className="rock-card-number">0{index + 1}</span><StatusPill status={rock.status} /><span className="rock-card-menu">•••</span></div><h2>{rock.title}</h2><p>{rock.description}</p><div className="rock-card-progress"><div className="progress-label"><span>Progress</span><strong>{rock.progress}%</strong></div><ProgressBar value={rock.progress} tone={rock.status === 'off-track' ? 'coral' : 'teal'} /><div className="rock-card-milestones"><span>{rock.milestonesDone} of {rock.milestonesTotal} milestones complete</span><span>Due {rock.dueDate}</span></div></div><div className="rock-card-footer"><span><Avatar id={rock.ownerId} size="sm" /> <strong>{personFor(rock.ownerId).name}</strong></span><button className="row-action" onClick={() => onUpdateRock(rock)}>{rock.status === 'off-track' ? 'Mark on track' : rock.status === 'complete' ? 'Reopen' : 'Update status'} <span>→</span></button></div></article>)}</div><aside className="rock-guidance card-surface"><span className="guidance-orbit">✦</span><span className="section-kicker">ROCK DISCIPLINE</span><h2>Less is the strategy.</h2><p>Rocks are the most important things to accomplish this quarter. If everything is a priority, nothing is.</p><div className="guidance-list"><div><span>01</span><strong>Own the outcome</strong><p>One accountable owner keeps the work moving.</p></div><div><span>02</span><strong>Call it early</strong><p>Off track in week three is useful information.</p></div><div><span>03</span><strong>Make it measurable</strong><p>Use milestones to show whether the Rock is moving.</p></div></div></aside></div></>;
}

function TodosView({ workspace, team, todos, onUpdateTodo, onAdd, onView }: { workspace: Workspace; team: Team; todos: Todo[]; onUpdateTodo: (todo: Todo, status?: TodoStatus) => void; onAdd: () => void; onView: (view: ViewId) => void }) {
  const done = todos.filter((todo) => todo.status === 'done').length;
  const mine = todos.filter((todo) => todo.ownerId === workspace.currentUser.id).length;
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · WEEKLY COMMITMENTS`} title="Promises for the next seven days." description="To-Dos are small enough to finish, clear enough to own, and visible enough to keep." actions={<><Button variant="secondary" onClick={() => onView('meeting')}>Open L10 agenda</Button><Button onClick={onAdd}>Add To-Do <span className="button-arrow">＋</span></Button></>} /><div className="todo-summary-grid"><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-teal">✓</span><div><strong>{done}/{todos.length}</strong><span>complete this week</span></div><ProgressBar value={done / Math.max(1, todos.length) * 100} tone="teal" /></div><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-coral">◷</span><div><strong>{todos.filter((todo) => todo.status !== 'done').length}</strong><span>still open</span></div><span className="summary-help">Keep them moving before the next L10.</span></div><div className="todo-summary-card card-surface"><span className="summary-icon summary-icon-lavender">AK</span><div><strong>{mine}</strong><span>assigned to you</span></div><span className="summary-help">Your visible commitments.</span></div></div><div className="table-card card-surface"><div className="table-card-header"><div><span className="section-kicker">CURRENT WEEK · AUG 31 — SEP 06</span><h2>Team To-Dos</h2></div><div className="table-filters"><button className="filter-chip filter-chip-active">All To-Dos <span>{todos.length}</span></button><button className="filter-chip">Open</button><button className="filter-chip">Mine</button></div></div><div className="todo-table"><div className="table-header"><span>COMMITMENT</span><span>OWNER</span><span>ORIGIN</span><span>DUE</span><span>STATUS</span></div>{todos.map((todo) => <div className="table-row" key={todo.id}><button className={`todo-checkbox ${todo.status === 'done' ? 'checked' : ''}`} onClick={() => onUpdateTodo(todo)} aria-label={`Mark ${todo.title} ${todo.status === 'done' ? 'open' : 'done'}`}>{todo.status === 'done' ? '✓' : ''}</button><div className={`table-primary ${todo.status === 'done' ? 'todo-done' : ''}`}><strong>{todo.title}</strong><small>{todo.isMine ? 'Your commitment' : 'Team commitment'}</small></div><span className="table-person"><Avatar id={todo.ownerId} size="sm" />{personFor(todo.ownerId).name}</span><span className="table-origin">{todo.origin}</span><span className={`table-due ${todo.status === 'not-done' ? 'due-overdue' : ''}`}>{todo.dueDate}</span><StatusPill status={todo.status} /></div>)}</div></div></>;
}

function IssuesView({ workspace, team, issues, onStartIssue, onSolveIssue, onAdd, onView }: { workspace: Workspace; team: Team; issues: Issue[]; onStartIssue: (issue: Issue) => void; onSolveIssue: (issue: Issue) => void; onAdd: () => void; onView: (view: ViewId) => void }) {
  const openIssues = issues.filter((issue) => issue.status !== 'solved');
  const [selectedId, setSelectedId] = useState(openIssues[0]?.id ?? issues[0]?.id);
  const selectedIssue = issues.find((issue) => issue.id === selectedId) ?? openIssues[0];
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · IDS WORKBENCH`} title="Solve the right problem." description="Capture the issue when it appears. Use the meeting to get underneath it. Leave with a decision." actions={<><Button variant="secondary" onClick={() => onView('meeting')}>Open live IDS</Button><Button onClick={onAdd}>Capture Issue <span className="button-arrow">＋</span></Button></>} /><div className="issues-stat-row"><div><span className="section-kicker">OPEN ISSUES</span><strong>{openIssues.length}</strong><span>visible to the team</span></div><div><span className="section-kicker">IN IDS</span><strong className="blue-text">{issues.filter((issue) => issue.status === 'in-ids').length}</strong><span>being worked now</span></div><div><span className="section-kicker">SOLVED THIS QUARTER</span><strong className="positive-text">{issues.filter((issue) => issue.status === 'solved').length}</strong><span>removed from the list</span></div><div className="issues-stat-note"><span>⌁</span><p>Most recurring issues are symptoms. Keep asking “what’s the real issue?”</p></div></div><div className="issues-workbench card-surface"><div className="issues-list-panel"><div className="workbench-panel-head"><div><span className="section-kicker">PRIORITY ORDER</span><h2>Issues list</h2></div><span className="sort-label">Oldest first ˅</span></div>{issues.map((issue) => <button className={`workbench-issue-row ${selectedIssue?.id === issue.id ? 'workbench-issue-selected' : ''} ${issue.status === 'solved' ? 'workbench-issue-solved' : ''}`} key={issue.id} onClick={() => setSelectedId(issue.id)}><span className="issue-number">{issue.priority.toString().padStart(2, '0')}</span><span className="workbench-issue-copy"><strong>{issue.title}</strong><small>{issue.category} · {issue.age}</small></span><StatusPill status={issue.status} /></button>)}</div><div className="issue-detail-panel">{selectedIssue ? <><div className="detail-panel-head"><StatusPill status={selectedIssue.status} /><span className="detail-category">{selectedIssue.category}</span><button className="icon-button" aria-label="More issue options">•••</button></div><h2>{selectedIssue.title}</h2><p className="issue-detail-copy">{selectedIssue.detail}</p>{selectedIssue.linkedRockId && <div className="linked-record"><span>Linked Rock</span><strong>{workspace.rocks.find((rock) => rock.id === selectedIssue.linkedRockId)?.title ?? 'Quarterly priority'}</strong><span>↗</span></div>}<div className="issue-detail-note"><span className="section-kicker">IDS PROMPT</span><p>{selectedIssue.idsNote ?? 'What is the decision this team needs to make?'}</p></div><div className="issue-detail-meta"><span><Avatar id={selectedIssue.raisedById} size="sm" /> Raised by {personFor(selectedIssue.raisedById).name}</span><span>Open for {selectedIssue.age}</span></div>{selectedIssue.status !== 'solved' ? <div className="detail-actions"><Button variant="secondary" onClick={() => onStartIssue(selectedIssue)}>{selectedIssue.status === 'in-ids' ? 'Continue in IDS' : 'Start IDS'} <span className="button-arrow">→</span></Button><Button onClick={() => onSolveIssue(selectedIssue)}>Mark solved <span className="button-arrow">✓</span></Button></div> : <div className="solved-banner"><span>✓</span><div><strong>Solved and removed from the active list</strong><small>The decision is preserved in meeting history.</small></div></div>}</> : <EmptyState title="Choose an Issue" detail="Select an item from the list to see its context." />}</div></div></>;
}

function ScorecardView({ workspace, team, metrics, onFlagMetric, onView }: { workspace: Workspace; team: Team; metrics: ScorecardMetric[]; onFlagMetric: (metric: ScorecardMetric) => void; onView: (view: ViewId) => void }) {
  const onTrack = metrics.filter((metric) => metric.status === 'on-track').length;
  return <><PageHeader eyebrow={`${team.name.toUpperCase()} · WEEKLY NUMBERS`} title="Let the numbers speak." description="The Scorecard is an early-warning system, not a reporting ceremony." actions={<><Button variant="secondary" onClick={() => onView('meeting')}>Use in L10</Button><Button onClick={() => onView('admin')}>Manage measurables <span className="button-arrow">→</span></Button></>} /><div className="scorecard-hero card-surface"><div><span className="section-kicker">WEEK 35 · AUG 24 — AUG 30</span><h2>{onTrack} of {metrics.length} measurables are on track.</h2><p>One number is asking for the room’s attention. Capture it as an Issue when you’re ready.</p></div><div className="scorecard-orbit"><span>{Math.round(onTrack / Math.max(1, metrics.length) * 100)}%</span><small>healthy</small></div></div><div className="scorecard-layout"><div className="metric-table card-surface"><div className="metric-table-head"><div><span className="section-kicker">TEAM SCORECARD</span><h2>Weekly measurables</h2></div><span className="last-updated">Updated today · 8:30 AM</span></div>{metrics.map((metric) => <div className="metric-row scorecard-metric-row" key={metric.id}><div className="metric-name"><span className={`metric-status-dot metric-${metric.status}`} /><strong>{metric.label}</strong><small><Avatar id={metric.ownerId} size="sm" /> {personFor(metric.ownerId).name}</small></div><div className="metric-values"><span className="metric-target">Target <strong>{metric.target}</strong> <small>{metric.unit}</small></span><span className="metric-actual">Actual <strong>{metric.actual}</strong> <small>{metric.unit}</small></span></div><div className="metric-trend"><span className={`trend-arrow trend-${metric.trend}`}>{metric.trend === 'up' ? '↗' : metric.trend === 'down' ? '↘' : '→'}</span><span>{metric.trendLabel}</span></div><StatusPill status={metric.status} />{metric.status === 'off-track' && <button className="row-action row-action-small" onClick={() => onFlagMetric(metric)}>Add to IDS</button>}</div>)}</div><aside className="scorecard-side card-surface"><span className="section-kicker">SCORECARD RHYTHM</span><h2>Report, don’t explain.</h2><p>Use the weekly number to spot where the team needs to look. Save the story for the Issues list.</p><div className="scorecard-side-rule" /><div className="scorecard-side-stat"><strong>{metrics.filter((metric) => metric.status === 'off-track').length}</strong><span>flags this week</span></div><button className="text-button" onClick={() => onView('issues')}>See Issues from the Scorecard <span>→</span></button></aside></div></>;
}

function AdminView({ workspace, team }: { workspace: Workspace; team: Team; onView: (view: ViewId) => void }) {
  return <><PageHeader eyebrow="ORGANISATION · ADMIN" title="Keep the rhythm healthy." description="Manage teams, membership, quarter setup, and the small amount of configuration that keeps the work moving." actions={<Button variant="secondary">View audit log <span className="button-arrow">↗</span></Button>} /><div className="admin-grid"><section className="admin-main"><div className="admin-section-heading"><div><span className="section-kicker">YOUR TEAMS</span><h2>Team workspaces</h2></div><Button>Add team <span className="button-arrow">＋</span></Button></div><div className="admin-team-grid">{workspace.teams.map((item) => <div className={`admin-team-card card-surface ${item.id === team.id ? 'admin-team-selected' : ''}`} key={item.id}><div className="admin-team-mark" style={{ backgroundColor: item.accent }}>{item.initials}</div><div className="admin-team-card-top"><span className="team-status"><span /> Active</span><button className="icon-button" aria-label={`More options for ${item.name}`}>•••</button></div><h3>{item.name}</h3><p>{item.description}</p><div className="admin-team-footer"><span><strong>{item.memberCount}</strong> members</span><span>{item.meetingDay} · {item.meetingTime}</span></div></div>)}</div><div className="admin-section-heading admin-section-heading-spaced"><div><span className="section-kicker">ACCESS</span><h2>Roles & membership</h2></div><button className="text-button">Manage all users <span>→</span></button></div><div className="roles-card card-surface"><div className="role-row"><span className="role-badge role-admin">A</span><div><strong>Org Admin</strong><span>Organisation settings, teams, imports, and access</span></div><span className="role-count">2 people</span></div><div className="role-row"><span className="role-badge role-lead">L</span><div><strong>Team Lead</strong><span>Facilitation, settings, and team-wide editing</span></div><span className="role-count">6 people</span></div><div className="role-row"><span className="role-badge role-member">M</span><div><strong>Member</strong><span>Shared workspace contributions and personal updates</span></div><span className="role-count">18 people</span></div><div className="role-row"><span className="role-badge role-viewer">V</span><div><strong>Viewer</strong><span>Read-only access to a team workspace</span></div><span className="role-count">4 people</span></div></div></section><aside className="admin-side"><div className="admin-callout"><span className="callout-symbol">✦</span><span className="section-kicker">Q3 2026</span><h2>Make the next quarter easier to start.</h2><p>Set the quarter dates, seed the company Rocks, and let each team make their commitments visible.</p><Button variant="secondary">Open quarter setup <span className="button-arrow">→</span></Button></div><div className="import-card card-surface"><span className="section-kicker">PLANNER TRANSITION</span><h3>Bring over active work.</h3><p>Use the CSV import to start clean without losing the context your teams still need.</p><div className="import-status"><span className="import-status-icon">↥</span><div><strong>CSV import ready</strong><span>Validation preview · no sync</span></div></div><Button variant="quiet">Open import tool <span className="button-arrow">→</span></Button></div></aside></div></>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-state-icon">✦</span><strong>{title}</strong><span>{detail}</span></div>;
}

function ModalShell({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button><span className="modal-symbol">✦</span><h2 id="modal-title">{title}</h2><p>{description}</p>{children}</div></div>;
}

function TodoModal({ team, currentUserId, onClose, onSubmit }: { team: Team; currentUserId: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Add a To-Do" description={`Create a clear seven-day commitment for ${team.name}.`} onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Commitment<input name="title" placeholder="What will be done?" autoFocus required /></label><label>Owner<select name="ownerId" defaultValue={currentUserId}><option value="ava-khan">Ava Khan</option><option value="marcus-lee">Marcus Lee</option><option value="priya-shah">Priya Shah</option><option value="daniel-cho">Daniel Cho</option></select></label><label>Due<select name="dueDate" defaultValue="Next Monday"><option>Today</option><option>Tomorrow</option><option>Next Monday</option><option>Next Friday</option></select></label><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">Add To-Do <span className="button-arrow">→</span></Button></div></form></ModalShell>;
}

function IssueModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <ModalShell title="Capture an Issue" description="Name the problem or decision. The team can solve it in IDS when the time is right." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Issue title<input name="title" placeholder="What needs solving?" autoFocus required /></label><label>Context<textarea name="detail" rows={3} placeholder="Add enough context for the team to recognise the issue." /></label><label>Category<select name="category" defaultValue="General"><option>General</option><option>Process</option><option>Customer</option><option>Alignment</option><option>People</option></select></label><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit">Add to Issues <span className="button-arrow">→</span></Button></div></form></ModalShell>;
}
