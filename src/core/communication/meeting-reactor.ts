import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";
import type { CommandId, TaskId } from "@/shared/types/base-schemas";

import type { OrchestrationEngineShape } from "../orchestrator/engine";
import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";

const REACTOR_NAME = "meeting-reactor";

function isMeetingCompleted(
  event: BusEvent,
): event is OrchestrationEvent & { type: "meeting.completed" } {
  return event.type === "meeting.completed";
}

export function createMeetingReactor(deps: {
  readonly engine: OrchestrationEngineShape;
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { engine, bus, receiptStore } = deps;

  const handleMeetingCompleted = (
    event: OrchestrationEvent & { type: "meeting.completed" },
  ) =>
    Effect.gen(function* () {
      const acquired = yield* receiptStore.tryAcquire(
        event.eventId,
        REACTOR_NAME,
      );
      if (!acquired) return;

      const { payload } = event;

      const proposedTaskIds = payload.proposedTasks.map(
        () => crypto.randomUUID() as TaskId,
      );

      const resolvedTaskDeps = payload.proposedTasks.map((proposed, index) => {
        const resolvedDeps = proposed.deps.map((dep) => {
          if (typeof dep === "number") {
            if (dep < 0 || dep >= proposedTaskIds.length) {
              throw new Error(
                `Meeting '${payload.meetingId}' proposed task ${index + 1} references out-of-range dependency index ${dep}.`,
              );
            }
            if (dep === index) {
              throw new Error(
                `Meeting '${payload.meetingId}' proposed task ${index + 1} cannot depend on itself.`,
              );
            }
            return proposedTaskIds[dep]!;
          }
          return dep as TaskId;
        });
        return {
          proposed,
          taskId: proposedTaskIds[index]!,
          resolvedDeps,
        };
      });

      for (const { proposed, taskId, resolvedDeps } of resolvedTaskDeps) {

        yield* engine.dispatch({
          type: "task.create",
          schemaVersion: 1 as const,
          commandId: crypto.randomUUID() as CommandId,
          taskId,
          taskType: proposed.taskType,
          title: proposed.title,
          description: proposed.description,
          deps: resolvedDeps,
          input: {
            ...(typeof proposed.input === "object" &&
            proposed.input !== null &&
            !Array.isArray(proposed.input)
              ? (proposed.input as Record<string, unknown>)
              : {}),
            proposedByMeeting: payload.meetingId,
            ...(!("parentPlanningTaskId" in ((proposed.input as Record<string, unknown> | null) ?? {}))
              ? { parentPlanningTaskId: payload.meetingId }
              : {}),
          },
          initialStatus: "proposed",
          createdAt: new Date().toISOString(),
        });
      }
    });

  return bus
    .subscribeFiltered(isMeetingCompleted)
    .pipe(
      Stream.runForEach((event) =>
        handleMeetingCompleted(event).pipe(
          Effect.catch((error: unknown) =>
            Effect.logWarning(
              `[${REACTOR_NAME}] Failed to handle meeting.completed: ${String(error)}`,
            ),
          ),
        ),
      ),
      Effect.forkScoped,
    );
}
