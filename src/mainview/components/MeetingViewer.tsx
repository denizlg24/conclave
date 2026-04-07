import { useState, useEffect } from "react";
import type { SerializedMeeting } from "../../shared/rpc/rpc-schema";

const MEETING_STATUS_COLORS: Record<string, string> = {
  in_progress: "var(--rpg-sage)",
  completed: "var(--rpg-forest-dark)",
  scheduled: "var(--rpg-gold-dim)",
  cancelled: "var(--rpg-danger)",
};

interface MeetingViewerProps {
  meetings: SerializedMeeting[];
  highlightMeetingId?: string | null;
  onClose: () => void;
}

export function MeetingViewer({
  meetings,
  highlightMeetingId,
  onClose,
}: MeetingViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(
    highlightMeetingId ?? null,
  );

  useEffect(() => {
    if (highlightMeetingId) setExpandedId(highlightMeetingId);
  }, [highlightMeetingId]);

  const inProgress = meetings.filter((m) => m.status === "in_progress");
  const others = meetings.filter((m) => m.status !== "in_progress");

  return (
    <div
      className="absolute top-10 left-4 w-80 pointer-events-auto flex flex-col rpg-panel overflow-hidden"
      style={{ bottom: 56, maxHeight: "calc(var(--app-height, 100%) - 70px)" }}
    >
      <div className="rpg-panel-header flex items-center justify-between">
        <span>COUNCIL CHAMBERS</span>
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

      <div className="flex-1 overflow-y-auto flex flex-col">
        {meetings.length === 0 ? (
          <p
            className="rpg-mono text-[10px] text-center py-8"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            No councils convened
          </p>
        ) : (
          <>
            {inProgress.length > 0 && (
              <>
                <SectionHeader label="In Session" count={inProgress.length} />
                {inProgress.map((m) => (
                  <MeetingEntry
                    key={m.id}
                    meeting={m}
                    expanded={expandedId === m.id}
                    highlighted={highlightMeetingId === m.id}
                    onToggle={() =>
                      setExpandedId(expandedId === m.id ? null : m.id)
                    }
                  />
                ))}
              </>
            )}
            {others.length > 0 && (
              <>
                <SectionHeader label="Completed" count={others.length} />
                {others.map((m) => (
                  <MeetingEntry
                    key={m.id}
                    meeting={m}
                    expanded={expandedId === m.id}
                    highlighted={highlightMeetingId === m.id}
                    onToggle={() =>
                      setExpandedId(expandedId === m.id ? null : m.id)
                    }
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
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

function MeetingEntry({
  meeting,
  expanded,
  highlighted,
  onToggle,
}: {
  meeting: SerializedMeeting;
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
}) {
  const statusColor =
    MEETING_STATUS_COLORS[meeting.status] ?? "var(--rpg-text-dim)";

  const byAgendaItem = meeting.contributions.reduce<
    Record<number, SerializedMeeting["contributions"]>
  >((acc, c) => {
    if (!acc[c.agendaItemIndex]) acc[c.agendaItemIndex] = [];
    acc[c.agendaItemIndex].push(c);
    return acc;
  }, {});

  return (
    <div
      style={{
        borderBottom: "1px solid var(--rpg-border)",
        background: highlighted ? "rgba(200, 169, 110, 0.06)" : undefined,
        outline: highlighted ? "1px solid var(--rpg-gold-dim)" : undefined,
        outlineOffset: "-1px",
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
        style={{ background: "transparent" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(200, 169, 110, 0.04)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "transparent")
        }
      >
        <span
          className="rpg-mono text-[10px]"
          style={{ color: "var(--rpg-text-muted)" }}
        >
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className="rpg-mono text-[10px] uppercase font-medium"
          style={{ color: "var(--rpg-gold)" }}
        >
          {meeting.meetingType}
        </span>
        <span
          className="rpg-mono text-[10px] ml-auto uppercase"
          style={{ color: statusColor }}
        >
          {meeting.status.replace("_", " ")}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {meeting.participants.length > 0 && (
            <div>
              <span
                className="rpg-mono text-[9px] uppercase tracking-widest block mb-1"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                Participants
              </span>
              <div className="flex flex-wrap gap-1">
                {meeting.participants.map((p) => (
                  <span
                    key={p}
                    className="rpg-mono text-[10px] px-1.5 py-0.5 uppercase"
                    style={{
                      background: "rgba(129, 178, 154, 0.12)",
                      border: "1px solid rgba(129, 178, 154, 0.25)",
                      color: "var(--rpg-sage)",
                    }}
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {meeting.agenda.length > 0 && (
            <div className="space-y-2">
              <span
                className="rpg-mono text-[9px] uppercase tracking-widest block"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                Agenda
              </span>
              {meeting.agenda.map((item, idx) => (
                <div key={idx}>
                  <div
                    className="rpg-mono text-[10px] py-0.5"
                    style={{
                      color: "var(--rpg-text-dim)",
                      borderLeft: "2px solid var(--rpg-border)",
                      paddingLeft: 6,
                    }}
                  >
                    {item}
                  </div>
                  {byAgendaItem[idx]?.map((c, ci) => (
                    <div
                      key={ci}
                      className="mt-1 ml-3 pl-2"
                      style={{
                        borderLeft: "1px solid rgba(129, 178, 154, 0.2)",
                      }}
                    >
                      <span
                        className="rpg-mono text-[9px] uppercase"
                        style={{ color: "var(--rpg-copper)" }}
                      >
                        {c.agentRole}
                      </span>
                      <p
                        className="rpg-mono text-[10px] mt-0.5"
                        style={{ color: "var(--rpg-text-dim)" }}
                      >
                        {c.content.slice(0, 200)}
                        {c.content.length > 200 ? "…" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {meeting.summary && (
            <div>
              <span
                className="rpg-mono text-[9px] uppercase tracking-widest block mb-1"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                Summary
              </span>
              <p
                className="rpg-mono text-[10px] px-2 py-1.5"
                style={{
                  color: "var(--rpg-text)",
                  background: "rgba(200, 169, 110, 0.04)",
                  border: "1px solid rgba(200, 169, 110, 0.12)",
                }}
              >
                {meeting.summary}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
