import type { SerializedTask } from "../../../shared/rpc/rpc-schema";

const CURRENT_SCHEMA_VERSION = 1;

type ParsedInput =
  | {
      ok: true;
      schemaVersion: 1;
      proposedByMeeting?: string;
      proposalId?: string;
      originatingAgentRole?: string;
    }
  | { ok: false; schemaVersion?: number };

function parseTaskInput(raw: unknown): ParsedInput {
  if (raw === null || typeof raw !== "object") return { ok: false };
  const obj = raw as Record<string, unknown>;
  const sv = obj.schemaVersion;
  if (sv !== undefined && sv !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, schemaVersion: typeof sv === "number" ? sv : undefined };
  }
  return {
    ok: true,
    schemaVersion: 1,
    proposedByMeeting:
      typeof obj.proposedByMeeting === "string" ? obj.proposedByMeeting : undefined,
    proposalId: typeof obj.proposalId === "string" ? obj.proposalId : undefined,
    originatingAgentRole:
      typeof obj.originatingAgentRole === "string" ? obj.originatingAgentRole : undefined,
  };
}

interface ProposalTaskCardProps {
  task: SerializedTask;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}

export function ProposalTaskCard({ task, selected, onToggle, disabled }: ProposalTaskCardProps) {
  const parsed = parseTaskInput(task.input);

  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 10px",
        background: selected ? "rgba(129, 178, 154, 0.08)" : "rgba(26, 33, 25, 0.5)",
        border: `1px solid ${selected ? "rgba(129, 178, 154, 0.3)" : "var(--rpg-border)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s, border-color 0.12s",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        disabled={disabled}
        style={{ marginTop: 2, accentColor: "var(--rpg-sage)", flexShrink: 0 }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            className="rpg-mono text-[9px] uppercase"
            style={{
              padding: "1px 5px",
              background: "rgba(212, 163, 115, 0.12)",
              border: "1px solid rgba(212, 163, 115, 0.25)",
              color: "var(--rpg-copper)",
              flexShrink: 0,
            }}
          >
            {task.taskType}
          </span>
          {parsed.ok && parsed.originatingAgentRole && (
            <span
              className="rpg-mono text-[9px] uppercase"
              style={{ color: "var(--rpg-text-muted)", flexShrink: 0 }}
            >
              via {parsed.originatingAgentRole}
            </span>
          )}
          {!parsed.ok && parsed.schemaVersion !== undefined && (
            <span
              className="rpg-mono text-[9px] uppercase"
              style={{
                padding: "1px 5px",
                background: "rgba(196, 92, 74, 0.12)",
                border: "1px solid rgba(196, 92, 74, 0.3)",
                color: "var(--rpg-danger)",
                flexShrink: 0,
              }}
              title={`Unrecognised input schema version ${parsed.schemaVersion}. Task details may be incomplete.`}
            >
              schema v{parsed.schemaVersion}
            </span>
          )}
          <span
            className="rpg-mono text-[11px] truncate"
            style={{ color: "var(--rpg-text)" }}
          >
            {task.title}
          </span>
        </div>

        {task.description && (
          <p
            className="rpg-mono text-[10px] mt-1"
            style={{ color: "var(--rpg-text-dim)" }}
          >
            {task.description.slice(0, 180)}
            {task.description.length > 180 ? "…" : ""}
          </p>
        )}

        {task.deps.length > 0 && (
          <p
            className="rpg-mono text-[9px] mt-0.5"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            {task.deps.length} dep{task.deps.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </label>
  );
}
