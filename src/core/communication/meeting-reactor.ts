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

      for (const proposed of payload.proposedTasks) {
        yield* engine.dispatch({
          type: "task.create",
          commandId: crypto.randomUUID() as CommandId,
          taskId: crypto.randomUUID() as TaskId,
          taskType: proposed.taskType,
          title: proposed.title,
          description: proposed.description,
          deps: proposed.deps,
          input: {
            ...(typeof proposed.input === "object" && proposed.input !== null
              ? proposed.input
              : {}),
            proposedByMeeting: payload.meetingId,
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
