import { useState } from "react";
import type { SerializedMeeting, SerializedTask } from "../../../shared/rpc/rpc-schema";
import { ProposalTaskCard } from "./ProposalTaskCard";

interface MeetingProposalGroupProps {
  meeting: SerializedMeeting;
  tasks: SerializedTask[];
  selected: Set<string>;
  onToggleTask: (taskId: string) => void;
  onApproveSelected: (meetingId: string, allTaskIds: string[]) => void;
  onApproveAll: (meetingId: string, taskIds: string[]) => void;
  onRejectAll: (meetingId: string, taskIds: string[]) => void;
  onViewCouncil: (meetingId: string) => void;
  processing: boolean;
  error: string | null;
}

export function MeetingProposalGroup({
  meeting,
  tasks,
  selected,
  onToggleTask,
  onApproveSelected,
  onApproveAll,
  onRejectAll,
  onViewCouncil,
  processing,
  error,
}: MeetingProposalGroupProps) {
  const [contextExpanded, setContextExpanded] = useState(false);

  const allTaskIds = tasks.map((t) => t.id);
  const selectedCount = allTaskIds.filter((id) => selected.has(id)).length;
  const anySelected = selectedCount > 0;
  const allSelected = selectedCount === allTaskIds.length;

  return (
    <div
      style={{
        border: "1px solid rgba(200, 169, 110, 0.2)",
        background: "rgba(200, 169, 110, 0.03)",
      }}
    >
      {/* Meeting header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 10px",
          borderBottom: "1px solid var(--rpg-border)",
          background: "rgba(200, 169, 110, 0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="rpg-font text-[11px] uppercase tracking-widest"
            style={{ color: "var(--rpg-gold)" }}
          >
            {meeting.meetingType}
          </span>
          <span
            className="rpg-mono text-[9px]"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            {meeting.id.slice(0, 8)}
          </span>
          <span
            className="rpg-mono text-[9px] uppercase"
            style={{
              padding: "1px 5px",
              background: "rgba(161, 188, 152, 0.1)",
              border: "1px solid rgba(161, 188, 152, 0.2)",
              color: "var(--rpg-sage)",
            }}
          >
            {meeting.status.replace("_", " ")}
          </span>
        </div>
        <button
          onClick={() => setContextExpanded((v) => !v)}
          className="rpg-mono text-[9px] cursor-pointer transition-colors"
          style={{ color: "var(--rpg-text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--rpg-gold)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--rpg-text-muted)")}
        >
          {contextExpanded ? "▾ HIDE" : "▸ CONTEXT"}
        </button>
      </div>

      {/* Expandable meeting context */}
      {contextExpanded && (
        <div
          style={{
            padding: "8px 10px",
            borderBottom: "1px solid var(--rpg-border)",
            background: "rgba(14, 18, 14, 0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {meeting.participants.length > 0 && (
            <div>
              <span
                className="rpg-mono text-[9px] uppercase tracking-widest block mb-1"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                Participants
              </span>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {meeting.participants.map((p: string) => (
                  <span
                    key={p}
                    className="rpg-mono text-[9px] uppercase"
                    style={{
                      padding: "1px 6px",
                      background: "rgba(129, 178, 154, 0.1)",
                      border: "1px solid rgba(129, 178, 154, 0.2)",
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
            <div>
              <span
                className="rpg-mono text-[9px] uppercase tracking-widest block mb-1"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                Agenda
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {meeting.agenda.map((item: string, i: number) => (
                  <div
                    key={i}
                    className="rpg-mono text-[10px]"
                    style={{
                      color: "var(--rpg-text-dim)",
                      paddingLeft: 8,
                      borderLeft: "2px solid var(--rpg-border)",
                    }}
                  >
                    {i + 1}. {item}
                  </div>
                ))}
              </div>
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
                  border: "1px solid rgba(200, 169, 110, 0.1)",
                }}
              >
                {meeting.summary.slice(0, 300)}
                {meeting.summary.length > 300 ? "…" : ""}
              </p>
            </div>
          )}

          <button
            onClick={() => onViewCouncil(meeting.id)}
            className="rpg-mono text-[9px] px-2 py-1 cursor-pointer self-start transition-all"
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
            VIEW IN COUNCIL
          </button>
        </div>
      )}

      {/* Task list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "6px 6px" }}>
        {tasks.map((task) => (
          <ProposalTaskCard
            key={task.id}
            task={task}
            selected={selected.has(task.id)}
            onToggle={() => onToggleTask(task.id)}
            disabled={processing}
          />
        ))}
      </div>

      {/* Inline error */}
      {error && (
        <div
          className="rpg-mono text-[10px] px-3 py-1.5"
          style={{
            color: "var(--rpg-danger)",
            background: "rgba(196, 92, 74, 0.08)",
            borderTop: "1px solid rgba(196, 92, 74, 0.2)",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Action bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          borderTop: "1px solid var(--rpg-border)",
          background: "rgba(14, 18, 14, 0.3)",
        }}
      >
        <span
          className="rpg-mono text-[9px] flex-1"
          style={{ color: "var(--rpg-text-muted)" }}
        >
          {selectedCount}/{allTaskIds.length} selected
        </span>
        <ApproveButton
          label={anySelected && !allSelected ? "APPROVE SELECTED" : "APPROVE ALL"}
          disabled={processing}
          onClick={() =>
            anySelected && !allSelected
              ? onApproveSelected(meeting.id, allTaskIds)
              : onApproveAll(meeting.id, allTaskIds)
          }
        />
        <RejectButton
          label="REJECT ALL"
          disabled={processing}
          onClick={() => onRejectAll(meeting.id, allTaskIds)}
        />
      </div>
    </div>
  );
}

function ApproveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rpg-mono text-[9px] px-2.5 py-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: "rgba(106, 153, 78, 0.18)",
        border: "1px solid rgba(106, 153, 78, 0.4)",
        color: "#6a994e",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(106, 153, 78, 0.32)";
          e.currentTarget.style.borderColor = "#6a994e";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(106, 153, 78, 0.18)";
        e.currentTarget.style.borderColor = "rgba(106, 153, 78, 0.4)";
      }}
    >
      {label}
    </button>
  );
}

function RejectButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rpg-mono text-[9px] px-2.5 py-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: "rgba(196, 92, 74, 0.12)",
        border: "1px solid rgba(196, 92, 74, 0.3)",
        color: "#c45c4a",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = "rgba(196, 92, 74, 0.25)";
          e.currentTarget.style.borderColor = "#c45c4a";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(196, 92, 74, 0.12)";
        e.currentTarget.style.borderColor = "rgba(196, 92, 74, 0.3)";
      }}
    >
      {label}
    </button>
  );
}
