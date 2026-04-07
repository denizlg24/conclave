import { Effect } from "effect";

import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import type { CommandId, EventId } from "@/shared/types/base-schemas";

import { CommandInvariantError } from "./errors";
import {
  requireTask,
  requireTaskAbsent,
  requireTaskStatus,
  requireMeetingAbsent,
  requireMeeting,
  requireMeetingStatus,
  requireNoCyclicDependency,
} from "./command-invariants";

type EventWithoutSequence = Omit<OrchestrationEvent, "sequence">;

function withEventBase(input: {
  readonly commandId: CommandId;
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: OrchestrationEvent["aggregateId"];
  readonly occurredAt: string;
  readonly metadata?: OrchestrationEvent["metadata"];
}): Omit<OrchestrationEvent, "sequence" | "type" | "payload"> {
  return {
    schemaVersion: 1 as const,
    eventId: crypto.randomUUID() as EventId,
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt,
    commandId: input.commandId,
    causationEventId: null,
    correlationId: input.commandId,
    metadata: input.metadata ?? {},
  };
}

// Valid status transitions enforced by the decider
const VALID_STATUS_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  pending: ["assigned", "blocked", "failed"],
  assigned: ["in_progress", "blocked", "failed"],
  in_progress: ["review", "done", "failed", "blocked", "suspended"],
  review: ["done", "failed", "in_progress"],
  blocked: ["pending", "assigned", "failed"],
  done: [],
  failed: ["pending"],
  proposed: ["pending", "blocked", "failed"],
  rejected: [],
  suspended: ["in_progress", "pending", "failed"],
};

export const decideOrchestrationCommand = Effect.fn(
  "decideOrchestrationCommand",
)(function* ({
  command,
  readModel,
}: {
  readonly command: OrchestrationCommand;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  EventWithoutSequence | ReadonlyArray<EventWithoutSequence>,
  CommandInvariantError
> {
  switch (command.type) {
    case "task.create": {
      yield* requireTaskAbsent({
        readModel,
        command,
        taskId: command.taskId,
      });

      // Verify all declared dependencies exist
      for (const depId of command.deps) {
        yield* requireTask({ readModel, command, taskId: depId });
      }

      return {
        ...withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "task.created" as const,
        payload: {
          taskId: command.taskId,
          taskType: command.taskType,
          title: command.title,
          description: command.description,
          deps: command.deps,
          input: command.input,
          ...(command.initialStatus
            ? { initialStatus: command.initialStatus }
            : {}),
          createdAt: command.createdAt,
        },
      };
    }

    case "task.assign": {
      yield* requireTaskStatus({
        readModel,
        command,
        taskId: command.taskId,
        allowed: ["pending", "assigned"],
      });

      return {
        ...withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: {
            agentId: command.agentId,
            agentRole: command.agentRole,
          },
        }),
        type: "task.assigned" as const,
        payload: {
          taskId: command.taskId,
          agentId: command.agentId,
          agentRole: command.agentRole,
          assignedAt: command.createdAt,
        },
      };
    }

    case "task.update-status": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });

      const allowed = VALID_STATUS_TRANSITIONS[task.status];
      if (!allowed || !allowed.includes(command.status)) {
        return yield* Effect.fail(
          new CommandInvariantError({
            commandType: command.type,
            detail: `Cannot transition task '${command.taskId}' from '${task.status}' to '${command.status}'.`,
          }),
        );
      }

      return {
        ...withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "task.status-updated" as const,
        payload: {
          taskId: command.taskId,
          previousStatus: task.status,
          status: command.status,
          reason: command.reason ?? null,
          output: command.output,
          updatedAt: command.createdAt,
        },
      };
    }

    case "task.add-dependency": {
      yield* requireTask({ readModel, command, taskId: command.taskId });
      yield* requireTask({ readModel, command, taskId: command.dependsOn });
      yield* requireNoCyclicDependency({
        readModel,
        command,
        taskId: command.taskId,
        dependsOn: command.dependsOn,
      });

      return {
        ...withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "task.dependency-added" as const,
        payload: {
          taskId: command.taskId,
          dependsOn: command.dependsOn,
          addedAt: command.createdAt,
        },
      };
    }

    case "task.remove-dependency": {
      const task = yield* requireTask({
        readModel,
        command,
        taskId: command.taskId,
      });

      if (!task.deps.includes(command.dependsOn)) {
        return yield* Effect.fail(
          new CommandInvariantError({
            commandType: command.type,
            detail: `Task '${command.taskId}' does not depend on '${command.dependsOn}'.`,
          }),
        );
      }

      return {
        ...withEventBase({
          aggregateKind: "task",
          aggregateId: command.taskId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "task.dependency-removed" as const,
        payload: {
          taskId: command.taskId,
          dependsOn: command.dependsOn,
          removedAt: command.createdAt,
        },
      };
    }

    case "meeting.schedule": {
      yield* requireMeetingAbsent({
        readModel,
        command,
        meetingId: command.meetingId,
      });

      return {
        ...withEventBase({
          aggregateKind: "meeting",
          aggregateId: command.meetingId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "meeting.scheduled" as const,
        payload: {
          meetingId: command.meetingId,
          meetingType: command.meetingType,
          agenda: command.agenda,
          participants: command.participants,
          scheduledAt: command.createdAt,
        },
      };
    }

    case "meeting.approve-tasks": {
      yield* requireMeeting({
        readModel,
        command,
        meetingId: command.meetingId,
      });

      // Verify all referenced tasks exist and are in "proposed" status
      for (const taskId of [
        ...command.approvedTaskIds,
        ...command.rejectedTaskIds,
      ]) {
        yield* requireTaskStatus({
          readModel,
          command,
          taskId,
          allowed: ["proposed"],
        });
      }

      const events: EventWithoutSequence[] = [];

      // Emit the meeting-level event
      events.push({
        ...withEventBase({
          aggregateKind: "meeting",
          aggregateId: command.meetingId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "meeting.tasks-approved" as const,
        payload: {
          meetingId: command.meetingId,
          approvedTaskIds: command.approvedTaskIds,
          rejectedTaskIds: command.rejectedTaskIds,
          approvedAt: command.createdAt,
        },
      });

      // Transition approved tasks: proposed → pending
      for (const taskId of command.approvedTaskIds) {
        events.push({
          ...withEventBase({
            aggregateKind: "task",
            aggregateId: taskId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "task.status-updated" as const,
          payload: {
            taskId,
            previousStatus: "proposed",
            status: "pending",
            reason: `Approved via meeting '${command.meetingId}'`,
            updatedAt: command.createdAt,
          },
        });
      }

      // Transition rejected tasks: proposed → failed
      for (const taskId of command.rejectedTaskIds) {
        events.push({
          ...withEventBase({
            aggregateKind: "task",
            aggregateId: taskId,
            occurredAt: command.createdAt,
            commandId: command.commandId,
          }),
          type: "task.status-updated" as const,
          payload: {
            taskId,
            previousStatus: "proposed",
            status: "failed",
            reason: `Rejected via meeting '${command.meetingId}'`,
            updatedAt: command.createdAt,
          },
        });
      }

      return events;
    }

    case "meeting.start": {
      yield* requireMeetingStatus({
        readModel,
        command,
        meetingId: command.meetingId,
        allowed: ["scheduled"],
      });

      return {
        ...withEventBase({
          aggregateKind: "meeting",
          aggregateId: command.meetingId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "meeting.started" as const,
        payload: {
          meetingId: command.meetingId,
          startedAt: command.createdAt,
        },
      };
    }

    case "meeting.contribute": {
      yield* requireMeetingStatus({
        readModel,
        command,
        meetingId: command.meetingId,
        allowed: ["in_progress"],
      });

      return {
        ...withEventBase({
          aggregateKind: "meeting",
          aggregateId: command.meetingId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
          metadata: { agentRole: command.agentRole },
        }),
        type: "meeting.contribution-added" as const,
        payload: {
          meetingId: command.meetingId,
          agentRole: command.agentRole,
          agendaItemIndex: command.agendaItemIndex,
          content: command.content,
          references: command.references,
          addedAt: command.createdAt,
        },
      };
    }

    case "meeting.complete": {
      yield* requireMeetingStatus({
        readModel,
        command,
        meetingId: command.meetingId,
        allowed: ["in_progress"],
      });

      return {
        ...withEventBase({
          aggregateKind: "meeting",
          aggregateId: command.meetingId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "meeting.completed" as const,
        payload: {
          meetingId: command.meetingId,
          summary: command.summary,
          proposedTaskIds: [],
          proposedTasks: command.proposedTasks,
          completedAt: command.createdAt,
        },
      };
    }

    case "meeting.cancel": {
      yield* requireMeetingStatus({
        readModel,
        command,
        meetingId: command.meetingId,
        allowed: ["scheduled", "in_progress"],
      });

      return {
        ...withEventBase({
          aggregateKind: "meeting",
          aggregateId: command.meetingId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        }),
        type: "meeting.cancelled" as const,
        payload: {
          meetingId: command.meetingId,
          reason: command.reason,
          cancelledAt: command.createdAt,
        },
      };
    }

    default: {
      command satisfies never;
      const fallback = command as never as { type: string };
      return yield* Effect.fail(
        new CommandInvariantError({
          commandType: fallback.type,
          detail: `Unknown command type: ${fallback.type}`,
        }),
      );
    }
  }
});
