import { useConclave } from "../hooks/use-conclave";

export function StatusBar() {
  const { readModel, events, connected } = useConclave();

  const tasks = readModel?.tasks ?? [];
  const tasksByStatus = {
    total: tasks.length,
    active: tasks.filter((t) =>
      ["assigned", "in_progress", "review"].includes(t.status),
    ).length,
    done: tasks.filter((t) => t.status === "done").length,
    proposed: tasks.filter((t) => t.status === "proposed").length,
  };

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-900/80 border-t border-gray-800 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span
          className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
        />
        {connected ? "Connected" : "Disconnected"}
      </span>
      <span className="border-l border-gray-800 pl-4">
        Tasks: {tasksByStatus.total}
      </span>
      {tasksByStatus.active > 0 && (
        <span className="text-cyan-500">{tasksByStatus.active} active</span>
      )}
      {tasksByStatus.done > 0 && (
        <span className="text-green-500">{tasksByStatus.done} done</span>
      )}
      {tasksByStatus.proposed > 0 && (
        <span className="text-violet-400">
          {tasksByStatus.proposed} awaiting approval
        </span>
      )}
      <span className="ml-auto text-gray-600">
        Events: {events.length} | Seq:{" "}
        {readModel?.snapshotSequence ?? 0}
      </span>
    </div>
  );
}
