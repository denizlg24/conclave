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

      // Pre-generate all TaskIds so index-based dep references can be resolved
      const proposedTaskIds = payload.proposedTasks.map(
        () => crypto.randomUUID() as TaskId,
      );

      for (let i = 0; i < payload.proposedTasks.length; i++) {
        const proposed = payload.proposedTasks[i]!;
        const taskId = proposedTaskIds[i]!;

        // proposedTasks.deps uses zero-based index references into proposedTasks;
        // map each to the pre-generated TaskId at that index.
        const resolvedDeps = proposed.deps.map((dep) => {
          const idx = parseInt(dep, 10);
          if (!isNaN(idx) && idx >= 0 && idx < proposedTaskIds.length) {
            return proposedTaskIds[idx]!;
          }
          return dep as TaskId;
        });

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
