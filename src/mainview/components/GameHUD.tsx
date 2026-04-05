import { useState } from "react";
import { useConclave } from "../hooks/use-conclave";
import { CreateTaskDialog } from "./CreateTaskDialog";

const STATUS_COLORS: Record<string, string> = {
  proposed: "#a78bfa",
  pending: "#facc15",
  assigned: "#60a5fa",
  in_progress: "#22d3ee",
  review: "#fb923c",
  done: "#4ade80",
  failed: "#f87171",
  blocked: "#9ca3af",
  rejected: "#fca5a5",
};

type Panel = "tasks" | "events" | "approvals" | null;

export function GameHUD() {
  const { readModel, events, connected, approveProposedTasks } = useConclave();
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);

  const tasks = readModel?.tasks ?? [];
  const meetings = readModel?.meetings ?? [];
  const proposedTasks = tasks.filter((t) => t.status === "proposed");
  const activeTasks = tasks.filter((t) =>
    ["assigned", "in_progress", "review"].includes(t.status),
  );

  const togglePanel = (panel: Panel) =>
    setActivePanel((prev) => (prev === panel ? null : panel));

  return (
    <>
      {/* Top bar — status indicators */}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-3 px-3 py-1.5 pointer-events-auto"
        style={{ fontFamily: "monospace" }}
      >
        <span className="flex items-center gap-1.5 text-[10px] text-white/70 bg-black/50 px-2 py-0.5 rounded-sm border border-white/10">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`} />
          {connected ? "ONLINE" : "OFFLINE"}
        </span>
        <span className="text-[10px] text-white/50 bg-black/50 px-2 py-0.5 rounded-sm border border-white/10">
          SEQ:{readModel?.snapshotSequence ?? 0}
        </span>
        {proposedTasks.length > 0 && (
          <button
            onClick={() => togglePanel("approvals")}
            className="text-[10px] text-violet-300 bg-violet-900/60 px-2 py-0.5 rounded-sm border border-violet-500/40 animate-pulse cursor-pointer"
          >
            {proposedTasks.length} AWAITING APPROVAL
          </button>
        )}
      </div>

      {/* Right side — action buttons */}
      <div className="absolute top-12 right-3 flex flex-col gap-2 pointer-events-auto">
        <HUDButton label="TASKS" count={tasks.length} onClick={() => togglePanel("tasks")} active={activePanel === "tasks"} />
        <HUDButton label="LOG" count={events.length} onClick={() => togglePanel("events")} active={activePanel === "events"} />
        <HUDButton
          label="+ NEW"
          onClick={() => setShowCreateTask(true)}
          color="bg-blue-900/70 border-blue-400/40 text-blue-300"
        />
      </div>

      {/* Bottom HUD — active tasks ticker */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-black/60 border-t border-white/10"
          style={{ fontFamily: "monospace" }}
        >
          <span className="text-[10px] text-white/40 uppercase shrink-0">Active:</span>
          {activeTasks.length === 0 ? (
            <span className="text-[10px] text-white/30 italic">No active tasks</span>
          ) : (
            <div className="flex gap-2 overflow-x-auto">
              {activeTasks.map((t) => (
                <span
                  key={t.id}
                  className="text-[10px] px-2 py-0.5 rounded-sm border shrink-0"
                  style={{
                    color: STATUS_COLORS[t.status] ?? "#fff",
                    borderColor: `${STATUS_COLORS[t.status] ?? "#fff"}44`,
                    backgroundColor: `${STATUS_COLORS[t.status] ?? "#fff"}15`,
                  }}
                >
                  [{t.taskType.slice(0, 3).toUpperCase()}] {t.title.slice(0, 30)}
                </span>
              ))}
            </div>
          )}
          <div className="ml-auto flex gap-3 shrink-0">
            {Object.entries(
              tasks.reduce<Record<string, number>>((acc, t) => {
                acc[t.status] = (acc[t.status] ?? 0) + 1;
                return acc;
              }, {}),
            ).map(([status, count]) => (
              <span
                key={status}
                className="text-[10px]"
                style={{ color: STATUS_COLORS[status] ?? "#888" }}
              >
                {count} {status.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Slide-out panels */}
      {activePanel === "tasks" && (
        <SlidePanel title="TASK QUEUE" onClose={() => setActivePanel(null)}>
          {tasks.length === 0 ? (
            <p className="text-white/30 text-[11px] text-center py-4">Empty</p>
          ) : (
            tasks.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 py-1 px-2 border-b border-white/5"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: STATUS_COLORS[t.status] }}
                />
                <span className="text-[11px] text-white/80 truncate flex-1">
                  {t.title}
                </span>
                <span className="text-[9px] text-white/30 uppercase shrink-0">
                  {t.status}
                </span>
              </div>
            ))
          )}
        </SlidePanel>
      )}

      {activePanel === "events" && (
        <SlidePanel title="EVENT LOG" onClose={() => setActivePanel(null)}>
          {events.length === 0 ? (
            <p className="text-white/30 text-[11px] text-center py-4">No events</p>
          ) : (
            [...events].reverse().slice(0, 50).map((e) => (
              <div key={e.eventId} className="py-0.5 px-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-white/20 tabular-nums">#{e.sequence}</span>
                  <span className="text-[10px] text-cyan-400/80">{e.type}</span>
                  <span className="text-[9px] text-white/20 ml-auto">
                    {new Date(e.occurredAt).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </SlidePanel>
      )}

      {activePanel === "approvals" && (
        <SlidePanel title="APPROVAL QUEUE" onClose={() => setActivePanel(null)}>
          {proposedTasks.length === 0 ? (
            <p className="text-white/30 text-[11px] text-center py-4">Nothing to approve</p>
          ) : (
            <>
              {proposedTasks.map((t) => {
                const meetingId = (t.input as Record<string, unknown> | null)
                  ?.proposedByMeeting as string | undefined;
                const meeting = meetingId
                  ? meetings.find((m) => m.id === meetingId)
                  : undefined;
                return (
                  <div key={t.id} className="py-2 px-2 border-b border-white/5 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-violet-400 uppercase">{t.taskType}</span>
                      <span className="text-[11px] text-white/80">{t.title}</span>
                    </div>
                    {meeting && (
                      <span className="text-[9px] text-white/30">
                        from {meeting.meetingType} meeting
                      </span>
                    )}
                    {meetingId && (
                      <div className="flex gap-1 pt-1">
                        <button
                          onClick={() =>
                            approveProposedTasks({
                              meetingId,
                              approvedTaskIds: [t.id],
                              rejectedTaskIds: [],
                            })
                          }
                          className="text-[10px] px-2 py-0.5 bg-green-800/60 text-green-300 border border-green-500/30 rounded-sm hover:bg-green-700/60"
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
                          className="text-[10px] px-2 py-0.5 bg-red-800/60 text-red-300 border border-red-500/30 rounded-sm hover:bg-red-700/60"
                        >
                          REJECT
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </SlidePanel>
      )}

      <CreateTaskDialog open={showCreateTask} onClose={() => setShowCreateTask(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HUDButton({
  label,
  count,
  onClick,
  active,
  color,
}: {
  label: string;
  count?: number;
  onClick: () => void;
  active?: boolean;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2.5 py-1 rounded-sm border cursor-pointer transition-colors ${
        color ?? (active
          ? "bg-white/15 border-white/30 text-white"
          : "bg-black/50 border-white/10 text-white/60 hover:bg-black/70 hover:text-white/80")
      }`}
      style={{ fontFamily: "monospace" }}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1.5 opacity-50">{count}</span>
      )}
    </button>
  );
}

function SlidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute top-10 right-14 bottom-8 w-72 pointer-events-auto flex flex-col bg-black/80 border border-white/10 rounded-sm overflow-hidden backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-black/40">
        <span className="text-[11px] text-white/60 font-bold tracking-wider" style={{ fontFamily: "monospace" }}>
          {title}
        </span>
        <button
          onClick={onClose}
          className="text-white/30 hover:text-white/60 text-sm leading-none"
        >
          &times;
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
