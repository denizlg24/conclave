import { useEffect, useMemo, useRef } from "react";
import type { SerializedEvent } from "../../shared/rpc/rpc-schema";
import { useConclave } from "../hooks/use-conclave";

const EVENT_STYLES: Record<string, { accent: string; label: string }> = {
  TaskCreated: { accent: "var(--rpg-sage)", label: "task" },
  TaskAssigned: { accent: "var(--rpg-forest)", label: "assignment" },
  TaskStatusChanged: { accent: "var(--rpg-copper)", label: "status" },
  MeetingStarted: { accent: "var(--rpg-gold)", label: "meeting" },
  MeetingCompleted: { accent: "var(--rpg-gold-dim)", label: "meeting" },
  MeetingContributionAdded: { accent: "var(--rpg-sand)", label: "contribution" },
  TasksProposedFromMeeting: { accent: "var(--rpg-copper)", label: "proposal" },
  ProposedTasksApproved: { accent: "var(--rpg-forest-dark)", label: "approval" },
  "task.created": { accent: "var(--rpg-sage)", label: "task" },
  "task.assigned": { accent: "var(--rpg-forest)", label: "assignment" },
  "task.status-updated": { accent: "var(--rpg-copper)", label: "status" },
  "meeting.started": { accent: "var(--rpg-gold)", label: "meeting" },
  "meeting.completed": { accent: "var(--rpg-gold-dim)", label: "meeting" },
  "meeting.contribution-added": { accent: "var(--rpg-sand)", label: "contribution" },
  "meeting.tasks-approved": { accent: "var(--rpg-forest-dark)", label: "approval" },
};

interface EventTimelineProps {
  events?: SerializedEvent[];
  embedded?: boolean;
  maxItems?: number;
}

export function EventTimeline({
  events: providedEvents,
  embedded = false,
  maxItems = 160,
}: EventTimelineProps) {
  const { events: storeEvents } = useConclave();
  const events = providedEvents ?? storeEvents;
  const scrollRef = useRef<HTMLDivElement>(null);

  const visibleEvents = useMemo(
    () => [...events].slice(-maxItems).reverse(),
    [events, maxItems],
  );

  useEffect(() => {
    if (!scrollRef.current || visibleEvents.length === 0) {
      return;
    }

    scrollRef.current.scrollTop = 0;
  }, [visibleEvents.length]);

  return (
    <div
      ref={scrollRef}
      className={`min-h-0 ${embedded ? "flex-1" : "h-full"} overflow-y-auto px-3 py-3`}
    >
      {visibleEvents.length === 0 ? (
        <p className="hud-empty-state">No events yet. Create a task to start the event log.</p>
      ) : (
        <div className="space-y-2">
          {visibleEvents.map((event) => {
            const style = EVENT_STYLES[event.type] ?? {
              accent: "var(--rpg-text-dim)",
              label: "event",
            };

            return (
              <article key={event.eventId} className="hud-log-card">
                <div className="hud-log-card__header">
                  <div className="hud-log-card__meta">
                    <span className="hud-log-card__agent" style={{ color: style.accent }}>
                      {style.label}
                    </span>
                    <span>{humanizeEventType(event.type)}</span>
                    <span>#{event.sequence}</span>
                  </div>
                  <span className="hud-log-card__time">
                    {formatAbsoluteTime(event.occurredAt)}
                  </span>
                </div>

                <p className="hud-log-card__summary">{describeEvent(event)}</p>

                <div className="hud-inline-tags">
                  {extractEventChips(event).map((chip) => (
                    <span key={`${event.eventId}-${chip}`} className="hud-file-chip">
                      {chip}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function describeEvent(event: SerializedEvent): string {
  const payload = event.payload;

  switch (event.type) {
    case "TaskCreated":
    case "task.created":
      return `"${readString(payload.title) ?? "Untitled"}" created as ${readString(payload.taskType) ?? "task"}.`;
    case "TaskAssigned":
    case "task.assigned":
      return `${shrinkId(payload.taskId)} assigned to ${readString(payload.agentRole) ?? readString(payload.role) ?? "agent"}.`;
    case "TaskStatusChanged":
    case "task.status-updated":
      return `${shrinkId(payload.taskId)} moved ${readString(payload.previousStatus) ?? "unknown"} → ${readString(payload.status) ?? "unknown"}.`;
    case "MeetingStarted":
    case "meeting.started":
      return `${humanizeValue(readString(payload.meetingType) ?? "meeting")} started.`;
    case "MeetingContributionAdded":
    case "meeting.contribution-added":
      return `${readString(payload.agentRole) ?? "Agent"} contributed to agenda item ${readNumber(payload.agendaItemIndex) !== null ? readNumber(payload.agendaItemIndex)! + 1 : "?"}.`;
    case "MeetingCompleted":
    case "meeting.completed":
      return `${humanizeValue(readString(payload.meetingType) ?? "meeting")} completed.`;
    case "TasksProposedFromMeeting":
      return `${readStringArray(payload.proposedTaskIds).length} task proposals generated from the meeting.`;
    case "ProposedTasksApproved":
    case "meeting.tasks-approved":
      return `${readStringArray(payload.approvedTaskIds).length} approved, ${readStringArray(payload.rejectedTaskIds).length} rejected.`;
    default:
      return compactJson(payload);
  }
}

function extractEventChips(event: SerializedEvent): string[] {
  const payload = event.payload;
  const chips: string[] = [];

  const title = readString(payload.title);
  const taskId = readString(payload.taskId);
  const meetingId = readString(payload.meetingId);
  const role = readString(payload.agentRole) ?? readString(payload.role);
  const meetingType = readString(payload.meetingType);

  if (title) chips.push(truncateText(title, 32));
  if (taskId) chips.push(`task ${shrinkId(taskId)}`);
  if (meetingId) chips.push(`meeting ${shrinkId(meetingId)}`);
  if (role) chips.push(role);
  if (meetingType) chips.push(humanizeValue(meetingType));

  return chips.slice(0, 4);
}

function humanizeEventType(value: string): string {
  return value
    .replace(/\./g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

function humanizeValue(value: string): string {
  return value.replace(/[_.-]+/g, " ");
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shrinkId(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 8) : "unknown";
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function compactJson(payload: Record<string, unknown>): string {
  return truncateText(JSON.stringify(payload), 160);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
