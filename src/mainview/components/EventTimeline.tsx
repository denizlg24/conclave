import { useRef, useEffect } from "react";
import { useConclave } from "../hooks/use-conclave";

const EVENT_COLORS: Record<string, string> = {
  "task.created": "text-green-400",
  "task.assigned": "text-blue-400",
  "task.status-updated": "text-yellow-400",
  "task.dependency-added": "text-gray-400",
  "task.dependency-removed": "text-gray-400",
  "meeting.scheduled": "text-violet-400",
  "meeting.started": "text-violet-300",
  "meeting.contribution-added": "text-violet-200",
  "meeting.completed": "text-violet-500",
  "meeting.tasks-approved": "text-emerald-400",
};

function formatPayload(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "task.created":
      return `"${payload.title}" (${payload.taskType})${payload.initialStatus === "proposed" ? " [proposed]" : ""}`;
    case "task.assigned":
      return `${String(payload.taskId).slice(0, 8)} -> ${payload.agentRole}`;
    case "task.status-updated":
      return `${String(payload.taskId).slice(0, 8)}: ${payload.previousStatus} -> ${payload.status}`;
    case "task.dependency-added":
      return `${String(payload.taskId).slice(0, 8)} depends on ${String(payload.dependsOn).slice(0, 8)}`;
    case "meeting.scheduled":
      return `${payload.meetingType} meeting with ${(payload.participants as string[]).join(", ")}`;
    case "meeting.started":
      return `Meeting ${String(payload.meetingId).slice(0, 8)} started`;
    case "meeting.contribution-added":
      return `${payload.agentRole} contributed to agenda item ${(payload.agendaItemIndex as number) + 1}`;
    case "meeting.completed":
      return `Meeting completed, ${(payload.proposedTaskIds as string[]).length} task(s) proposed`;
    case "meeting.tasks-approved":
      return `${(payload.approvedTaskIds as string[]).length} approved, ${(payload.rejectedTaskIds as string[]).length} rejected`;
    default:
      return JSON.stringify(payload).slice(0, 80);
  }
}

export function EventTimeline() {
  const { events } = useConclave();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto space-y-1 p-2 font-mono text-xs"
    >
      {events.length === 0 ? (
        <p className="text-gray-600 text-center py-8">
          No events yet. Create a task to get started.
        </p>
      ) : (
        events.map((event) => (
          <div
            key={event.eventId}
            className="flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-800/40"
          >
            <span className="text-gray-600 shrink-0 tabular-nums">
              #{event.sequence}
            </span>
            <span
              className={`shrink-0 ${EVENT_COLORS[event.type] ?? "text-gray-400"}`}
            >
              {event.type}
            </span>
            <span className="text-gray-500 truncate">
              {formatPayload(event.type, event.payload)}
            </span>
            <span className="text-gray-700 shrink-0 ml-auto">
              {new Date(event.occurredAt).toLocaleTimeString()}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
