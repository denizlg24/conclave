import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SerializedAgentEvent,
  SerializedTask,
} from "../../shared/rpc/rpc-schema";
import { useConclave } from "../hooks/use-conclave";
import { CommandBar } from "./CommandBar";
import { DebugConsole } from "./DebugConsole";
import { EventTimeline } from "./EventTimeline";
import { MeetingViewer } from "./MeetingViewer";
import { ApprovalQueue } from "./approvals";
import { extractChangedFiles } from "../utils/activity-log";

const STATUS_COLORS: Record<string, string> = {
  proposed: "#c8a96e",
  pending: "#f2cc8f",
  assigned: "#a1bc98",
  in_progress: "#81b29a",
  suspended: "#f59e0b",
  review: "#e07a5f",
  done: "#6a994e",
  failed: "#c45c4a",
  blocked: "#6b7a65",
  rejected: "#d4736a",
};

const STATUS_ICONS: Record<string, string> = {
  proposed: "○",
  pending: "◔",
  assigned: "◑",
  in_progress: "▶",
  suspended: "⏸",
  review: "◆",
  done: "✔",
  failed: "✘",
  blocked: "■",
  rejected: "✘",
};

type Panel =
  | "quests"
  | "journal"
  | "party"
  | "console"
  | "approvals"
  | "council"
  | "suspended"
  | null;

export function GameHUD() {
  const {
    readModel,
    events,
    agentEvents,
    debugConsoleEntries,
    connected,
    activeProject,
    resumeSuspendedTask,
    unloadProject,
  } = useConclave();
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [highlightMeetingId, setHighlightMeetingId] = useState<string | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const tasks = readModel?.tasks ?? [];
  const meetings = readModel?.meetings ?? [];
  const proposedTasks = tasks.filter((task) => task.status === "proposed");
  const suspendedTasks = tasks.filter((task) => task.status === "suspended");
  const activeTasks = tasks.filter((task) =>
    ["assigned", "in_progress", "review"].includes(task.status),
  );
  const doneTasks = tasks.filter((task) => task.status === "done");
  const blockedTasks = tasks.filter((task) =>
    ["blocked", "failed"].includes(task.status),
  );
  const otherTasks = tasks.filter(
    (task) =>
      !["assigned", "in_progress", "review", "proposed", "done"].includes(task.status),
  );

  const inProgressMeeting = meetings.find((meeting) => meeting.status === "in_progress") ?? null;
  const recentMeeting = meetings.length > 0 ? meetings[meetings.length - 1] : null;
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;
  const latestAgentEvent = agentEvents.length > 0 ? agentEvents[agentEvents.length - 1] : null;
  const errorCount = agentEvents.filter((event) => event.type === "agent.error").length;
  const recentErrors = [...agentEvents]
    .filter((event) => event.type === "agent.error")
    .slice(-3)
    .reverse();

  const panelSubtitle = useMemo<Record<Exclude<Panel, null>, string>>(
    () => ({
      quests: "Task flow, ownership, and execution status.",
      journal: "Immutable event history for the current project.",
      party: "Agent turns, tool use, outputs, errors, and file activity.",
      console: "Mirrored Bun and webview console output.",
      approvals: "Human review queue for meeting-derived proposals.",
      council: "Structured meetings, agenda turns, and outcomes.",
      suspended: "Tasks paused by quota or execution constraints.",
    }),
    [],
  );

  const togglePanel = useCallback((panel: Panel) => {
    setActivePanel((previous) => (previous === panel ? null : panel));
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case "q":
          togglePanel("quests");
          break;
        case "j":
          togglePanel("journal");
          break;
        case "p":
          togglePanel("party");
          break;
        case "l":
          togglePanel("console");
          break;
        case "c":
          togglePanel("council");
          break;
        case " ":
          event.preventDefault();
          setShowCommand((previous) => !previous);
          break;
        case "escape":
          setActivePanel(null);
          setShowCommand(false);
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePanel]);

  return (
    <>
      <div className="hud-top-bar pointer-events-auto">
        <div className="hud-top-bar__left p-0!">
          <div className="hud-brand-block">
            <span className="hud-brand">CONCLAVE</span>
            <span className="hud-brand-subtitle">Mission Control</span>
          </div>

          {activeProject && (
            <div className="hud-project-chip">
              <span className="hud-project-chip__label">Project</span>
              <span className="hud-project-chip__value">{activeProject.name}</span>
            </div>
          )}

          {activeProject && !showExitConfirm && (
            <button
              onClick={() => setShowExitConfirm(true)}
              className="hud-chip hud-chip--danger"
            >
              Exit
            </button>
          )}

          {showExitConfirm && (
            <div className="hud-inline-actions">
              <span className="hud-chip hud-chip--danger-muted">Abandon campaign?</span>
              <button onClick={() => unloadProject()} className="hud-chip hud-chip--danger">
                Confirm
              </button>
              <button
                onClick={() => setShowExitConfirm(false)}
                className="hud-chip hud-chip--neutral"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="hud-top-bar__right">
          <div className="hud-inline-actions">
            <span className="hud-chip hud-chip--good">
              {activeTasks.length} active
            </span>
            {proposedTasks.length > 0 && (
              <button
                onClick={() => togglePanel("approvals")}
                className="hud-chip hud-chip--attention approval-badge"
              >
                {proposedTasks.length} approvals
              </button>
            )}
            {suspendedTasks.length > 0 && (
              <button
                onClick={() => togglePanel("suspended")}
                className="hud-chip hud-chip--warning"
              >
                {suspendedTasks.length} suspended
              </button>
            )}
            {errorCount > 0 && (
              <button
                onClick={() => togglePanel("party")}
                className="hud-chip hud-chip--danger-muted"
              >
                {errorCount} errors
              </button>
            )}
          </div>

          <div className="hud-connection-pill">
            <span
              className="hud-connection-pill__dot"
              style={{
                background: connected ? "var(--rpg-sage)" : "var(--rpg-danger)",
              }}
            />
            <span>{connected ? "linked" : "offline"}</span>
            <span className="hud-connection-pill__divider" />
            <span>cycle {readModel?.snapshotSequence ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="hud-summary-rail pointer-events-auto">
        <section className="hud-summary-card">
          <div className="hud-summary-card__header">
            <span className="hud-summary-card__eyebrow">Overview</span>
            <span className="hud-summary-card__time">
              {latestEvent ? `${relativeTime(latestEvent.occurredAt)} ago` : "quiet"}
            </span>
          </div>
          <div className="hud-kpi-grid">
            <MetricCard label="Tasks" value={String(tasks.length)} accent="var(--rpg-text)" />
            <MetricCard label="Done" value={String(doneTasks.length)} accent="var(--rpg-forest-dark)" />
            <MetricCard
              label="Meetings"
              value={String(meetings.length)}
              accent="var(--rpg-gold)"
            />
            <MetricCard
              label="Logs"
              value={String(debugConsoleEntries.length)}
              accent="var(--rpg-copper)"
            />
          </div>
          <div className="hud-summary-list">
            <SummaryLine
              label="Queue"
              value={`${proposedTasks.length} awaiting approval`}
              tone={proposedTasks.length > 0 ? "attention" : "muted"}
            />
            <SummaryLine
              label="Risk"
              value={
                blockedTasks.length > 0
                  ? `${blockedTasks.length} blocked or failed`
                  : "No active blockers"
              }
              tone={blockedTasks.length > 0 ? "danger" : "good"}
            />
            <SummaryLine
              label="Current"
              value={
                activeTasks[0]?.title ??
                (tasks.length > 0 ? "No task currently executing" : "No tasks yet")
              }
              tone="default"
            />
          </div>
        </section>

        <section className="hud-summary-card">
          <div className="hud-summary-card__header">
            <span className="hud-summary-card__eyebrow">Council</span>
            <button
              onClick={() => togglePanel("council")}
              className="hud-inline-link"
            >
              Open
            </button>
          </div>

          {inProgressMeeting ? (
            <>
              <p className="hud-summary-card__headline">
                {humanizeLabel(inProgressMeeting.meetingType)} in session
              </p>
              <div className="hud-inline-tags">
                <Tag label={`${inProgressMeeting.participants.length} participants`} tone="sage" />
                <Tag label={`${inProgressMeeting.agenda.length} agenda items`} tone="gold" />
                {inProgressMeeting.proposedTaskIds.length > 0 && (
                  <Tag
                    label={`${inProgressMeeting.proposedTaskIds.length} proposals`}
                    tone="copper"
                  />
                )}
              </div>
              <p className="hud-summary-card__body">
                {inProgressMeeting.agenda[0] ?? "Awaiting structured contributions."}
              </p>
            </>
          ) : recentMeeting ? (
            <>
              <p className="hud-summary-card__headline">
                Last council: {humanizeLabel(recentMeeting.meetingType)}
              </p>
              <div className="hud-inline-tags">
                <Tag label={humanizeLabel(recentMeeting.status)} tone="neutral" />
                <Tag label={`${recentMeeting.proposedTaskIds.length} proposed`} tone="gold" />
                <Tag label={`${recentMeeting.approvedTaskIds.length} approved`} tone="sage" />
              </div>
              <p className="hud-summary-card__body">
                {recentMeeting.summary ?? "No summary recorded for the last meeting."}
              </p>
            </>
          ) : (
            <EmptyState compact>No councils have run yet.</EmptyState>
          )}
        </section>

        <section className="hud-summary-card">
          <div className="hud-summary-card__header">
            <span className="hud-summary-card__eyebrow">Party Feed</span>
            <button onClick={() => togglePanel("party")} className="hud-inline-link">
              Open
            </button>
          </div>

          {latestAgentEvent ? (
            <ActivityDigest event={latestAgentEvent} />
          ) : (
            <EmptyState compact>No agent activity yet.</EmptyState>
          )}

          {recentErrors.length > 0 && (
            <div className="hud-summary-stack">
              {recentErrors.map((event, index) => (
                <div key={`${event.occurredAt}-${index}`} className="hud-alert-line">
                  <span className="hud-alert-line__label">
                    {formatAgentLabel(event.agentId)}
                  </span>
                  <span className="hud-alert-line__body">
                    {truncateText(event.error ?? "Execution error", 88)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {activeTasks.length > 0 && (
        <div className="hud-task-strip pointer-events-none">
          <div className="hud-task-strip__inner">
            {activeTasks.slice(0, 5).map((task) => (
              <span
                key={task.id}
                className="ticker-item"
                style={{
                  color: STATUS_COLORS[task.status] ?? "var(--rpg-text)",
                  borderColor: `${STATUS_COLORS[task.status] ?? "var(--rpg-border)"}55`,
                  background: "rgba(14, 18, 14, 0.9)",
                }}
              >
                {STATUS_ICONS[task.status] ?? "○"} {truncateText(task.title, 28)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 rpg-action-bar pointer-events-auto">
        <div className="flex items-center justify-center gap-2 px-4 py-2">
          <ActionButton
            label="Quests"
            hotkey="Q"
            active={activePanel === "quests"}
            count={tasks.length}
            onClick={() => togglePanel("quests")}
          />
          <ActionButton
            label="Journal"
            hotkey="J"
            active={activePanel === "journal"}
            count={events.length}
            onClick={() => togglePanel("journal")}
          />
          <ActionButton
            label="Party"
            hotkey="P"
            active={activePanel === "party"}
            count={agentEvents.length}
            onClick={() => togglePanel("party")}
          />
          <ActionButton
            label="Console"
            hotkey="L"
            active={activePanel === "console"}
            count={debugConsoleEntries.length}
            onClick={() => togglePanel("console")}
          />
          <ActionButton
            label="Council"
            hotkey="C"
            active={activePanel === "council"}
            count={meetings.length}
            onClick={() => togglePanel("council")}
          />

          <div className="w-px h-6 mx-1" style={{ background: "var(--rpg-border)" }} />

          <button
            onClick={() => setShowCommand(true)}
            disabled={showExitConfirm}
            className="rpg-action-btn primary-action disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="hotkey">SPACE</span>
            Command
          </button>

          <div className="w-px h-6 mx-1" style={{ background: "var(--rpg-border)" }} />

          <div className="hud-bottom-stats">
            <span>
              <strong>{doneTasks.length}</strong> done
            </span>
            <span>
              <strong>{activeTasks.length}</strong> active
            </span>
            <span>
              <strong>{tasks.length}</strong> total
            </span>
          </div>
        </div>
      </div>

      {activePanel === "quests" && (
        <RPGPanel
          title="Quest Ledger"
          subtitle={panelSubtitle.quests}
          onClose={() => setActivePanel(null)}
        >
          <div className="hud-panel-scroll">
            {tasks.length === 0 ? (
              <EmptyState>No tasks have been recorded for this project.</EmptyState>
            ) : (
              <div className="flex flex-col">
                {activeTasks.length > 0 && (
                  <>
                    <SectionHeader label="Active" count={activeTasks.length} />
                    {activeTasks.map((task) => (
                      <QuestEntry key={task.id} task={task} />
                    ))}
                  </>
                )}

                {proposedTasks.length > 0 && (
                  <>
                    <SectionHeader label="Awaiting Approval" count={proposedTasks.length} />
                    {proposedTasks.map((task) => (
                      <QuestEntry key={task.id} task={task} />
                    ))}
                  </>
                )}

                {doneTasks.length > 0 && (
                  <>
                    <SectionHeader label="Completed" count={doneTasks.length} />
                    {doneTasks.map((task) => (
                      <QuestEntry key={task.id} task={task} />
                    ))}
                  </>
                )}

                {otherTasks.length > 0 && (
                  <>
                    <SectionHeader label="Other" count={otherTasks.length} />
                    {otherTasks.map((task) => (
                      <QuestEntry key={task.id} task={task} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {tasks.length > 0 && (
            <div className="hud-panel-footer">
              <div className="flex items-center justify-between mb-2">
                <span className="hud-panel-footer__label">Overall progress</span>
                <span className="hud-panel-footer__value">
                  {doneTasks.length}/{tasks.length}
                </span>
              </div>
              <div className="quest-progress">
                <div
                  className="quest-progress-fill"
                  style={{
                    width: `${(doneTasks.length / tasks.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </RPGPanel>
      )}

      {activePanel === "journal" && (
        <RPGPanel
          title="Event Journal"
          subtitle={panelSubtitle.journal}
          onClose={() => setActivePanel(null)}
        >
          <EventTimeline events={events} embedded maxItems={180} />
        </RPGPanel>
      )}

      {activePanel === "party" && (
        <RPGPanel
          title="Party Activity"
          subtitle={panelSubtitle.party}
          onClose={() => setActivePanel(null)}
        >
          <div className="hud-panel-scroll">
            {agentEvents.length === 0 ? (
              <EmptyState>No agent activity has been recorded.</EmptyState>
            ) : (
              [...agentEvents]
                .slice(-160)
                .reverse()
                .map((event, index) => (
                  <PartyActivityEntry
                    key={`${event.occurredAt}-${index}`}
                    event={event}
                  />
                ))
            )}
          </div>
        </RPGPanel>
      )}

      {activePanel === "approvals" && (
        <RPGPanel
          title="Approval Queue"
          subtitle={panelSubtitle.approvals}
          onClose={() => setActivePanel(null)}
        >
          <ApprovalQueue
            onViewCouncil={(meetingId) => {
              setHighlightMeetingId(meetingId);
              setActivePanel("council");
            }}
          />
        </RPGPanel>
      )}

      {activePanel === "console" && (
        <RPGPanel
          title="Debug Console"
          subtitle={panelSubtitle.console}
          onClose={() => setActivePanel(null)}
        >
          <DebugConsole embedded />
        </RPGPanel>
      )}

      {activePanel === "council" && (
        <MeetingViewer
          meetings={meetings}
          highlightMeetingId={highlightMeetingId}
          onClose={() => setActivePanel(null)}
        />
      )}

      {activePanel === "suspended" && (
        <RPGPanel
          title="Suspended Tasks"
          subtitle={panelSubtitle.suspended}
          onClose={() => setActivePanel(null)}
        >
          <div className="hud-panel-scroll">
            {suspendedTasks.length === 0 ? (
              <EmptyState>No suspended tasks.</EmptyState>
            ) : (
              suspendedTasks.map((task) => (
                <div key={task.id} className="hud-list-card">
                  <div className="hud-list-card__header">
                    <div>
                      <div className="hud-list-card__title">{task.title}</div>
                      <div className="hud-inline-tags mt-2">
                        <Tag label={task.taskType} tone="warning" />
                        <Tag label="Awaiting credits" tone="danger" />
                      </div>
                    </div>
                    <span className="hud-list-card__time">
                      {relativeTime(task.updatedAt)} ago
                    </span>
                  </div>

                  {task.description && (
                    <p className="hud-list-card__body">
                      {truncateText(task.description, 180)}
                    </p>
                  )}

                  <div className="hud-list-card__footer">
                    <button
                      onClick={() => resumeSuspendedTask(task.id)}
                      className="hud-chip hud-chip--good"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </RPGPanel>
      )}

      <CommandBar open={showCommand} onClose={() => setShowCommand(false)} />
    </>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="hud-metric-card">
      <span className="hud-metric-card__label">{label}</span>
      <span className="hud-metric-card__value" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "default" | "attention" | "danger" | "good" | "muted";
}) {
  const colorMap = {
    default: "var(--rpg-text)",
    attention: "var(--rpg-gold)",
    danger: "var(--rpg-danger)",
    good: "var(--rpg-sage)",
    muted: "var(--rpg-text-dim)",
  } as const;

  return (
    <div className="hud-summary-line">
      <span className="hud-summary-line__label">{label}</span>
      <span className="hud-summary-line__value" style={{ color: colorMap[tone] }}>
        {value}
      </span>
    </div>
  );
}

function ActivityDigest({ event }: { event: SerializedAgentEvent }) {
  const changedFiles = extractChangedFiles(event);

  return (
    <div className="hud-digest">
      <div className="hud-digest__meta">
        <span>{formatAgentLabel(event.agentId)}</span>
        <span>{formatAgentEventLabel(event.type)}</span>
        <span>{relativeTime(event.occurredAt)} ago</span>
      </div>
      <p className="hud-summary-card__headline">
        {summarizeAgentEvent(event)}
      </p>
      {changedFiles.length > 0 && (
        <div className="hud-inline-tags">
          {changedFiles.slice(0, 3).map((file) => (
            <Tag key={file} label={file} tone="neutral" mono />
          ))}
          {changedFiles.length > 3 && (
            <Tag label={`+${changedFiles.length - 3} more`} tone="neutral" />
          )}
        </div>
      )}
    </div>
  );
}

function PartyActivityEntry({ event }: { event: SerializedAgentEvent }) {
  const changedFiles = extractChangedFiles(event);
  const usage = event.usage;

  return (
    <article className="hud-log-card">
      <div className="hud-log-card__header">
        <div className="hud-log-card__meta">
          <span className="hud-log-card__agent">{formatAgentLabel(event.agentId)}</span>
          <span>{formatAgentEventLabel(event.type)}</span>
          {event.taskId && <span>{truncateText(event.taskId, 10)}</span>}
        </div>
        <span className="hud-log-card__time">{relativeTime(event.occurredAt)} ago</span>
      </div>

      <p className="hud-log-card__summary">{summarizeAgentEvent(event)}</p>

      {(event.content || event.error) && (
        <div className={`hud-log-detail ${event.error ? "hud-log-detail--error" : ""}`}>
          <p>{truncateText(event.error ?? event.content ?? "", 520)}</p>
        </div>
      )}

      {event.type === "agent.tool.invoked" && event.toolName && (
        <div className="hud-inline-tags">
          <Tag label={event.toolName} tone="copper" mono />
        </div>
      )}

      {changedFiles.length > 0 && (
        <div className="hud-file-block">
          <div className="hud-file-block__label">Changed files</div>
          <div className="hud-file-list">
            {changedFiles.slice(0, 8).map((file) => (
              <span key={file} className="hud-file-chip">
                {file}
              </span>
            ))}
            {changedFiles.length > 8 && (
              <span className="hud-file-chip">+{changedFiles.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {(event.costUsd !== undefined ||
        event.durationMs !== undefined ||
        usage !== undefined) && (
        <div className="hud-inline-tags">
          {event.costUsd !== undefined && (
            <Tag label={`$${event.costUsd.toFixed(4)}`} tone="neutral" mono />
          )}
          {event.durationMs !== undefined && (
            <Tag label={`${(event.durationMs / 1000).toFixed(1)}s`} tone="neutral" mono />
          )}
          {usage && (
            <Tag
              label={`${usage.inputTokens}/${usage.outputTokens} tok`}
              tone="neutral"
              mono
            />
          )}
        </div>
      )}
    </article>
  );
}

function ActionButton({
  label,
  hotkey,
  count,
  onClick,
  active,
}: {
  label: string;
  hotkey: string;
  count?: number;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button onClick={onClick} className={`rpg-action-btn ${active ? "active" : ""}`}>
      <span className="hotkey">{hotkey}</span>
      {label}
      {count !== undefined && <span style={{ opacity: 0.45, fontSize: 9 }}>{count}</span>}
    </button>
  );
}

function RPGPanel({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-16 left-4 z-30 pointer-events-auto flex min-h-0 flex-col overflow-hidden rpg-panel hud-panel-shell"
      style={{
        bottom: 72,
        width: "min(29rem, calc(100vw - 2rem))",
      }}
    >
      <div className="hud-panel-header">
        <div>
          <div className="hud-panel-header__title">{title}</div>
          <p className="hud-panel-header__subtitle">{subtitle}</p>
        </div>
        <button onClick={onClose} className="hud-panel-close" aria-label={`Close ${title}`}>
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 flex flex-col">{children}</div>
    </div>
  );
}

function EmptyState({
  children,
  compact = false,
}: {
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <p className={`hud-empty-state ${compact ? "hud-empty-state--compact" : ""}`}>
      {children}
    </p>
  );
}

function SectionHeader({
  label,
  count,
}: {
  label: string;
  count?: number;
}) {
  return (
    <div className="hud-section-header">
      <span>{label}</span>
      {count !== undefined && <span className="hud-section-header__count">{count}</span>}
    </div>
  );
}

function QuestEntry({ task }: { task: SerializedTask }) {
  const color = STATUS_COLORS[task.status] ?? "var(--rpg-text-dim)";
  const changedOutputFiles = extractFilesFromUnknown(task.output);

  return (
    <div className="hud-list-card">
      <div className="hud-list-card__header">
        <div>
          <div className="hud-list-card__title">{task.title}</div>
          <div className="hud-inline-tags mt-2">
            <Tag label={humanizeLabel(task.taskType)} tone="neutral" />
            <Tag label={humanizeLabel(task.status)} tone="status" accent={color} />
            {task.ownerRole && <Tag label={task.ownerRole} tone="sage" />}
          </div>
        </div>
        <span className="hud-list-card__time">{relativeTime(task.updatedAt)} ago</span>
      </div>

      {task.description && <p className="hud-list-card__body">{truncateText(task.description, 220)}</p>}

      <div className="hud-list-card__footer">
        <span className="hud-list-card__meta">ID {truncateText(task.id, 12)}</span>
        {task.deps.length > 0 && (
          <span className="hud-list-card__meta">
            {task.deps.length} dependency{task.deps.length === 1 ? "" : "ies"}
          </span>
        )}
        {changedOutputFiles.length > 0 && (
          <span className="hud-list-card__meta">
            {changedOutputFiles.length} artifact{changedOutputFiles.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}

function Tag({
  label,
  tone,
  mono = false,
  accent,
}: {
  label: string;
  tone: "gold" | "sage" | "copper" | "warning" | "danger" | "status" | "neutral";
  mono?: boolean;
  accent?: string;
}) {
  const styleMap = {
    gold: {
      background: "rgba(200, 169, 110, 0.12)",
      border: "rgba(200, 169, 110, 0.24)",
      color: "var(--rpg-gold)",
    },
    sage: {
      background: "rgba(129, 178, 154, 0.12)",
      border: "rgba(129, 178, 154, 0.24)",
      color: "var(--rpg-sage)",
    },
    copper: {
      background: "rgba(212, 163, 115, 0.12)",
      border: "rgba(212, 163, 115, 0.24)",
      color: "var(--rpg-copper)",
    },
    warning: {
      background: "rgba(245, 158, 11, 0.12)",
      border: "rgba(245, 158, 11, 0.24)",
      color: "#f59e0b",
    },
    danger: {
      background: "rgba(196, 92, 74, 0.12)",
      border: "rgba(196, 92, 74, 0.24)",
      color: "var(--rpg-danger)",
    },
    status: {
      background: `${accent ?? "var(--rpg-border)"}15`,
      border: `${accent ?? "var(--rpg-border)"}33`,
      color: accent ?? "var(--rpg-text)",
    },
    neutral: {
      background: "rgba(255, 255, 255, 0.04)",
      border: "rgba(90, 102, 82, 0.45)",
      color: "var(--rpg-text-dim)",
    },
  } as const;

  const toneStyle = styleMap[tone];

  return (
    <span
      className={`hud-tag ${mono ? "rpg-mono" : ""}`}
      style={{
        background: toneStyle.background,
        borderColor: toneStyle.border,
        color: toneStyle.color,
      }}
    >
      {label}
    </span>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function humanizeLabel(value: string): string {
  return value.replace(/[_.-]+/g, " ");
}

function formatAgentLabel(agentId: string): string {
  return agentId.replace(/^agent-/, "").replace(/-/g, " ").toUpperCase();
}

function formatAgentEventLabel(type: string): string {
  return type.replace(/^agent\./, "").replace(/[._-]+/g, " ");
}

function summarizeAgentEvent(event: SerializedAgentEvent): string {
  if (event.type === "agent.output.produced" && event.content) {
    return truncateText(event.content.replace(/\s+/g, " ").trim(), 140);
  }

  if (event.type === "agent.tool.invoked" && event.toolName) {
    const changedFiles = extractChangedFiles(event);
    if (changedFiles.length > 0) {
      return `${event.toolName} touched ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}.`;
    }

    return `Invoked ${event.toolName}.`;
  }

  if (event.type === "agent.error") {
    return truncateText(event.error ?? "Execution error.", 140);
  }

  if (event.type === "agent.turn.completed") {
    const parts: string[] = ["Turn completed"];
    if (event.durationMs !== undefined) {
      parts.push(`${(event.durationMs / 1000).toFixed(1)}s`);
    }
    if (event.costUsd !== undefined) {
      parts.push(`$${event.costUsd.toFixed(4)}`);
    }
    return parts.join(" • ");
  }

  return formatAgentEventLabel(event.type);
}

function extractFilesFromUnknown(value: unknown): string[] {
  if (!value) {
    return [];
  }

  return extractChangedFiles(value);
}
