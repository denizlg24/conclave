import { useRef, useEffect } from "react";
import type { AgentState } from "../../shared/agent/Agent";
import type {
  SerializedAgentEvent,
  SerializedTask,
} from "../../shared/rpc/rpc-schema";

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
  working: { text: "Working", color: "var(--rpg-sage)" },
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
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [agentEvents.length]);

  const currentTask = tasks.find((t) =>
    ["in_progress", "assigned"].includes(t.status),
  );
  const completedTasks = tasks.filter((t) => t.status === "done");
  const failedTasks = tasks.filter((t) => t.status === "failed");

  const logEvents = agentEvents
    .filter((e) =>
      [
        "agent.output.produced",
        "agent.tool.invoked",
        "agent.error",
        "agent.turn.completed",
      ].includes(e.type),
    )
    .slice(-120);

  const stateInfo = STATE_LABELS[agentState];

  const totalCost = agentEvents
    .filter((e) => e.type === "agent.turn.completed" && e.costUsd !== undefined)
    .reduce((sum, e) => sum + (e.costUsd ?? 0), 0);

  return (
    <div
      className="absolute top-10 left-5 w-[340px] pointer-events-auto flex flex-col rpg-panel overflow-hidden"
      style={{ bottom: 56, maxHeight: "calc(var(--app-height, 100%) - 70px)" }}
    >
      <div
        className="px-4 py-3"
        style={{
          borderBottom: "1px solid var(--rpg-border)",
          background: `linear-gradient(180deg, ${color}10 0%, transparent 100%)`,
          borderLeft: `3px solid ${color}`,
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="rpg-font text-[12px] tracking-wider" style={{ color }}>
              {label}
            </span>
            <span
              className="rpg-mono text-[11px] ml-2"
              style={{ color: "var(--rpg-text-dim)" }}
            >
              {ROLE_TITLES[role] ?? role}
            </span>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer transition-colors"
            style={{ color: "var(--rpg-text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--rpg-text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--rpg-text-muted)")}
          >
            &times;
          </button>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: stateInfo.color,
              boxShadow: agentState === "working" ? `0 0 6px ${color}60` : "none",
            }}
          />
          <span className="rpg-mono text-[11px]" style={{ color: stateInfo.color }}>
            {stateInfo.text}
          </span>
        </div>
      </div>

      <div
        className="grid grid-cols-4 gap-px"
        style={{ background: "var(--rpg-border)" }}
      >
        <StatCell label="TOTAL" value={String(tasks.length)} color="var(--rpg-text-dim)" />
        <StatCell label="DONE" value={String(completedTasks.length)} color="var(--rpg-forest-dark)" />
        <StatCell label="FAILED" value={String(failedTasks.length)} color="var(--rpg-danger)" />
        <StatCell
          label="COST"
          value={totalCost > 0 ? `$${totalCost.toFixed(3)}` : "$0"}
          color="var(--rpg-copper)"
        />
      </div>

      <div
        className="px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--rpg-border)" }}
      >
        <span
          className="rpg-font text-[11px] tracking-wider block mb-1.5"
          style={{ color: "var(--rpg-gold-dim)" }}
        >
          CURRENT QUEST
        </span>
        {currentTask ? (
          <div>
            <div
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-text)" }}
            >
              {currentTask.title}
            </div>
            {currentTask.description && (
              <div
                className="rpg-mono text-[11px] mt-1"
                style={{ color: "var(--rpg-text-dim)" }}
              >
                {currentTask.description.slice(0, 150)}
                {currentTask.description.length > 150 ? "\u2026" : ""}
              </div>
            )}
            <div className="mt-1.5">
              <span
                className="rpg-mono text-[11px] inline-block px-2 py-0.5"
                style={{
                  color: STATUS_COLORS[currentTask.status],
                  border: `1px solid ${STATUS_COLORS[currentTask.status]}44`,
                  background: `${STATUS_COLORS[currentTask.status]}12`,
                }}
              >
                {currentTask.status.replace("_", " ")}
              </span>
            </div>
          </div>
        ) : (
          <span
            className="rpg-mono text-[11px]"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            Awaiting assignment
          </span>
        )}
      </div>

      <div
        className="rpg-font text-[11px] tracking-wider px-3 py-1.5"
        style={{
          color: "var(--rpg-gold-dim)",
          borderBottom: "1px solid var(--rpg-border)",
          background: "rgba(200, 169, 110, 0.03)",
        }}
      >
        ACTIVITY LOG
      </div>
      <div ref={logRef} className="flex-1 overflow-y-auto">
        {logEvents.length === 0 ? (
          <p
            className="rpg-mono text-[11px] text-center py-6"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            No activity recorded
          </p>
        ) : (
          logEvents.map((event, i) => (
            <AgentLogEntry key={`${event.occurredAt}-${i}`} event={event} color={color} />
          ))
        )}
      </div>
    </div>
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
    <div
      className="flex flex-col items-center py-2"
      style={{ background: "var(--rpg-panel)" }}
    >
      <span className="rpg-mono text-[12px] font-medium" style={{ color }}>
        {value}
      </span>
      <span
        className="rpg-mono text-[11px] uppercase tracking-wider mt-0.5"
        style={{ color: "var(--rpg-text-muted)" }}
      >
        {label}
      </span>
    </div>
  );
}

function AgentLogEntry({
  event,
  color,
}: {
  event: SerializedAgentEvent;
  color: string;
}) {
  const time = new Date(event.occurredAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  switch (event.type) {
    case "agent.output.produced":
      return (
        <div className="log-entry">
          <div className="flex items-center gap-1.5">
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              {time}
            </span>
            <span className="rpg-mono text-[11px]" style={{ color }}>
              output
            </span>
          </div>
          <div className="log-output">
            <p className="rpg-mono text-[11px] whitespace-pre-wrap break-words">
              {event.content?.slice(0, 500)}
              {(event.content?.length ?? 0) > 500 ? "\u2026" : ""}
            </p>
          </div>
        </div>
      );
    case "agent.tool.invoked":
      return (
        <div className="log-entry">
          <div className="flex items-center gap-1.5">
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              {time}
            </span>
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-sand)" }}
            >
              tool
            </span>
          </div>
          <div className="log-tool">
            <span className="rpg-mono text-[11px]" style={{ color: "var(--rpg-sand)" }}>
              {event.toolName}
            </span>
          </div>
        </div>
      );
    case "agent.error":
      return (
        <div className="log-entry">
          <div className="flex items-center gap-1.5">
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              {time}
            </span>
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-danger)" }}
            >
              error
            </span>
          </div>
          <div className="log-error">
            <p className="rpg-mono text-[11px]">
              {event.error?.slice(0, 200)}
            </p>
          </div>
        </div>
      );
    case "agent.turn.completed":
      return (
        <div className="log-entry">
          <div className="flex items-center gap-2">
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              {time}
            </span>
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-forest-dark)" }}
            >
              turn complete
            </span>
            {event.costUsd !== undefined && (
              <span
                className="rpg-mono text-[11px]"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                ${event.costUsd.toFixed(4)}
              </span>
            )}
            {event.durationMs !== undefined && (
              <span
                className="rpg-mono text-[11px]"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                {(event.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      );
    default:
      return null;
  }
}
