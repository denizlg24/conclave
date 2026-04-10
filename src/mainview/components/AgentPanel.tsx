import type { AgentState } from "../../shared/agent/Agent";
import type {
  SerializedAgentEvent,
  SerializedTask,
} from "../../shared/rpc/rpc-schema";
import { extractChangedFiles } from "../utils/activity-log";

const STATUS_COLORS: Record<string, string> = {
  proposed: "#c8a96e",
  pending: "#f2cc8f",
  assigned: "#a1bc98",
  in_progress: "#81b29a",
  review: "#e07a5f",
  done: "#6a994e",
  failed: "#c45c4a",
  blocked: "#6b7a65",
};

const STATE_LABELS: Record<AgentState, { text: string; color: string }> = {
  idle: { text: "Standing by", color: "var(--rpg-text-muted)" },
  working: { text: "Executing task", color: "var(--rpg-sage)" },
  heading_to_meeting: { text: "Moving to council", color: "var(--rpg-gold)" },
  in_meeting: { text: "In council", color: "var(--rpg-gold)" },
  returning: { text: "Returning to post", color: "var(--rpg-text-dim)" },
};

const ROLE_TITLES: Record<string, string> = {
  pm: "Project Manager",
  developer: "Developer",
  reviewer: "Code Reviewer",
  tester: "Quality Assurance",
};

interface AgentPanelProps {
  role: string;
  label: string;
  color: string;
  agentState: AgentState;
  tasks: SerializedTask[];
  agentEvents: SerializedAgentEvent[];
  onClose: () => void;
}

export function AgentPanel({
  role,
  label,
  color,
  agentState,
  tasks,
  agentEvents,
  onClose,
}: AgentPanelProps) {
  const stateInfo = STATE_LABELS[agentState];
  const currentTask = tasks.find((task) =>
    ["assigned", "in_progress", "review"].includes(task.status),
  );
  const completedTasks = tasks.filter((task) => task.status === "done");
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const activeTasks = tasks.filter((task) =>
    ["assigned", "in_progress", "review"].includes(task.status),
  );
  const recentTasks = [...tasks]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 4);
  const logEvents = [...agentEvents]
    .filter((event) =>
      [
        "agent.output.produced",
        "agent.tool.invoked",
        "agent.error",
        "agent.turn.completed",
      ].includes(event.type),
    )
    .slice(-80)
    .reverse();

  const totalCost = agentEvents
    .filter((event) => event.type === "agent.turn.completed")
    .reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
  const totalDurationMs = agentEvents
    .filter((event) => event.type === "agent.turn.completed")
    .reduce((sum, event) => sum + (event.durationMs ?? 0), 0);
  const changedFiles = [...new Set(agentEvents.flatMap((event) => extractChangedFiles(event)))];

  return (
    <aside
      className="absolute top-16 left-4 z-40 pointer-events-auto flex min-h-0 flex-col overflow-hidden rpg-panel hud-panel-shell"
      style={{
        bottom: 72,
        width: "min(24rem, calc(100vw - 2rem))",
      }}
    >
      <div
        className="hud-panel-header"
        style={{
          background: `linear-gradient(180deg, ${color}14 0%, rgba(0, 0, 0, 0) 100%)`,
          borderLeft: `3px solid ${color}`,
        }}
      >
        <div>
          <div className="hud-panel-header__title">{label}</div>
          <p className="hud-panel-header__subtitle">{ROLE_TITLES[role] ?? role}</p>
          <div className="hud-inline-tags mt-2">
            <span className="hud-tag" style={{ borderColor: `${stateInfo.color}44`, color: stateInfo.color }}>
              {stateInfo.text}
            </span>
            {currentTask && (
              <span
                className="hud-tag"
                style={{
                  borderColor: `${STATUS_COLORS[currentTask.status] ?? color}44`,
                  color: STATUS_COLORS[currentTask.status] ?? color,
                }}
              >
                {humanizeValue(currentTask.status)}
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="hud-panel-close" aria-label={`Close ${label}`}>
          ×
        </button>
      </div>

      <div className="grid grid-cols-4 gap-px" style={{ background: "var(--rpg-border)" }}>
        <StatCell label="Tasks" value={String(tasks.length)} color="var(--rpg-text)" />
        <StatCell label="Done" value={String(completedTasks.length)} color="var(--rpg-forest-dark)" />
        <StatCell label="Fail" value={String(failedTasks.length)} color="var(--rpg-danger)" />
        <StatCell
          label="Cost"
          value={totalCost > 0 ? `$${totalCost.toFixed(3)}` : "$0"}
          color="var(--rpg-copper)"
        />
      </div>

      <div className="hud-panel-scroll">
        <section className="hud-summary-card m-3">
          <div className="hud-summary-card__header">
            <span className="hud-summary-card__eyebrow">Current Task</span>
            <span className="hud-summary-card__time">
              {currentTask ? `${relativeTime(currentTask.updatedAt)} ago` : "idle"}
            </span>
          </div>

          {currentTask ? (
            <>
              <p className="hud-summary-card__headline">{currentTask.title}</p>
              {currentTask.description && (
                <p className="hud-summary-card__body">{truncateText(currentTask.description, 180)}</p>
              )}
              <div className="hud-inline-tags">
                <span className="hud-file-chip">{humanizeValue(currentTask.taskType)}</span>
                {currentTask.deps.length > 0 && (
                  <span className="hud-file-chip">
                    {currentTask.deps.length} dep{currentTask.deps.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="hud-summary-card__body">No active assignment. This agent is ready for the next directive.</p>
          )}
        </section>

        <section className="hud-summary-card mx-3 mb-3">
          <div className="hud-summary-card__header">
            <span className="hud-summary-card__eyebrow">Session Readout</span>
          </div>
          <div className="hud-summary-list">
            <div className="hud-summary-line">
              <span className="hud-summary-line__label">Active workload</span>
              <span className="hud-summary-line__value">{activeTasks.length} task(s)</span>
            </div>
            <div className="hud-summary-line">
              <span className="hud-summary-line__label">Total runtime</span>
              <span className="hud-summary-line__value">{(totalDurationMs / 1000).toFixed(1)}s</span>
            </div>
            <div className="hud-summary-line">
              <span className="hud-summary-line__label">Touched files</span>
              <span className="hud-summary-line__value">{changedFiles.length}</span>
            </div>
          </div>
          {changedFiles.length > 0 && (
            <div className="hud-file-list mt-3">
              {changedFiles.slice(0, 6).map((file) => (
                <span key={file} className="hud-file-chip">
                  {file}
                </span>
              ))}
            </div>
          )}
        </section>

        {recentTasks.length > 0 && (
          <section className="mx-3 mb-3">
            <div className="hud-section-header">
              <span>Task History</span>
              <span className="hud-section-header__count">{recentTasks.length}</span>
            </div>
            {recentTasks.map((task) => (
              <div key={task.id} className="hud-list-card">
                <div className="hud-list-card__header">
                  <div className="hud-list-card__title">{task.title}</div>
                  <span className="hud-list-card__time">{relativeTime(task.updatedAt)} ago</span>
                </div>
                <div className="hud-inline-tags">
                  <span
                    className="hud-tag"
                    style={{
                      borderColor: `${STATUS_COLORS[task.status] ?? color}44`,
                      color: STATUS_COLORS[task.status] ?? color,
                    }}
                  >
                    {humanizeValue(task.status)}
                  </span>
                  <span className="hud-file-chip">{humanizeValue(task.taskType)}</span>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="mx-3 mb-3">
          <div className="hud-section-header">
            <span>Activity Log</span>
            <span className="hud-section-header__count">{logEvents.length}</span>
          </div>
          {logEvents.length === 0 ? (
            <p className="hud-empty-state hud-empty-state--compact">No activity recorded for this agent.</p>
          ) : (
            logEvents.map((event, index) => (
              <AgentLogEntry key={`${event.occurredAt}-${index}`} event={event} accent={color} />
            ))
          )}
        </section>
      </div>
    </aside>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center py-2" style={{ background: "var(--rpg-panel)" }}>
      <span className="rpg-mono text-[12px] font-medium" style={{ color }}>
        {value}
      </span>
      <span className="rpg-mono text-[10px] uppercase tracking-wider mt-0.5" style={{ color: "var(--rpg-text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function AgentLogEntry({
  event,
  accent,
}: {
  event: SerializedAgentEvent;
  accent: string;
}) {
  const files = extractChangedFiles(event);

  return (
    <article className="hud-log-card">
      <div className="hud-log-card__header">
        <div className="hud-log-card__meta">
          <span className="hud-log-card__agent" style={{ color: accent }}>
            {event.type.replace(/^agent\./, "").replace(/[._-]+/g, " ")}
          </span>
          {event.taskId && <span>{event.taskId.slice(0, 8)}</span>}
        </div>
        <span className="hud-log-card__time">{formatTime(event.occurredAt)}</span>
      </div>

      <p className="hud-log-card__summary">{describeAgentEvent(event)}</p>

      {(event.content || event.error) && (
        <div className={`hud-log-detail ${event.error ? "hud-log-detail--error" : ""}`}>
          <p>{truncateText(event.error ?? event.content ?? "", 260)}</p>
        </div>
      )}

      {files.length > 0 && (
        <div className="hud-file-list">
          {files.slice(0, 5).map((file) => (
            <span key={file} className="hud-file-chip">
              {file}
            </span>
          ))}
        </div>
      )}

      {(event.costUsd !== undefined || event.durationMs !== undefined) && (
        <div className="hud-inline-tags">
          {event.costUsd !== undefined && <span className="hud-file-chip">${event.costUsd.toFixed(4)}</span>}
          {event.durationMs !== undefined && (
            <span className="hud-file-chip">{(event.durationMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      )}
    </article>
  );
}

function describeAgentEvent(event: SerializedAgentEvent): string {
  if (event.type === "agent.output.produced") {
    return truncateText(event.content?.replace(/\s+/g, " ").trim() ?? "Output produced.", 140);
  }

  if (event.type === "agent.tool.invoked") {
    const files = extractChangedFiles(event);
    return files.length > 0
      ? `${event.toolName ?? "tool"} touched ${files.length} file${files.length === 1 ? "" : "s"}.`
      : `Invoked ${event.toolName ?? "tool"}.`;
  }

  if (event.type === "agent.error") {
    return truncateText(event.error ?? "Execution error.", 140);
  }

  if (event.type === "agent.turn.completed") {
    return "Turn completed and reported back to the orchestrator.";
  }

  return event.type;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function humanizeValue(value: string): string {
  return value.replace(/[_.-]+/g, " ");
}
