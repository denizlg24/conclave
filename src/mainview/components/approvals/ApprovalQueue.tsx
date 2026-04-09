import { useState, useRef, useEffect } from "react";
import { useConclave } from "../../hooks/use-conclave";
import { MeetingProposalGroup } from "./MeetingProposalGroup";
import { UngroupedProposals } from "./UngroupedProposals";
import type { SerializedTask } from "../../../shared/rpc/rpc-schema";

const CURRENT_INPUT_SCHEMA_VERSION = 1;

interface ApprovalQueueProps {
  onViewCouncil: (meetingId: string) => void;
}

function getProposedByMeeting(task: SerializedTask): string | undefined {
  if (task.input === null || typeof task.input !== "object") return undefined;
  const obj = task.input as Record<string, unknown>;
  return typeof obj.proposedByMeeting === "string" ? obj.proposedByMeeting : undefined;
}

function hasUnknownSchemaVersion(task: SerializedTask): boolean {
  if (task.input === null || typeof task.input !== "object") return false;
  const sv = (task.input as Record<string, unknown>).schemaVersion;
  return sv !== undefined && sv !== CURRENT_INPUT_SCHEMA_VERSION;
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 5_000) return "just now";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1_000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

export function ApprovalQueue({ onViewCouncil }: ApprovalQueueProps) {
  const { readModel, approveProposedTasks, updateTaskStatus } = useConclave();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [groupErrors, setGroupErrors] = useState<Record<string, string>>({});
  const [ungroupedError, setUngroupedError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const prevUpdatedAt = useRef<string | null>(null);

  useEffect(() => {
    if (readModel && readModel.updatedAt !== prevUpdatedAt.current) {
      prevUpdatedAt.current = readModel.updatedAt;
      setLastUpdated(new Date());
    }
  }, [readModel?.updatedAt]);

  if (!readModel) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
        }}
      >
        <span className="rpg-mono text-[10px]" style={{ color: "var(--rpg-text-muted)" }}>
          Loading…
        </span>
      </div>
    );
  }

  const proposedTasks = readModel.tasks.filter((t) => t.status === "proposed");

  if (proposedTasks.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
        }}
      >
        <span className="rpg-mono text-[10px]" style={{ color: "var(--rpg-text-muted)" }}>
          No decrees pending
        </span>
      </div>
    );
  }

  // Group proposed tasks by meeting.
  // Primary: task.input.proposedByMeeting
  // Fallback: meeting.proposedTaskIds
  const assignedTaskIds = new Set<string>();
  const groups = readModel.meetings
    .map((meeting) => {
      const meetingTasks = proposedTasks.filter((t) => {
        if (meeting.proposedTaskIds.includes(t.id)) return true;
        return getProposedByMeeting(t) === meeting.id;
      });
      for (const t of meetingTasks) assignedTaskIds.add(t.id);
      return { meetingId: meeting.id, meeting, tasks: meetingTasks };
    })
    .filter((g) => g.tasks.length > 0);

  const ungrouped = proposedTasks.filter((t) => !assignedTaskIds.has(t.id));

  const toggleTask = (taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const clearSelection = (taskIds: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of taskIds) next.delete(id);
      return next;
    });
  };

  const clearGroupError = (meetingId: string) =>
    setGroupErrors((prev) => ({ ...prev, [meetingId]: "" }));

  const handleApproveSelected = async (meetingId: string, allTaskIds: string[]) => {
    const approvedTaskIds = allTaskIds.filter((id) => selected.has(id));
    const rejectedTaskIds = allTaskIds.filter((id) => !selected.has(id));
    setProcessing(true);
    clearGroupError(meetingId);
    try {
      await approveProposedTasks({ meetingId, approvedTaskIds, rejectedTaskIds });
      clearSelection(allTaskIds);
    } catch (err) {
      setGroupErrors((prev) => ({
        ...prev,
        [meetingId]: err instanceof Error ? err.message : "Approval failed",
      }));
    } finally {
      setProcessing(false);
    }
  };

  const handleApproveAll = async (meetingId: string, taskIds: string[]) => {
    setProcessing(true);
    clearGroupError(meetingId);
    try {
      await approveProposedTasks({ meetingId, approvedTaskIds: taskIds, rejectedTaskIds: [] });
      clearSelection(taskIds);
    } catch (err) {
      setGroupErrors((prev) => ({
        ...prev,
        [meetingId]: err instanceof Error ? err.message : "Approval failed",
      }));
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAll = async (meetingId: string, taskIds: string[]) => {
    setProcessing(true);
    clearGroupError(meetingId);
    try {
      await approveProposedTasks({ meetingId, approvedTaskIds: [], rejectedTaskIds: taskIds });
      clearSelection(taskIds);
    } catch (err) {
      setGroupErrors((prev) => ({
        ...prev,
        [meetingId]: err instanceof Error ? err.message : "Rejection failed",
      }));
    } finally {
      setProcessing(false);
    }
  };

  const handleUngroupedApproveSelected = async (taskIds: string[]) => {
    setProcessing(true);
    setUngroupedError(null);
    try {
      for (const taskId of taskIds) {
        await updateTaskStatus({ taskId, status: "pending", reason: "Manually approved" });
      }
      clearSelection(taskIds);
    } catch (err) {
      setUngroupedError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleUngroupedRejectAll = async (taskIds: string[]) => {
    setProcessing(true);
    setUngroupedError(null);
    try {
      for (const taskId of taskIds) {
        await updateTaskStatus({ taskId, status: "rejected", reason: "Manually rejected" });
      }
      clearSelection(taskIds);
    } catch (err) {
      setUngroupedError(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setProcessing(false);
    }
  };

  const unknownSchemaCount = proposedTasks.filter(hasUnknownSchemaVersion).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Status bar — shows decree count, schema warnings, last-updated timestamp, processing state */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 10px",
          borderBottom: "1px solid var(--rpg-border)",
          background: "rgba(14, 18, 14, 0.4)",
          flexShrink: 0,
        }}
      >
        <span className="rpg-mono text-[9px] flex-1" style={{ color: "var(--rpg-text-muted)" }}>
          {proposedTasks.length} decree{proposedTasks.length !== 1 ? "s" : ""} awaiting
        </span>

        {unknownSchemaCount > 0 && (
          <span
            className="rpg-mono text-[9px]"
            style={{ color: "var(--rpg-danger)" }}
            title="Some tasks carry an unrecognised input schema version and are shown with degraded detail"
          >
            ⚠ {unknownSchemaCount} unknown schema
          </span>
        )}

        {lastUpdated && (
          <span className="rpg-mono text-[9px]" style={{ color: "var(--rpg-text-muted)" }}>
            updated {formatRelativeTime(lastUpdated)}
          </span>
        )}

        {processing && (
          <span className="rpg-mono text-[9px]" style={{ color: "var(--rpg-gold)" }}>
            working…
          </span>
        )}
      </div>

      {/* Scrollable group list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 6,
        }}
      >
        {groups.map(({ meetingId, meeting, tasks: meetingTasks }) => (
          <MeetingProposalGroup
            key={meetingId}
            meeting={meeting}
            tasks={meetingTasks}
            selected={selected}
            onToggleTask={toggleTask}
            onApproveSelected={handleApproveSelected}
            onApproveAll={handleApproveAll}
            onRejectAll={handleRejectAll}
            onViewCouncil={onViewCouncil}
            processing={processing}
            error={groupErrors[meetingId] ?? null}
          />
        ))}

        {ungrouped.length > 0 && (
          <UngroupedProposals
            tasks={ungrouped}
            selected={selected}
            onToggleTask={toggleTask}
            onApproveSelected={handleUngroupedApproveSelected}
            onRejectAll={handleUngroupedRejectAll}
            processing={processing}
            error={ungroupedError}
          />
        )}
      </div>
    </div>
  );
}
