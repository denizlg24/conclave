import type { SerializedTask } from "../../shared/rpc/rpc-schema";
import { useConclave } from "../hooks/use-conclave";

const STATUS_COLUMNS = [
  { key: "proposed", label: "Proposed", color: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/30" },
  { key: "pending", label: "Pending", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  { key: "assigned", label: "Assigned", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
  { key: "in_progress", label: "In Progress", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/30" },
  { key: "review", label: "Review", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { key: "done", label: "Done", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30" },
  { key: "failed", label: "Failed", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  { key: "blocked", label: "Blocked", color: "text-gray-400", bg: "bg-gray-500/10", border: "border-gray-500/30" },
  { key: "rejected", label: "Rejected", color: "text-red-300", bg: "bg-red-500/10", border: "border-red-500/30" },
] as const;

const TASK_TYPE_ICONS: Record<string, string> = {
  planning: "P",
  decomposition: "D",
  implementation: "I",
  review: "R",
  testing: "T",
};

function TaskCard({ task }: { task: SerializedTask }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-lg p-3 space-y-2 hover:border-gray-600/60 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-200 leading-tight">
          {task.title}
        </h4>
        <span className="shrink-0 w-6 h-6 rounded-md bg-gray-700/80 text-xs font-bold flex items-center justify-center text-gray-400">
          {TASK_TYPE_ICONS[task.taskType] ?? "?"}
        </span>
      </div>

      {task.description && (
        <p className="text-xs text-gray-500 line-clamp-2">{task.description}</p>
      )}

      <div className="flex items-center gap-2 text-xs text-gray-500">
        {task.owner && (
          <span className="bg-gray-700/50 px-1.5 py-0.5 rounded text-gray-400">
            {task.owner}
          </span>
        )}
        {task.deps.length > 0 && (
          <span className="text-gray-600">
            {task.deps.length} dep{task.deps.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="text-gray-600 ml-auto font-mono">
          {task.id.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}

export function TaskBoard() {
  const { readModel } = useConclave();
  const tasks = readModel?.tasks ?? [];

  const activeColumns = STATUS_COLUMNS.filter((col) =>
    tasks.some((t) => t.status === col.key),
  );

  // If no tasks, show all main columns
  const columns =
    activeColumns.length > 0
      ? activeColumns
      : STATUS_COLUMNS.filter((c) =>
          ["pending", "in_progress", "done"].includes(c.key),
        );

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 h-full">
      {columns.map((col) => {
        const colTasks = tasks.filter((t) => t.status === col.key);
        return (
          <div
            key={col.key}
            className={`shrink-0 w-64 flex flex-col rounded-xl border ${col.border} ${col.bg}`}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700/30">
              <span className={`text-sm font-semibold ${col.color}`}>
                {col.label}
              </span>
              <span className="ml-auto text-xs text-gray-500 bg-gray-800/50 px-1.5 py-0.5 rounded-full">
                {colTasks.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {colTasks.length === 0 ? (
                <p className="text-xs text-gray-600 text-center py-4">
                  No tasks
                </p>
              ) : (
                colTasks.map((task) => <TaskCard key={task.id} task={task} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
