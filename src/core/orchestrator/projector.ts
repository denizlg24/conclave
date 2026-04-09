import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationTask,
  OrchestrationMeeting,
} from "@/shared/types/orchestration";
import type { TaskId, MeetingId } from "@/shared/types/base-schemas";

function updateTask(
  tasks: ReadonlyArray<OrchestrationTask>,
  taskId: TaskId,
  patch: Partial<Omit<OrchestrationTask, "id">>,
): OrchestrationTask[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, ...patch } : task,
  );
}

function updateMeeting(
  meetings: ReadonlyArray<OrchestrationMeeting>,
  meetingId: MeetingId,
  patch: Partial<Omit<OrchestrationMeeting, "id">>,
): OrchestrationMeeting[] {
  return meetings.map((meeting) =>
    meeting.id === meetingId ? { ...meeting, ...patch } : meeting,
  );
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    tasks: [],
    meetings: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): OrchestrationReadModel {
  const base: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "task.created": {
      const { payload } = event;
      const existing = base.tasks.find((t) => t.id === payload.taskId);
      if (existing) return base;

      let status: OrchestrationTask["status"];
      if (payload.initialStatus === "proposed") {
        status = "proposed";
      } else {
        const hasPendingDeps = payload.deps.length > 0 &&
          payload.deps.some((depId) => {
            const dep = base.tasks.find((t) => t.id === depId);
            return !dep || dep.status !== "done";
          });
        status = hasPendingDeps ? "blocked" : "pending";
      }

      const newTask: OrchestrationTask = {
        id: payload.taskId,
        taskType: payload.taskType,
        title: payload.title,
        description: payload.description,
        owner: null,
        ownerRole: null,
        status,
        deps: [...payload.deps],
        input: payload.input,
        output: null,
        createdAt: payload.createdAt,
        updatedAt: payload.createdAt,
      };
      return { ...base, tasks: [...base.tasks, newTask] };
    }

    case "task.assigned": {
      const { payload } = event;
      return {
        ...base,
        tasks: updateTask(base.tasks, payload.taskId, {
          owner: payload.agentId,
          ownerRole: payload.agentRole,
          status: "assigned",
          updatedAt: payload.assignedAt,
        }),
      };
    }

    case "task.status-updated": {
      const { payload } = event;
      const task = base.tasks.find((candidate) => candidate.id === payload.taskId);
      const nextStatus =
        payload.status === "pending" &&
        task?.deps.some((depId) => {
          const dep = base.tasks.find((candidate) => candidate.id === depId);
          return !dep || dep.status !== "done";
        })
          ? "blocked"
          : payload.status;

      let tasks = updateTask(base.tasks, payload.taskId, {
        status: nextStatus,
        updatedAt: payload.updatedAt,
        ...(payload.output !== undefined ? { output: payload.output } : {}),
      });

      // When a task completes, unblock dependents whose deps are all done
      if (payload.status === "done") {
        tasks = tasks.map((task) => {
          if (task.status !== "blocked") return task;
          if (!task.deps.includes(payload.taskId)) return task;

          const allDepsDone = task.deps.every((depId) => {
            const dep = tasks.find((t) => t.id === depId);
            return dep && dep.status === "done";
          });

          if (allDepsDone) {
            return { ...task, status: "pending" as const, updatedAt: payload.updatedAt };
          }
          return task;
        });
      }

      return { ...base, tasks };
    }

    case "task.dependency-added": {
      const { payload } = event;
      const task = base.tasks.find((t) => t.id === payload.taskId);
      if (!task) return base;

      const newDeps = task.deps.includes(payload.dependsOn)
        ? task.deps
        : [...task.deps, payload.dependsOn];

      // If the new dependency isn't done, block the task
      const dep = base.tasks.find((t) => t.id === payload.dependsOn);
      const shouldBlock =
        task.status === "pending" && dep && dep.status !== "done";

      return {
        ...base,
        tasks: updateTask(base.tasks, payload.taskId, {
          deps: newDeps,
          ...(shouldBlock ? { status: "blocked" as const } : {}),
          updatedAt: payload.addedAt,
        }),
      };
    }

    case "task.dependency-removed": {
      const { payload } = event;
      const task = base.tasks.find((t) => t.id === payload.taskId);
      if (!task) return base;

      const newDeps = task.deps.filter((d) => d !== payload.dependsOn);

      // If task was blocked and all remaining deps are done, unblock
      let newStatus = task.status;
      if (task.status === "blocked") {
        const allDone = newDeps.every((depId) => {
          const dep = base.tasks.find((t) => t.id === depId);
          return dep && dep.status === "done";
        });
        if (allDone) newStatus = "pending";
      }

      return {
        ...base,
        tasks: updateTask(base.tasks, payload.taskId, {
          deps: newDeps,
          status: newStatus,
          updatedAt: payload.removedAt,
        }),
      };
    }

    case "meeting.scheduled": {
      const { payload } = event;
      const existing = base.meetings.find((m) => m.id === payload.meetingId);
      if (existing) return base;

      const newMeeting: OrchestrationMeeting = {
        id: payload.meetingId,
        meetingType: payload.meetingType,
        agenda: [...payload.agenda],
        participants: [...payload.participants],
        status: "scheduled",
        contributions: [],
        summary: null,
        proposedTaskIds: [],
        approvedTaskIds: [],
        rejectedTaskIds: [],
        cancelReason: null,
        createdAt: payload.scheduledAt,
        updatedAt: payload.scheduledAt,
      };
      return { ...base, meetings: [...base.meetings, newMeeting] };
    }

    case "meeting.tasks-approved": {
      const { payload } = event;
      return {
        ...base,
        meetings: updateMeeting(base.meetings, payload.meetingId, {
          approvedTaskIds: [...payload.approvedTaskIds],
          rejectedTaskIds: [...payload.rejectedTaskIds],
          updatedAt: payload.approvedAt,
        }),
      };
    }

    case "meeting.started": {
      const { payload } = event;
      return {
        ...base,
        meetings: updateMeeting(base.meetings, payload.meetingId, {
          status: "in_progress",
          updatedAt: payload.startedAt,
        }),
      };
    }

    case "meeting.contribution-added": {
      const { payload } = event;
      const meeting = base.meetings.find((m) => m.id === payload.meetingId);
      if (!meeting) return base;

      return {
        ...base,
        meetings: updateMeeting(base.meetings, payload.meetingId, {
          contributions: [
            ...meeting.contributions,
            {
              agentRole: payload.agentRole,
              agendaItemIndex: payload.agendaItemIndex,
              content: payload.content,
              references: [...payload.references],
            },
          ],
          updatedAt: payload.addedAt,
        }),
      };
    }

    case "meeting.completed": {
      const { payload } = event;
      return {
        ...base,
        meetings: updateMeeting(base.meetings, payload.meetingId, {
          status: "completed",
          summary: payload.summary,
          proposedTaskIds: [...payload.proposedTaskIds],
          updatedAt: payload.completedAt,
        }),
      };
    }

    case "meeting.cancelled": {
      const { payload } = event;
      return {
        ...base,
        meetings: updateMeeting(base.meetings, payload.meetingId, {
          status: "cancelled",
          cancelReason: payload.reason,
          updatedAt: payload.cancelledAt,
        }),
      };
    }

    case "meeting.task-proposed": {
      // Individual proposal events are the immutable audit record.
      // The meeting read-model does not need to be updated here — task creation
      // and approval tracking flow through meeting.completed and meeting.tasks-approved.
      // Downstream consumers (MeetingTaskProposalStore) subscribe to this event directly.
      return base;
    }

    default: {
      event satisfies never;
      return base;
    }
  }
}

export function projectEvents(
  model: OrchestrationReadModel,
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationReadModel {
  return events.reduce(projectEvent, model);
}
