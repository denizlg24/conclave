import { useState } from "react";
import { useConclave } from "../hooks/use-conclave";

export function ApprovalQueue() {
  const { readModel, approveProposedTasks } = useConclave();
  const [processing, setProcessing] = useState(false);

  const tasks = readModel?.tasks ?? [];
  const proposedTasks = tasks.filter((t) => t.status === "proposed");
  const meetings = readModel?.meetings ?? [];

  // Group proposed tasks by meeting
  const byMeeting = new Map<string, typeof proposedTasks>();
  for (const task of proposedTasks) {
    const meetingId =
      (task.input as Record<string, unknown> | null)?.proposedByMeeting as
        | string
        | undefined;
    if (meetingId) {
      const existing = byMeeting.get(meetingId) ?? [];
      existing.push(task);
      byMeeting.set(meetingId, existing);
    }
  }

  // Also show ungrouped proposed tasks
  const ungrouped = proposedTasks.filter((t) => {
    const meetingId =
      (t.input as Record<string, unknown> | null)?.proposedByMeeting;
    return !meetingId;
  });

  if (proposedTasks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-600 text-sm">No tasks awaiting approval</p>
      </div>
    );
  }

  const handleBulkApprove = async (meetingId: string, taskIds: string[]) => {
    setProcessing(true);
    try {
      await approveProposedTasks({
        meetingId,
        approvedTaskIds: taskIds,
        rejectedTaskIds: [],
      });
    } catch (err) {
      console.error("Approval failed:", err);
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkReject = async (meetingId: string, taskIds: string[]) => {
    setProcessing(true);
    try {
      await approveProposedTasks({
        meetingId,
        approvedTaskIds: [],
        rejectedTaskIds: taskIds,
      });
    } catch (err) {
      console.error("Rejection failed:", err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto space-y-4 p-3">
      {[...byMeeting.entries()].map(([meetingId, meetingTasks]) => {
        const meeting = meetings.find((m) => m.id === meetingId);
        return (
          <div
            key={meetingId}
            className="border border-violet-500/30 bg-violet-500/5 rounded-lg p-3 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-violet-300">
                Meeting: {meeting?.meetingType ?? "unknown"}{" "}
                <span className="text-gray-600 font-mono">
                  {meetingId.slice(0, 8)}
                </span>
              </h4>
              <div className="flex gap-2">
                <button
                  disabled={processing}
                  onClick={() =>
                    handleBulkApprove(
                      meetingId,
                      meetingTasks.map((t) => t.id),
                    )
                  }
                  className="px-3 py-1 text-xs bg-green-600/80 hover:bg-green-600 text-white rounded disabled:opacity-50"
                >
                  Approve All
                </button>
                <button
                  disabled={processing}
                  onClick={() =>
                    handleBulkReject(
                      meetingId,
                      meetingTasks.map((t) => t.id),
                    )
                  }
                  className="px-3 py-1 text-xs bg-red-600/80 hover:bg-red-600 text-white rounded disabled:opacity-50"
                >
                  Reject All
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {meetingTasks.map((task) => (
                <div
                  key={task.id}
                  className="bg-gray-800/40 border border-gray-700/30 rounded p-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-gray-700/50 px-1.5 py-0.5 rounded text-gray-400 uppercase">
                      {task.taskType}
                    </span>
                    <span className="text-sm text-gray-200">{task.title}</span>
                  </div>
                  {task.description && (
                    <p className="text-xs text-gray-500 mt-1">
                      {task.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {ungrouped.length > 0 && (
        <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3 space-y-2">
          <h4 className="text-sm font-medium text-yellow-300">
            Proposed Tasks (no meeting)
          </h4>
          {ungrouped.map((task) => (
            <div
              key={task.id}
              className="bg-gray-800/40 border border-gray-700/30 rounded p-2 text-sm text-gray-300"
            >
              {task.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
