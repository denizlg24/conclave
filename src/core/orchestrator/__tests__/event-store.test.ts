import { describe, test, expect, beforeEach } from "bun:test";
import { Effect, Stream } from "effect";

import { createInMemoryEventStore } from "../event-store";
import {
  resetCounters,
  makeTaskCreatedEvent,
  makeTaskAssignedEvent,
  makeTaskStatusUpdatedEvent,
  makeMeetingScheduledEvent,
  makeTaskId,
  makeMeetingId,
  makeAgentId,
} from "@/test-utils/factories";
import type { OrchestrationEvent } from "@/shared/types/orchestration";

beforeEach(() => {
  resetCounters();
});

describe("createInMemoryEventStore", () => {
  test("creates store with initial sequence 0", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const sequence = await Effect.runPromise(store.latestSequence());

    expect(sequence).toBe(0);
  });

  test("creates store with empty events", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const events = await Effect.runPromise(store.readAll());

    expect(events).toEqual([]);
  });
});

describe("EventStore.append", () => {
  test("assigns sequential sequence numbers starting from 1", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    const eventWithoutSeq = makeTaskCreatedEvent(makeTaskId("t1"), 0);

    const event1 = await Effect.runPromise(store.append(eventWithoutSeq));

    expect(event1.sequence).toBe(1);
  });

  test("increments sequence for each append", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const event1 = await Effect.runPromise(
      store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)),
    );
    const event2 = await Effect.runPromise(
      store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)),
    );
    const event3 = await Effect.runPromise(
      store.append(makeTaskCreatedEvent(makeTaskId("t3"), 0)),
    );

    expect(event1.sequence).toBe(1);
    expect(event2.sequence).toBe(2);
    expect(event3.sequence).toBe(3);
  });

  test("returns complete event with assigned sequence", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    const taskId = makeTaskId("task-1");
    const eventWithoutSeq = makeTaskCreatedEvent(taskId, 0);

    const event = await Effect.runPromise(store.append(eventWithoutSeq));

    expect(event.type).toBe("task.created");
    expect(event.aggregateId).toBe(taskId);
    expect(event.sequence).toBe(1);
  });

  test("persists event for later retrieval", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    const taskId = makeTaskId("task-1");

    await Effect.runPromise(store.append(makeTaskCreatedEvent(taskId, 0)));

    const events = await Effect.runPromise(store.readAll());
    expect(events).toHaveLength(1);
    expect(events[0].aggregateId).toBe(taskId);
  });

  test("updates latestSequence after append", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    expect(await Effect.runPromise(store.latestSequence())).toBe(1);

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));
    expect(await Effect.runPromise(store.latestSequence())).toBe(2);
  });

  test("handles different event types", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    const taskId = makeTaskId("task-1");

    await Effect.runPromise(store.append(makeTaskCreatedEvent(taskId, 0)));
    await Effect.runPromise(
      store.append(makeTaskAssignedEvent(taskId, makeAgentId("agent-1"), 0)),
    );
    await Effect.runPromise(
      store.append(makeMeetingScheduledEvent(makeMeetingId("mtg-1"), 0)),
    );

    const events = await Effect.runPromise(store.readAll());
    expect(events.map((e) => e.type)).toEqual([
      "task.created",
      "task.assigned",
      "meeting.scheduled",
    ]);
  });
});

describe("EventStore.readAll", () => {
  test("returns empty array when no events", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const events = await Effect.runPromise(store.readAll());

    expect(events).toEqual([]);
  });

  test("returns all events in order", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t3"), 0)));

    const events = await Effect.runPromise(store.readAll());

    expect(events).toHaveLength(3);
    expect(events[0].sequence).toBe(1);
    expect(events[1].sequence).toBe(2);
    expect(events[2].sequence).toBe(3);
  });

  test("returns readonly array (does not expose internal state)", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));

    const events = await Effect.runPromise(store.readAll());

    expect(Array.isArray(events)).toBe(true);
  });
});

describe("EventStore.readFrom", () => {
  test("returns events after given sequence", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t3"), 0)));

    const stream = store.readFrom(1);
    const events = await Effect.runPromise(Stream.runCollect(stream));
    const eventsArray = Array.from(events);

    expect(eventsArray).toHaveLength(2);
    expect(eventsArray[0].sequence).toBe(2);
    expect(eventsArray[1].sequence).toBe(3);
  });

  test("returns all events when starting from 0", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));

    const stream = store.readFrom(0);
    const events = await Effect.runPromise(Stream.runCollect(stream));
    const eventsArray = Array.from(events);

    expect(eventsArray).toHaveLength(2);
  });

  test("returns empty stream when starting from latest sequence", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));

    const stream = store.readFrom(2);
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events)).toHaveLength(0);
  });

  test("returns empty stream for empty store", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const stream = store.readFrom(0);
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events)).toHaveLength(0);
  });

  test("handles large sequence offset", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));

    const stream = store.readFrom(1000);
    const events = await Effect.runPromise(Stream.runCollect(stream));

    expect(Array.from(events)).toHaveLength(0);
  });
});

describe("EventStore.latestSequence", () => {
  test("returns 0 for empty store", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const sequence = await Effect.runPromise(store.latestSequence());

    expect(sequence).toBe(0);
  });

  test("returns latest sequence after multiple appends", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));
    await Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId("t3"), 0)));

    const sequence = await Effect.runPromise(store.latestSequence());

    expect(sequence).toBe(3);
  });
});

describe("EventStore isolation", () => {
  test("separate store instances have independent state", async () => {
    const store1 = await Effect.runPromise(createInMemoryEventStore());
    const store2 = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store1.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store1.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));

    const events1 = await Effect.runPromise(store1.readAll());
    const events2 = await Effect.runPromise(store2.readAll());

    expect(events1).toHaveLength(2);
    expect(events2).toHaveLength(0);
  });

  test("separate stores have independent sequences", async () => {
    const store1 = await Effect.runPromise(createInMemoryEventStore());
    const store2 = await Effect.runPromise(createInMemoryEventStore());

    await Effect.runPromise(store1.append(makeTaskCreatedEvent(makeTaskId("t1"), 0)));
    await Effect.runPromise(store1.append(makeTaskCreatedEvent(makeTaskId("t2"), 0)));
    await Effect.runPromise(store2.append(makeTaskCreatedEvent(makeTaskId("t3"), 0)));

    expect(await Effect.runPromise(store1.latestSequence())).toBe(2);
    expect(await Effect.runPromise(store2.latestSequence())).toBe(1);
  });
});

describe("EventStore concurrent operations", () => {
  test("handles concurrent appends with sequential sequences", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());

    const appendOperations = Array.from({ length: 10 }, (_, i) =>
      Effect.runPromise(store.append(makeTaskCreatedEvent(makeTaskId(`t${i}`), 0))),
    );

    const events = await Promise.all(appendOperations);

    const sequences = events.map((e) => e.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("EventStore event integrity", () => {
  test("preserves all event fields except sequence", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    const taskId = makeTaskId("task-1");
    const originalEvent = makeTaskCreatedEvent(taskId, 999);

    const persistedEvent = await Effect.runPromise(store.append(originalEvent));

    expect(persistedEvent.eventId).toBe(originalEvent.eventId);
    expect(persistedEvent.type).toBe(originalEvent.type);
    expect(persistedEvent.aggregateKind).toBe(originalEvent.aggregateKind);
    expect(persistedEvent.aggregateId).toBe(originalEvent.aggregateId);
    expect(persistedEvent.occurredAt).toBe(originalEvent.occurredAt);
    expect(persistedEvent.commandId).toBe(originalEvent.commandId);
    expect(persistedEvent.payload).toEqual(originalEvent.payload);
    expect(persistedEvent.sequence).toBe(1);
  });

  test("readAll returns events with correct types", async () => {
    const store = await Effect.runPromise(createInMemoryEventStore());
    const taskId = makeTaskId("task-1");

    await Effect.runPromise(store.append(makeTaskCreatedEvent(taskId, 0)));
    await Effect.runPromise(
      store.append(
        makeTaskStatusUpdatedEvent(taskId, "pending", "assigned", 0),
      ),
    );

    const events = await Effect.runPromise(store.readAll());

    const createdEvent = events.find(
      (e): e is Extract<OrchestrationEvent, { type: "task.created" }> =>
        e.type === "task.created",
    );
    const statusEvent = events.find(
      (e): e is Extract<OrchestrationEvent, { type: "task.status-updated" }> =>
        e.type === "task.status-updated",
    );

    expect(createdEvent).toBeDefined();
    expect(statusEvent).toBeDefined();
    expect(createdEvent?.payload.taskId).toBe(taskId);
    expect(statusEvent?.payload.status).toBe("assigned");
  });
});
