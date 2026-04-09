import { Effect, Fiber, Stream, type Scope } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { BusEvent } from "@/shared/types/bus-event";

import type { EventBusShape } from "./event-bus";
import type { ReceiptStoreShape } from "./receipt-store";

const REACTOR_NAME = "meeting-reactor";

function isMeetingCompleted(
  event: BusEvent,
): event is OrchestrationEvent & { type: "meeting.completed" } {
  return event.type === "meeting.completed";
}

export function createMeetingReactor(deps: {
  readonly bus: EventBusShape;
  readonly receiptStore: ReceiptStoreShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { bus, receiptStore } = deps;

  return bus
    .subscribeFiltered(isMeetingCompleted)
    .pipe(
      Stream.runForEach((event) =>
        receiptStore.tryAcquire(event.eventId, REACTOR_NAME).pipe(
          Effect.catch((error: unknown) =>
            Effect.logWarning(
              `[${REACTOR_NAME}] Failed to mark meeting.completed receipt: ${String(error)}`,
            ),
          ),
          Effect.asVoid,
        ),
      ),
      Effect.forkScoped,
    );
}
