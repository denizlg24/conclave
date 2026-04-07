import { useState, useRef, useEffect, useCallback } from "react";
import { useConclave } from "../hooks/use-conclave";
import { CommandBar } from "./CommandBar";
import { MeetingViewer } from "./MeetingViewer";

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
  proposed: "\u25cb",
  pending: "\u25d4",
  assigned: "\u25d1",
  in_progress: "\u25b6",
  suspended: "\u23f8",
  review: "\u25c6",
  done: "\u2714",
  failed: "\u2718",
  blocked: "\u25a0",
  rejected: "\u2718",
};

type Panel = "quests" | "journal" | "party" | "approvals" | "council" | "suspended" | null;

export function GameHUD() {
  const {
    readModel,
    events,
    agentEvents,
    connected,
    activeProject,
    approveProposedTasks,
    resumeSuspendedTask,
  } = useConclave();
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [highlightMeetingId, setHighlightMeetingId] = useState<string | null>(null);
  const [showCommand, setShowCommand] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const partyLogRef = useRef<HTMLDivElement>(null);

  const tasks = readModel?.tasks ?? [];
  const meetings = readModel?.meetings ?? [];
  const proposedTasks = tasks.filter((t) => t.status === "proposed");
  const suspendedTasks = tasks.filter((t) => t.status === "suspended");
  const activeTasks = tasks.filter((t) =>
    ["assigned", "in_progress", "review"].includes(t.status),
  );
  const doneTasks = tasks.filter((t) => t.status === "done");

  useEffect(() => {
    if (logRef.current && activePanel === "journal") {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length, activePanel]);

  useEffect(() => {
    if (partyLogRef.current && activePanel === "party") {
      partyLogRef.current.scrollTop = partyLogRef.current.scrollHeight;
    }
  }, [agentEvents.length, activePanel]);

  const togglePanel = useCallback(
    (panel: Panel) =>
      setActivePanel((prev) => (prev === panel ? null : panel)),
    [],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      switch (e.key.toLowerCase()) {
        case "q":
          togglePanel("quests");
          break;
        case "j":
          togglePanel("journal");
          break;
        case "p":
          togglePanel("party");
          break;
        case "c":
          togglePanel("council");
          break;
        case " ":
          e.preventDefault();
          setShowCommand((prev) => !prev);
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

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    return `${Math.floor(diff / 3_600_000)}h`;
  };

  return (
    <>
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2 pointer-events-auto"
        style={{
          background:
            "linear-gradient(180deg, rgba(14, 18, 14, 0.95) 0%, rgba(14, 18, 14, 0.85) 60%, rgba(14, 18, 14, 0.4) 90%, transparent 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <span
            className="rpg-font text-[14px] tracking-widest"
            style={{ color: "var(--rpg-gold)" }}
          >
            CONCLAVE
          </span>
          {activeProject && (
            <span
              className="rpg-mono text-[11px]"
              style={{
                color: "var(--rpg-text-dim)",
                borderLeft: "1px solid var(--rpg-border)",
                paddingLeft: 10,
              }}
            >
              {activeProject.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {suspendedTasks.length > 0 && (
            <button
              onClick={() => togglePanel("suspended")}
              className="rpg-mono text-[11px] px-2.5 py-1 cursor-pointer"
              style={{
                background: "rgba(245, 158, 11, 0.15)",
                border: "1px solid rgba(245, 158, 11, 0.4)",
                color: "#f59e0b",
              }}
            >
              {suspendedTasks.length} SUSPENDED
            </button>
          )}
          {proposedTasks.length > 0 && (
            <button
              onClick={() => togglePanel("approvals")}
              className="approval-badge rpg-mono text-[11px] px-2.5 py-1 cursor-pointer"
              style={{
                background: "rgba(200, 169, 110, 0.15)",
                border: "1px solid var(--rpg-gold-dim)",
                color: "var(--rpg-gold)",
              }}
            >
              {proposedTasks.length} AWAITING DECREE
            </button>
          )}
          <span
            className="flex items-center gap-1.5 rpg-mono text-[10px]"
            style={{ color: "var(--rpg-text-dim)" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: connected
                  ? "var(--rpg-sage)"
                  : "var(--rpg-danger)",
              }}
            />
            CYCLE {readModel?.snapshotSequence ?? 0}
          </span>
        </div>
      </div>

      {activeTasks.length > 0 && (
        <div
          className="absolute left-0 right-0 pointer-events-none flex justify-center"
          style={{ bottom: 50 }}
        >
          <div className="flex gap-1.5 px-3 py-1">
            {activeTasks.slice(0, 5).map((t) => (
              <span
                key={t.id}
                className="ticker-item"
                style={{
                  color: STATUS_COLORS[t.status] ?? "var(--rpg-text)",
                  borderColor: `${STATUS_COLORS[t.status] ?? "var(--rpg-border)"}55`,
                  background: `rgba(14, 18, 14, 0.88)`,
                }}
              >
                {STATUS_ICONS[t.status] ?? "\u25cb"}{" "}
                {t.title.slice(0, 25)}
                {t.title.length > 25 ? "\u2026" : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 rpg-action-bar pointer-events-auto">
        <div className="flex items-center justify-center gap-2 px-4 py-2">
          <ActionButton
            label="QUESTS"
            hotkey="Q"
            active={activePanel === "quests"}
            count={tasks.length}
            onClick={() => togglePanel("quests")}
          />
          <ActionButton
            label="JOURNAL"
            hotkey="J"
            active={activePanel === "journal"}
            count={events.length}
            onClick={() => togglePanel("journal")}
          />
          <ActionButton
            label="PARTY"
            hotkey="P"
            active={activePanel === "party"}
            count={agentEvents.length}
            onClick={() => togglePanel("party")}
          />
          <ActionButton
            label="COUNCIL"
            hotkey="C"
            active={activePanel === "council"}
            count={meetings.length}
            onClick={() => togglePanel("council")}
          />

          <div
            className="w-px h-6 mx-1"
            style={{ background: "var(--rpg-border)" }}
          />

          <button
            onClick={() => setShowCommand(true)}
            className="rpg-action-btn primary-action"
          >
            <span className="hotkey">SPACE</span>
            COMMAND
          </button>

          <div
            className="w-px h-6 mx-1"
            style={{ background: "var(--rpg-border)" }}
          />
          <div
            className="flex items-center gap-3 rpg-mono text-[10px]"
            style={{ color: "var(--rpg-text-dim)" }}
          >
            <span>
              <span style={{ color: "var(--rpg-forest-dark)" }}>
                {doneTasks.length}
              </span>{" "}
              done
            </span>
            <span>
              <span style={{ color: "var(--rpg-forest)" }}>
                {activeTasks.length}
              </span>{" "}
              active
            </span>
            <span>
              <span style={{ color: "var(--rpg-text-dim)" }}>
                {tasks.length}
              </span>{" "}
              total
            </span>
          </div>
        </div>
      </div>

      {activePanel === "quests" && (
        <RPGPanel title="QUEST LOG" onClose={() => setActivePanel(null)}>
          {tasks.length === 0 ? (
            <EmptyState>No quests assigned</EmptyState>
          ) : (
            <div className="flex flex-col">
              {activeTasks.length > 0 && (
                <SectionHeader label="Active" count={activeTasks.length} />
              )}
              {activeTasks.map((t) => (
                <QuestEntry key={t.id} task={t} />
              ))}

              {proposedTasks.length > 0 && (
                <SectionHeader
                  label="Proposed"
                  count={proposedTasks.length}
                />
              )}
              {proposedTasks.map((t) => (
                <QuestEntry key={t.id} task={t} />
              ))}

              {doneTasks.length > 0 && (
                <SectionHeader label="Complete" count={doneTasks.length} />
              )}
              {doneTasks.map((t) => (
                <QuestEntry key={t.id} task={t} />
              ))}

              {tasks.filter(
                (t) =>
                  !["assigned", "in_progress", "review", "proposed", "done"].includes(t.status),
              ).length > 0 && <SectionHeader label="Other" />}
              {tasks
                .filter(
                  (t) =>
                    !["assigned", "in_progress", "review", "proposed", "done"].includes(t.status),
                )
                .map((t) => (
                  <QuestEntry key={t.id} task={t} />
                ))}
            </div>
          )}

          {tasks.length > 0 && (
            <div className="px-3 py-2 border-t" style={{ borderColor: "var(--rpg-border)" }}>
              <div className="flex items-center justify-between mb-1">
                <span
                  className="rpg-mono text-[10px]"
                  style={{ color: "var(--rpg-text-muted)" }}
                >
                  Overall Progress
                </span>
                <span
                  className="rpg-mono text-[10px]"
                  style={{ color: "var(--rpg-sage)" }}
                >
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
        <RPGPanel title="EVENT JOURNAL" onClose={() => setActivePanel(null)}>
          <div ref={logRef} className="flex-1 overflow-y-auto">
            {events.length === 0 ? (
              <EmptyState>No events recorded</EmptyState>
            ) : (
              [...events]
                .reverse()
                .slice(0, 80)
                .map((e) => (
                  <div key={e.eventId} className="log-entry">
                    <div className="flex items-center gap-2">
                      <span
                        className="rpg-mono text-[10px] tabular-nums"
                        style={{ color: "var(--rpg-text-muted)" }}
                      >
                        #{e.sequence}
                      </span>
                      <EventBadge type={e.type} />
                      <span
                        className="rpg-mono text-[10px] ml-auto"
                        style={{ color: "var(--rpg-text-muted)" }}
                      >
                        {relativeTime(e.occurredAt)} ago
                      </span>
                    </div>
                    {e.payload && Object.keys(e.payload).length > 0 && (
                      <div
                        className="rpg-mono text-[10px] mt-0.5 truncate"
                        style={{ color: "var(--rpg-text-dim)" }}
                      >
                        {formatPayload(e.payload)}
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        </RPGPanel>
      )}

      {activePanel === "party" && (
        <RPGPanel
          title="PARTY ACTIVITY"
          onClose={() => setActivePanel(null)}
        >
          <div ref={partyLogRef} className="flex-1 overflow-y-auto">
            {agentEvents.length === 0 ? (
              <EmptyState>No party activity</EmptyState>
            ) : (
              [...agentEvents]
                .reverse()
                .slice(0, 120)
                .map((e, i) => {
                  const agentLabel = e.agentId
                    .replace("agent-", "")
                    .toUpperCase();
                  return (
                    <div
                      key={`${e.occurredAt}-${i}`}
                      className="log-entry"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rpg-mono text-[10px]"
                          style={{ color: "var(--rpg-text-muted)" }}
                        >
                          {relativeTime(e.occurredAt)}
                        </span>
                        <span
                          className="rpg-mono text-[10px] font-medium"
                          style={{ color: "var(--rpg-gold)" }}
                        >
                          {agentLabel}
                        </span>
                        <AgentEventBadge type={e.type} />
                      </div>

                      {e.type === "agent.output.produced" && e.content && (
                        <div className="log-output">
                          <p className="rpg-mono text-[10px] whitespace-pre-wrap break-words">
                            {e.content.slice(0, 400)}
                            {(e.content.length ?? 0) > 400 ? "\u2026" : ""}
                          </p>
                        </div>
                      )}

                      {e.type === "agent.tool.invoked" && e.toolName && (
                        <div className="log-tool">
                          <span
                            className="rpg-mono text-[10px]"
                            style={{ color: "var(--rpg-sand)" }}
                          >
                            {e.toolName}
                          </span>
                        </div>
                      )}

                      {e.type === "agent.error" && e.error && (
                        <div className="log-error">
                          <p className="rpg-mono text-[10px]">
                            {e.error.slice(0, 200)}
                          </p>
                        </div>
                      )}

                      {e.type === "agent.turn.completed" && (
                        <div className="flex gap-3 mt-0.5">
                          {e.costUsd !== undefined && (
                            <span
                              className="rpg-mono text-[10px]"
                              style={{ color: "var(--rpg-text-muted)" }}
                            >
                              ${e.costUsd.toFixed(4)}
                            </span>
                          )}
                          {e.durationMs !== undefined && (
                            <span
                              className="rpg-mono text-[10px]"
                              style={{ color: "var(--rpg-text-muted)" }}
                            >
                              {(e.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>
        </RPGPanel>
      )}

      {activePanel === "approvals" && (
        <RPGPanel
          title="PENDING DECREES"
          onClose={() => setActivePanel(null)}
        >
          {proposedTasks.length === 0 ? (
            <EmptyState>No decrees pending</EmptyState>
          ) : (
            proposedTasks.map((t) => {
              const meetingId = (t.input as Record<string, unknown> | null)
                ?.proposedByMeeting as string | undefined;
              const meeting = meetingId
                ? meetings.find((m) => m.id === meetingId)
                : undefined;
              return (
                <div
                  key={t.id}
                  className="px-3 py-3 space-y-2"
                  style={{
                    borderBottom: "1px solid var(--rpg-border)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="rpg-mono text-[10px] uppercase"
                      style={{ color: "var(--rpg-copper)" }}
                    >
                      {t.taskType}
                    </span>
                    <span
                      className="rpg-mono text-[11px]"
                      style={{ color: "var(--rpg-text)" }}
                    >
                      {t.title}
                    </span>
                  </div>
                  {t.description && (
                    <p
                      className="rpg-mono text-[10px]"
                      style={{ color: "var(--rpg-text-dim)" }}
                    >
                      {t.description.slice(0, 150)}
                      {t.description.length > 150 ? "\u2026" : ""}
                    </p>
                  )}
                  {meeting && (
                    <div className="flex items-center gap-2">
                      <span
                        className="rpg-mono text-[10px]"
                        style={{ color: "var(--rpg-text-muted)" }}
                      >
                        Proposed during {meeting.meetingType} council
                      </span>
                      <button
                        onClick={() => {
                          setHighlightMeetingId(meeting.id);
                          setActivePanel("council");
                        }}
                        className="rpg-mono text-[9px] px-1.5 py-0.5 cursor-pointer transition-all"
                        style={{
                          background: "rgba(200, 169, 110, 0.1)",
                          border: "1px solid var(--rpg-gold-dim)",
                          color: "var(--rpg-gold-dim)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(200, 169, 110, 0.2)";
                          e.currentTarget.style.color = "var(--rpg-gold)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(200, 169, 110, 0.1)";
                          e.currentTarget.style.color = "var(--rpg-gold-dim)";
                        }}
                      >
                        VIEW COUNCIL
                      </button>
                    </div>
                  )}
                  {meetingId && (
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() =>
                          approveProposedTasks({
                            meetingId,
                            approvedTaskIds: [t.id],
                            rejectedTaskIds: [],
                          })
                        }
                        className="rpg-mono text-[10px] px-3 py-1 cursor-pointer transition-all"
                        style={{
                          background: "rgba(106, 153, 78, 0.2)",
                          border: "1px solid rgba(106, 153, 78, 0.4)",
                          color: "#6a994e",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(106, 153, 78, 0.35)";
                          e.currentTarget.style.borderColor = "#6a994e";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(106, 153, 78, 0.2)";
                          e.currentTarget.style.borderColor = "rgba(106, 153, 78, 0.4)";
                        }}
                      >
                        APPROVE
                      </button>
                      <button
                        onClick={() =>
                          approveProposedTasks({
                            meetingId,
                            approvedTaskIds: [],
                            rejectedTaskIds: [t.id],
                          })
                        }
                        className="rpg-mono text-[10px] px-3 py-1 cursor-pointer transition-all"
                        style={{
                          background: "rgba(196, 92, 74, 0.15)",
                          border: "1px solid rgba(196, 92, 74, 0.3)",
                          color: "#c45c4a",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(196, 92, 74, 0.3)";
                          e.currentTarget.style.borderColor = "#c45c4a";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(196, 92, 74, 0.15)";
                          e.currentTarget.style.borderColor = "rgba(196, 92, 74, 0.3)";
                        }}
                      >
                        REJECT
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
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
          title="SUSPENDED QUESTS"
          onClose={() => setActivePanel(null)}
        >
          {suspendedTasks.length === 0 ? (
            <EmptyState>No suspended quests</EmptyState>
          ) : (
            suspendedTasks.map((t) => (
              <div
                key={t.id}
                className="px-3 py-3 space-y-2"
                style={{
                  borderBottom: "1px solid var(--rpg-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rpg-mono text-[10px] uppercase"
                    style={{ color: "#f59e0b" }}
                  >
                    {t.taskType}
                  </span>
                  <span
                    className="rpg-mono text-[11px]"
                    style={{ color: "var(--rpg-text)" }}
                  >
                    {t.title}
                  </span>
                </div>
                {t.description && (
                  <p
                    className="rpg-mono text-[10px]"
                    style={{ color: "var(--rpg-text-dim)" }}
                  >
                    {t.description.slice(0, 150)}
                    {t.description.length > 150 ? "\u2026" : ""}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span
                    className="rpg-mono text-[10px]"
                    style={{ color: "var(--rpg-text-muted)" }}
                  >
                    Awaiting credits to resume
                  </span>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => resumeSuspendedTask(t.id)}
                    className="rpg-mono text-[10px] px-3 py-1 cursor-pointer transition-all"
                    style={{
                      background: "rgba(106, 153, 78, 0.2)",
                      border: "1px solid rgba(106, 153, 78, 0.4)",
                      color: "#6a994e",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(106, 153, 78, 0.35)";
                      e.currentTarget.style.borderColor = "#6a994e";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(106, 153, 78, 0.2)";
                      e.currentTarget.style.borderColor = "rgba(106, 153, 78, 0.4)";
                    }}
                  >
                    RESUME
                  </button>
                </div>
              </div>
            ))
          )}
        </RPGPanel>
      )}

      <CommandBar
        open={showCommand}
        onClose={() => setShowCommand(false)}
      />
    </>
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
    <button
      onClick={onClick}
      className={`rpg-action-btn ${active ? "active" : ""}`}
    >
      <span className="hotkey">{hotkey}</span>
      {label}
      {count !== undefined && (
        <span style={{ opacity: 0.4, fontSize: 9 }}>{count}</span>
      )}
    </button>
  );
}

function RPGPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-10 left-4 w-80 pointer-events-auto flex flex-col rpg-panel overflow-hidden"
      style={{ bottom: 56, maxHeight: "calc(var(--app-height, 100%) - 70px)" }}
    >
      <div className="rpg-panel-header flex items-center justify-between">
        <span>{title}</span>
        <button
          onClick={onClose}
          className="cursor-pointer transition-colors"
          style={{ color: "var(--rpg-text-muted)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--rpg-text)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--rpg-text-muted)")
          }
        >
          &times;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col">{children}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rpg-mono text-[10px] text-center py-8"
      style={{ color: "var(--rpg-text-muted)" }}
    >
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
    <div
      className="rpg-font text-[10px] px-3 py-1.5 tracking-wider uppercase"
      style={{
        color: "var(--rpg-gold-dim)",
        background: "rgba(200, 169, 110, 0.05)",
        borderBottom: "1px solid var(--rpg-border)",
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{ opacity: 0.5, marginLeft: 6 }}>{count}</span>
      )}
    </div>
  );
}

function QuestEntry({
  task,
}: {
  task: {
    id: string;
    taskType: string;
    title: string;
    description: string;
    status: string;
    ownerRole: string | null;
  };
}) {
  const color = STATUS_COLORS[task.status] ?? "var(--rpg-text-dim)";
  const icon = STATUS_ICONS[task.status] ?? "\u25cb";

  return (
    <div
      className="flex items-start gap-2 px-3 py-2"
      style={{ borderBottom: "1px solid rgba(58, 74, 53, 0.2)" }}
    >
      <span className="rpg-mono text-[10px] mt-px" style={{ color }}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="rpg-mono text-[10px] truncate"
            style={{ color: "var(--rpg-text)" }}
          >
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {task.ownerRole && (
            <span
              className="rpg-mono text-[10px] uppercase"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              {task.ownerRole}
            </span>
          )}
          <span className="rpg-mono text-[10px] uppercase" style={{ color }}>
            {task.status.replace("_", " ")}
          </span>
        </div>
      </div>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  const colorMap: Record<string, string> = {
    TaskCreated: "var(--rpg-sage)",
    TaskStatusChanged: "var(--rpg-forest)",
    TaskAssigned: "var(--rpg-sage-dim)",
    MeetingStarted: "var(--rpg-gold)",
    MeetingCompleted: "var(--rpg-gold-dim)",
    MeetingContributionAdded: "var(--rpg-copper)",
    TasksProposedFromMeeting: "var(--rpg-copper)",
    ProposedTasksApproved: "var(--rpg-forest-dark)",
  };

  return (
    <span
      className="rpg-mono text-[10px]"
      style={{ color: colorMap[type] ?? "var(--rpg-text-dim)" }}
    >
      {type.replace(/([A-Z])/g, " $1").trim()}
    </span>
  );
}

function AgentEventBadge({ type }: { type: string }) {
  const colorMap: Record<string, string> = {
    "agent.output.produced": "var(--rpg-sage)",
    "agent.tool.invoked": "var(--rpg-sand)",
    "agent.error": "var(--rpg-danger)",
    "agent.turn.completed": "var(--rpg-forest-dark)",
    "agent.turn.started": "var(--rpg-forest)",
  };

  const shortType = type.replace("agent.", "");

  return (
    <span
      className="rpg-mono text-[10px]"
      style={{ color: colorMap[type] ?? "var(--rpg-text-dim)" }}
    >
      {shortType}
    </span>
  );
}

function formatPayload(payload: Record<string, unknown>): string {
  const title = payload.title as string | undefined;
  const status = payload.status as string | undefined;
  const role = payload.role as string | undefined;
  const meetingType = payload.meetingType as string | undefined;

  const parts: string[] = [];
  if (title) parts.push(title);
  if (status) parts.push(`\u2192 ${status}`);
  if (role) parts.push(`[${role}]`);
  if (meetingType) parts.push(meetingType);

  return parts.join(" ") || JSON.stringify(payload).slice(0, 80);
}
