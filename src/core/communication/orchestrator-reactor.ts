import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent, TaskType, AgentRole } from "@/shared/types/orchestration";
import type { AgentRuntimeEvent } from "@/shared/types/agent-runtime";
import type { BusEvent } from "@/shared/types/bus-event";
import type { CommandId, TaskId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { AgentServiceShape } from "../agents/service";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";
import type { MeetingTaskProposalStoreShape } from "../memory/meeting-task-proposal-store";
import { materializeProposalTasksForMeeting } from "./proposal-task-materializer";

const REACTOR_NAME = "orchestrator-reactor";

const TASK_ROLE_MAP: Record<TaskType, AgentRole> = {
  planning: "pm",
  decomposition: "pm",
  implementation: "developer",
  review: "reviewer",
  testing: "tester",
};

function isOrchestrationEvent(event: BusEvent): event is OrchestrationEvent {
  return event.type.startsWith("task.") || event.type.startsWith("meeting.");
}

function isAgentBecameAvailable(
  event: BusEvent,
): event is AgentRuntimeEvent & { type: "agent.became-available" } {
  return event.type === "agent.became-available";
}

export function createOrchestratorReactor(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
  readonly agentService: AgentServiceShape;
  readonly workingDirectory: string;
  readonly proposalStore: MeetingTaskProposalStoreShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore, agentService, workingDirectory, proposalStore } = deps;

  const tryAutoAssign = (taskId: TaskId, taskType: TaskType) =>
    Effect.gen(function* () {
      const role = TASK_ROLE_MAP[taskType];
      const agent = yield* agentService.findOrSpawnAgent(role, workingDirectory);
      if (!agent) {
        console.log(
          `[${REACTOR_NAME}] No available agent for role '${role}' (task '${taskId}') — will retry when an agent frees up`,
        );
        return;
      }

      yield* engine.dispatch({
        type: "task.assign",
        schemaVersion: 1 as const,
        commandId: crypto.randomUUID() as CommandId,
        taskId,
        agentId: agent.agentId,
        agentRole: role,
        createdAt: new Date().toISOString(),
      });
    });

  const handleEvent = (event: OrchestrationEvent) =>
    Effect.gen(function* () {
      const acquired = yield* receiptStore.tryAcquire(
        event.eventId,
        REACTOR_NAME,
      );
      if (!acquired) return;

      switch (event.type) {
        case "task.created": {
          if (event.payload.initialStatus === "proposed") return;
          const readModel = yield* engine.getReadModel();
          const task = readModel.tasks.find(
            (t) => t.id === event.payload.taskId,
          );
          if (!task || task.status !== "pending") return;
          yield* tryAutoAssign(task.id, task.taskType);
          break;
        }

        case "task.status-updated": {
          if (event.payload.status === "done" || event.payload.status === "failed") {
            const readModel = yield* engine.getReadModel();

            // Retry tasks whose deps just got unblocked
            const unblockedPending = readModel.tasks.filter(
              (t) =>
                t.status === "pending" &&
                t.owner === null &&
                t.deps.includes(event.payload.taskId),
            );
            for (const task of unblockedPending) {
              yield* tryAutoAssign(task.id, task.taskType);
            }

          }

          if (event.payload.status === "pending") {
            const readModel = yield* engine.getReadModel();
            const task = readModel.tasks.find(
              (t) => t.id === event.payload.taskId,
            );
            if (task && task.status === "pending" && task.owner === null) {
              yield* tryAutoAssign(task.id, task.taskType);
            }
          }
          break;
        }

        case "meeting.task-proposed": {
          // Ingest the proposal into the store so it appears in getPendingApproval().
          // Idempotent — upsert by proposalId, so replaying the same event is a no-op.
          yield* proposalStore.ingest(event.payload);
          break;
        }

        case "meeting.completed": {
          // All meeting.task-proposed events for this meeting have been ingested
          // by the handlers above (they are emitted before meeting.completed in
          // the same dispatch batch and delivered in order). Materialize a DAG
          // task in "proposed" status for each proposal exactly once.
          const proposals = yield* proposalStore.getByMeeting(event.payload.meetingId);
          yield* materializeProposalTasksForMeeting({
            engine,
            meetingId: event.payload.meetingId,
            proposals,
            occurredAt: event.occurredAt,
            logPrefix: `[${REACTOR_NAME}]`,
          });
          break;
        }

        default:
          break;
      }
    });

  const handleAgentBecameAvailable = (
    _event: AgentRuntimeEvent & { type: "agent.became-available" },
  ) =>
    Effect.gen(function* () {
      const readModel = yield* engine.getReadModel();

      // An agent just freed up — retry any unassigned pending tasks
      // that previously couldn't be assigned due to capacity
      const unassignedPending = readModel.tasks.filter(
        (t) =>
          t.status === "pending" &&
          t.owner === null &&
          !t.deps.some((depId) => {
            const dep = readModel.tasks.find((d) => d.id === depId);
            return dep && dep.status !== "done";
          }),
      );
      for (const task of unassignedPending) {
        yield* tryAutoAssign(task.id, task.taskType);
      }
    });

  return Effect.gen(function* () {
    yield* bus.subscribeFiltered(isAgentBecameAvailable).pipe(
      Stream.runForEach((event) =>
        handleAgentBecameAvailable(event).pipe(
          Effect.catch((error: unknown) =>
            Effect.logWarning(
              `[${REACTOR_NAME}] Failed to handle agent.became-available: ${String(error)}`,
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    );

    return yield* bus
      .subscribeFiltered(isOrchestrationEvent)
      .pipe(
        Stream.runForEach((event) =>
          handleEvent(event).pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning(
                `[${REACTOR_NAME}] Failed to handle ${event.type}: ${String(error)}`,
              ),
            ),
          ),
        ),
        Effect.forkScoped,
      );
  });
}
