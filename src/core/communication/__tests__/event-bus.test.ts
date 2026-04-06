import { describe, expect, test, beforeEach } from "bun:test";
import { Effect, Fiber, Stream } from "effect";

import { createEventBus } from "../event-bus";
import type { BusEvent } from "@/shared/types/bus-event";
import {
  makeTaskCreatedEvent,
  makeMeetingScheduledEvent,
  makeTaskId,
  makeMeetingId,
  resetCounters,
} from "@/test-utils/factories";

beforeEach(() => {
  resetCounters();
});

describe("EventBus", () => {
  describe("createEventBus", () => {
    test("creates an event bus instance", async () => {
      const bus = await Effect.runPromise(createEventBus());
      expect(bus).toBeDefined();
      expect(bus.publish).toBeInstanceOf(Function);
      expect(bus.subscribeFiltered).toBeInstanceOf(Function);
      expect(bus.shutdown).toBeInstanceOf(Function);
    });
  });

  describe("publish and subscribe", () => {
    test("subscriber receives published events", async () => {
      const bus = await Effect.runPromise(createEventBus());
      const received: BusEvent[] = [];

      const taskId = makeTaskId();
      const event = makeTaskCreatedEvent(taskId, 1);

      // Subscribe to all events
      const subscription = bus.subscribeFiltered(
        (_e: BusEvent): _e is BusEvent => true,
      );

      // Start collecting events in background
      const collectFiber = Effect.runFork(
        subscription.pipe(
          Stream.take(1),
          Stream.runForEach((e) =>
            Effect.sync(() => {
              received.push(e);
            }),
          ),
        ),
      );

      // Give subscription time to set up
      await new Promise((r) => setTimeout(r, 10));

      // Publish event
      await Effect.runPromise(bus.publish(event));

      // Wait for collection to complete
      await Effect.runPromise(Fiber.join(collectFiber));

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(event);
    });

    test("multiple subscribers receive the same event", async () => {
      const bus = await Effect.runPromise(createEventBus());
      const received1: BusEvent[] = [];
      const received2: BusEvent[] = [];

      const taskId = makeTaskId();
      const event = makeTaskCreatedEvent(taskId, 1);

      const sub1 = bus.subscribeFiltered((_e: BusEvent): _e is BusEvent => true);
      const sub2 = bus.subscribeFiltered((_e: BusEvent): _e is BusEvent => true);

      const fiber1 = Effect.runFork(
        sub1.pipe(
          Stream.take(1),
          Stream.runForEach((e) => Effect.sync(() => { received1.push(e); })),
        ),
      );

      const fiber2 = Effect.runFork(
        sub2.pipe(
          Stream.take(1),
          Stream.runForEach((e) => Effect.sync(() => { received2.push(e); })),
        ),
      );

      await new Promise((r) => setTimeout(r, 10));
      await Effect.runPromise(bus.publish(event));

      await Effect.runPromise(Fiber.join(fiber1));
      await Effect.runPromise(Fiber.join(fiber2));

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received1[0]).toEqual(event);
      expect(received2[0]).toEqual(event);
    });
  });

  describe("filtered subscriptions", () => {
    test("subscriber only receives events matching predicate", async () => {
      const bus = await Effect.runPromise(createEventBus());
      const receivedTasks: BusEvent[] = [];
      const receivedMeetings: BusEvent[] = [];

      const taskId = makeTaskId();
      const meetingId = makeMeetingId();
      const taskEvent = makeTaskCreatedEvent(taskId, 1);
      const meetingEvent = makeMeetingScheduledEvent(meetingId, 2);

      // Subscribe to task events only
      const taskSub = bus.subscribeFiltered(
        (e: BusEvent): e is BusEvent => e.type.startsWith("task."),
      );

      // Subscribe to meeting events only
      const meetingSub = bus.subscribeFiltered(
        (e: BusEvent): e is BusEvent => e.type.startsWith("meeting."),
      );

      const taskFiber = Effect.runFork(
        taskSub.pipe(
          Stream.take(1),
          Stream.runForEach((e) => Effect.sync(() => { receivedTasks.push(e); })),
        ),
      );

      const meetingFiber = Effect.runFork(
        meetingSub.pipe(
          Stream.take(1),
          Stream.runForEach((e) => Effect.sync(() => { receivedMeetings.push(e); })),
        ),
      );

      await new Promise((r) => setTimeout(r, 10));

      await Effect.runPromise(bus.publish(taskEvent));
      await Effect.runPromise(bus.publish(meetingEvent));

      await Effect.runPromise(Fiber.join(taskFiber));
      await Effect.runPromise(Fiber.join(meetingFiber));

      expect(receivedTasks).toHaveLength(1);
      expect(receivedTasks[0].type).toBe("task.created");

      expect(receivedMeetings).toHaveLength(1);
      expect(receivedMeetings[0].type).toBe("meeting.scheduled");
    });
  });

  describe("shutdown", () => {
    test("shutdown completes without error", async () => {
      const bus = await Effect.runPromise(createEventBus());
      await expect(Effect.runPromise(bus.shutdown())).resolves.toBeUndefined();
    });
  });
});
