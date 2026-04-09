import { useState } from "react";
import { useConclave } from "../hooks/use-conclave";

export function ApprovalQueue() {
  const { readModel, approveProposedTasks, updateTaskStatus } = useConclave();
  const [processing, setProcessing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const tasks = readModel?.tasks ?? [];
  const meetings = readModel?.meetings ?? [];

  const proposedTasks = tasks.filter((t) => t.status === "proposed");

  // Group proposed tasks by meeting.
  // Primary: task.input.proposedByMeeting (set by meeting-reactor on every proposed task).
  // Fallback: meeting.proposedTaskIds (may be empty if tasks were created after the event).
  const assignedTaskIds = new Set<string>();
  const groups = meetings
    .map((meeting) => {
      const meetingTasks = proposedTasks.filter((t) => {
        if (meeting.proposedTaskIds.includes(t.id)) return true;
        const input = t.input as Record<string, unknown> | null;
        return input?.proposedByMeeting === meeting.id;
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

  const handleApproveSelected = async (
    meetingId: string,
    allTaskIds: string[],
  ) => {
    const approvedTaskIds = allTaskIds.filter((id) => selected.has(id));
    const rejectedTaskIds = allTaskIds.filter((id) => !selected.has(id));
    setProcessing(true);
    try {
      await approveProposedTasks({ meetingId, approvedTaskIds, rejectedTaskIds });
      clearSelection(allTaskIds);
    } catch (err) {
      console.error("Approval failed:", err);
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAll = async (meetingId: string, taskIds: string[]) => {
    setProcessing(true);
    try {
      await approveProposedTasks({
        meetingId,
        approvedTaskIds: [],
        rejectedTaskIds: taskIds,
      });
      clearSelection(taskIds);
    } catch (err) {
      console.error("Rejection failed:", err);
    } finally {
      setProcessing(false);
    }
  };

  if (proposedTasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-600 text-sm">No tasks awaiting approval</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto space-y-4 p-3">
      {groups.map(({ meetingId, meeting, tasks: meetingTasks }) => {
        const allTaskIds = meetingTasks.map((t) => t.id);
        const anySelected = allTaskIds.some((id) => selected.has(id));

        return (
          <div
            key={meetingId}
            className="border border-violet-500/30 bg-violet-500/5 rounded-lg p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-violet-300">
                Meeting: {meeting.meetingType}{" "}
                <span className="text-gray-600 font-mono">
                  {meetingId.slice(0, 8)}
                </span>
              </h4>
              <div className="flex gap-2">
                <button
                  disabled={processing || !anySelected}
                  onClick={() => handleApproveSelected(meetingId, allTaskIds)}
                  className="px-3 py-1 text-xs bg-green-600/80 hover:bg-green-600 text-white rounded disabled:opacity-50 transition-opacity"
                >
                  {processing ? "Working…" : "Approve Selected"}
                </button>
                <button
                  disabled={processing}
                  onClick={() => handleRejectAll(meetingId, allTaskIds)}
                  className="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-600 text-white rounded disabled:opacity-50 transition-opacity"
                >
                  {processing ? "Working…" : "Reject All"}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {meetingTasks.map((task) => (
                <label
                  key={task.id}
                  className="flex items-start gap-2 bg-gray-800/40 border border-gray-700/30 rounded p-2 cursor-pointer hover:bg-gray-800/60 transition-colors"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-green-500 shrink-0"
                    checked={selected.has(task.id)}
                    onChange={() => toggleTask(task.id)}
                    disabled={processing}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gray-700/50 px-1.5 py-0.5 rounded text-gray-400 uppercase shrink-0">
                        {task.taskType}
                      </span>
                      <span className="text-sm text-gray-200 truncate">
                        {task.title}
                      </span>
                    </div>
                    {task.description && (
                      <p className="text-xs text-gray-500 mt-1">
                        {task.description}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {ungrouped.length > 0 && (
        <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-yellow-300">
              Proposed Tasks (no meeting)
            </h4>
            <div className="flex gap-2">
              <button
                disabled={processing || !ungrouped.some((t) => selected.has(t.id))}
                onClick={async () => {
                  // Approve ungrouped tasks individually via status update
                  setProcessing(true);
                  try {
                    for (const task of ungrouped) {
                      if (selected.has(task.id)) {
                        await updateTaskStatus({ taskId: task.id, status: "pending", reason: "Manually approved" });
                      }
                    }
                    clearSelection(ungrouped.map((t) => t.id));
                  } catch (err) {
                    console.error("Approval failed:", err);
                  } finally {
                    setProcessing(false);
                  }
                }}
                className="px-3 py-1 text-xs bg-green-600/80 hover:bg-green-600 text-white rounded disabled:opacity-50 transition-opacity"
              >
                {processing ? "Working…" : "Approve Selected"}
              </button>
              <button
                disabled={processing}
                onClick={async () => {
                  setProcessing(true);
                  try {
                    for (const task of ungrouped) {
                      await updateTaskStatus({ taskId: task.id, status: "rejected", reason: "Manually rejected" });
                    }
                    clearSelection(ungrouped.map((t) => t.id));
                  } catch (err) {
                    console.error("Rejection failed:", err);
                  } finally {
                    setProcessing(false);
                  }
                }}
                className="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-600 text-white rounded disabled:opacity-50 transition-opacity"
              >
                {processing ? "Working…" : "Reject All"}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {ungrouped.map((task) => (
              <label
                key={task.id}
                className="flex items-start gap-2 bg-gray-800/40 border border-gray-700/30 rounded p-2 cursor-pointer hover:bg-gray-800/60 transition-colors"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 accent-green-500 shrink-0"
                  checked={selected.has(task.id)}
                  onChange={() => toggleTask(task.id)}
                  disabled={processing}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-gray-700/50 px-1.5 py-0.5 rounded text-gray-400 uppercase shrink-0">
                      {task.taskType}
                    </span>
                    <span className="text-sm text-gray-200 truncate">
                      {task.title}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-xs text-gray-500 mt-1">
                      {task.description}
                    </p>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
