import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent, TaskType, AgentRole } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { CommandId, TaskId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { AgentServiceShape } from "../agents/service";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";

const REACTOR_NAME = "orchestrator-reactor";

const TASK_ROLE_MAP: Record<TaskType, AgentRole> = {
  planning: "pm",
  decomposition: "pm",
  implementation: "developer",
  review: "reviewer",
  testing: "reviewer",
};

function isOrchestrationEvent(event: BusEvent): event is OrchestrationEvent {
  return event.type.startsWith("task.") || event.type.startsWith("meeting.");
}

export function createOrchestratorReactor(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
  readonly agentService: AgentServiceShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore, agentService } = deps;

  const tryAutoAssign = (taskId: TaskId, taskType: TaskType) =>
    Effect.gen(function* () {
      const role = TASK_ROLE_MAP[taskType];
      const agents = yield* agentService.listAgents();
      const match = agents.find((a) => a.role === role);
      if (!match) {
        yield* Effect.logWarning(
          `[${REACTOR_NAME}] No agent with role '${role}' found for task '${taskId}' — skipping auto-assign`,
        );
        return;
      }

      yield* engine.dispatch({
        type: "task.assign",
        commandId: crypto.randomUUID() as CommandId,
        taskId,
        agentId: match.agentId,
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
          if (event.payload.status === "done") {
            const readModel = yield* engine.getReadModel();
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

        default:
          break;
      }
    });

  return bus
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
}
