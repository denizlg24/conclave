import { beforeEach, describe, expect, test } from "bun:test";
import { Duration, Effect, Stream } from "effect";

import { createMeetingReactor } from "../meeting-reactor";
import { createEventBus } from "../event-bus";
import { createReceiptStore } from "../receipt-store";
import type { OrchestrationEngineShape } from "../../orchestrator/engine";
import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";
import {
  makeCommandId,
  makeEmptyReadModel,
  makeEventId,
  makeIsoDate,
  makeMeetingId,
  resetCounters,
} from "@/test-utils/factories";

type TrimStr = string & { readonly TrimmedNonEmptyString: unique symbol };
const str = (value: string): TrimStr => value as TrimStr;

function makeMeetingCompletedEvent(
  meetingId: ReturnType<typeof makeMeetingId>,
): Extract<OrchestrationEvent, { type: "meeting.completed" }> {
  const now = makeIsoDate();
  return {
    schemaVersion: 1 as const,
    sequence: 1,
    eventId: makeEventId(),
    aggregateKind: "meeting",
    aggregateId: meetingId,
    occurredAt: now,
    commandId: makeCommandId(),
    causationEventId: null,
    correlationId: makeCommandId(),
    metadata: {},
    type: "meeting.completed",
    payload: {
      meetingId,
      summary: "Planning meeting concluded.",
      proposedTaskIds: [],
      proposedTasks: [
        {
          taskType: "implementation",
          title: str("Build API"),
          description: "REST endpoints",
          deps: [],
          input: null,
        },
      ],
      completedAt: now,
    },
  };
}

function makeMockEngine(readModel: OrchestrationReadModel = makeEmptyReadModel()): {
  engine: OrchestrationEngineShape;
  dispatchedCommands: OrchestrationCommand[];
} {
  const dispatchedCommands: OrchestrationCommand[] = [];
  const engine: OrchestrationEngineShape = {
    getReadModel: () => Effect.succeed(readModel),
    dispatch: (command) => {
      dispatchedCommands.push(command);
      return Effect.succeed({ sequence: dispatchedCommands.length, events: [] });
    },
    readEvents: () => Stream.empty as never,
    replay: () => Effect.succeed(readModel),
  };
  return { engine, dispatchedCommands };
}

beforeEach(() => {
  resetCounters();
});

describe("meeting-reactor", () => {
  test("does not materialize tasks from meeting.completed", async () => {
    const meetingId = makeMeetingId("mtg-create");
    const { dispatchedCommands } = makeMockEngine();

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const bus = yield* createEventBus();
          const receiptStore = yield* createReceiptStore();
          yield* createMeetingReactor({ bus, receiptStore });
          yield* Effect.sleep(Duration.millis(20));
          yield* bus.publish(makeMeetingCompletedEvent(meetingId));
          yield* Effect.sleep(Duration.millis(80));
        }),
      ),
    );

    expect(dispatchedCommands).toHaveLength(0);
  });
});
