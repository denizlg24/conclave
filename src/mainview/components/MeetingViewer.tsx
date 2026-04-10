import { useEffect, useState } from "react";
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
  const [expandedId, setExpandedId] = useState<string | null>(highlightMeetingId ?? null);

  useEffect(() => {
    if (highlightMeetingId) {
      setExpandedId(highlightMeetingId);
    }
  }, [highlightMeetingId]);

  const sortedMeetings = [...meetings].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  const inSessionCount = meetings.filter((meeting) => meeting.status === "in_progress").length;
  const proposedCount = meetings.reduce(
    (sum, meeting) => sum + meeting.proposedTaskIds.length,
    0,
  );

  return (
    <div
      className="absolute top-16 left-4 z-30 pointer-events-auto flex min-h-0 flex-col overflow-hidden rpg-panel hud-panel-shell"
      style={{
        bottom: 72,
        width: "min(30rem, calc(100vw - 2rem))",
      }}
    >
      <div className="hud-panel-header">
        <div>
          <div className="hud-panel-header__title">Council Chambers</div>
          <p className="hud-panel-header__subtitle">Meetings, turns, summaries, and proposal outcomes.</p>
        </div>
        <button onClick={onClose} className="hud-panel-close" aria-label="Close council view">
          ×
        </button>
      </div>

      <div className="grid grid-cols-3 gap-px" style={{ background: "var(--rpg-border)" }}>
        <MeetingStat label="Meetings" value={String(meetings.length)} color="var(--rpg-gold)" />
        <MeetingStat label="Live" value={String(inSessionCount)} color="var(--rpg-sage)" />
        <MeetingStat label="Proposals" value={String(proposedCount)} color="var(--rpg-copper)" />
      </div>

      <div className="hud-panel-scroll">
        {sortedMeetings.length === 0 ? (
          <p className="hud-empty-state">No councils have been convened for this project.</p>
        ) : (
          <div className="space-y-3 p-3">
            {sortedMeetings.map((meeting) => (
              <MeetingEntry
                key={meeting.id}
                meeting={meeting}
                expanded={expandedId === meeting.id}
                highlighted={highlightMeetingId === meeting.id}
                onToggle={() =>
                  setExpandedId((current) => (current === meeting.id ? null : meeting.id))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MeetingStat({
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
  const statusColor = MEETING_STATUS_COLORS[meeting.status] ?? "var(--rpg-text-dim)";
  const groupedContributions = meeting.contributions.reduce<
    Record<number, SerializedMeeting["contributions"]>
  >((accumulator, contribution) => {
    if (!accumulator[contribution.agendaItemIndex]) {
      accumulator[contribution.agendaItemIndex] = [];
    }

    accumulator[contribution.agendaItemIndex].push(contribution);
    return accumulator;
  }, {});

  return (
    <article
      className="hud-list-card"
      style={{
        outline: highlighted ? "1px solid rgba(200, 169, 110, 0.5)" : "none",
        boxShadow: highlighted ? "0 0 0 1px rgba(200, 169, 110, 0.15)" : undefined,
      }}
    >
      <button onClick={onToggle} className="w-full text-left">
        <div className="hud-list-card__header">
          <div>
            <div className="hud-list-card__title">{humanizeValue(meeting.meetingType)}</div>
            <div className="hud-inline-tags mt-2">
              <span className="hud-tag" style={{ borderColor: `${statusColor}44`, color: statusColor }}>
                {humanizeValue(meeting.status)}
              </span>
              <span className="hud-file-chip">{meeting.participants.length} participants</span>
              <span className="hud-file-chip">{meeting.agenda.length} agenda items</span>
            </div>
          </div>
          <span className="hud-list-card__time">{expanded ? "Hide" : "Open"}</span>
        </div>
      </button>

      <div className="hud-summary-list">
        <div className="hud-summary-line">
          <span className="hud-summary-line__label">Updated</span>
          <span className="hud-summary-line__value">{formatTime(meeting.updatedAt)}</span>
        </div>
        <div className="hud-summary-line">
          <span className="hud-summary-line__label">Outcomes</span>
          <span className="hud-summary-line__value">
            {meeting.approvedTaskIds.length} approved / {meeting.rejectedTaskIds.length} rejected
          </span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {meeting.participants.length > 0 && (
            <div>
              <div className="hud-file-block__label">Participants</div>
              <div className="hud-inline-tags">
                {meeting.participants.map((participant) => (
                  <span key={participant} className="hud-file-chip">
                    {participant}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="hud-file-block__label">Agenda</div>
            {meeting.agenda.map((item, index) => (
              <div key={`${meeting.id}-${index}`} className="hud-agenda-item">
                <div className="hud-agenda-item__title">
                  {index + 1}. {item}
                </div>
                {groupedContributions[index]?.map((contribution, contributionIndex) => (
                  <div key={`${meeting.id}-${index}-${contributionIndex}`} className="hud-agenda-note">
                    <span className="hud-agenda-note__role">{contribution.agentRole}</span>
                    <p>{truncateText(contribution.content, 240)}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <OutcomeCard label="Proposed" value={meeting.proposedTaskIds.length} tone="var(--rpg-gold)" />
            <OutcomeCard label="Approved" value={meeting.approvedTaskIds.length} tone="var(--rpg-sage)" />
            <OutcomeCard label="Rejected" value={meeting.rejectedTaskIds.length} tone="var(--rpg-danger)" />
          </div>

          {meeting.summary && (
            <div className="hud-log-detail">
              <div className="hud-file-block__label">Summary</div>
              <p>{meeting.summary}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function OutcomeCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="hud-metric-card">
      <span className="hud-metric-card__label">{label}</span>
      <span className="hud-metric-card__value" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function humanizeValue(value: string): string {
  return value.replace(/[_.-]+/g, " ");
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}
