import type { SerializedTask } from "../../../shared/rpc/rpc-schema";
import { ProposalTaskCard } from "./ProposalTaskCard";

interface UngroupedProposalsProps {
  tasks: SerializedTask[];
  selected: Set<string>;
  onToggleTask: (taskId: string) => void;
  onApproveSelected: (taskIds: string[]) => void;
  onRejectAll: (taskIds: string[]) => void;
  processing: boolean;
  error: string | null;
}

export function UngroupedProposals({
  tasks,
  selected,
  onToggleTask,
  onApproveSelected,
  onRejectAll,
  processing,
  error,
}: UngroupedProposalsProps) {
  const allTaskIds = tasks.map((t) => t.id);
  const selectedCount = allTaskIds.filter((id) => selected.has(id)).length;
  const anySelected = selectedCount > 0;

  return (
    <div
      style={{
        border: "1px solid rgba(212, 163, 115, 0.2)",
        background: "rgba(212, 163, 115, 0.02)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderBottom: "1px solid var(--rpg-border)",
          background: "rgba(212, 163, 115, 0.05)",
        }}
      >
        <span
          className="rpg-font text-[11px] uppercase tracking-widest"
          style={{ color: "var(--rpg-copper)" }}
        >
          Unattributed
        </span>
        <span
          className="rpg-mono text-[9px]"
          style={{ color: "var(--rpg-text-muted)" }}
        >
          no meeting context
        </span>
      </div>

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
        <button
          disabled={processing || !anySelected}
          onClick={() =>
            onApproveSelected(allTaskIds.filter((id) => selected.has(id)))
          }
          className="rpg-mono text-[9px] px-2.5 py-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "rgba(106, 153, 78, 0.18)",
            border: "1px solid rgba(106, 153, 78, 0.4)",
            color: "#6a994e",
          }}
          onMouseEnter={(e) => {
            if (!processing && anySelected) {
              e.currentTarget.style.background = "rgba(106, 153, 78, 0.32)";
              e.currentTarget.style.borderColor = "#6a994e";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(106, 153, 78, 0.18)";
            e.currentTarget.style.borderColor = "rgba(106, 153, 78, 0.4)";
          }}
        >
          APPROVE SELECTED
        </button>
        <button
          disabled={processing}
          onClick={() => onRejectAll(allTaskIds)}
          className="rpg-mono text-[9px] px-2.5 py-1 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "rgba(196, 92, 74, 0.12)",
            border: "1px solid rgba(196, 92, 74, 0.3)",
            color: "#c45c4a",
          }}
          onMouseEnter={(e) => {
            if (!processing) {
              e.currentTarget.style.background = "rgba(196, 92, 74, 0.25)";
              e.currentTarget.style.borderColor = "#c45c4a";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(196, 92, 74, 0.12)";
            e.currentTarget.style.borderColor = "rgba(196, 92, 74, 0.3)";
          }}
        >
          REJECT ALL
        </button>
      </div>
    </div>
  );
}
