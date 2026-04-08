import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Effect, Stream } from "effect";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPersistentEventStore } from "../persistent-event-store";
import {
  makeTaskCreatedEvent,
  makeTaskId,
  resetCounters,
} from "@/test-utils/factories";

const TEST_DIR = join(tmpdir(), `conclave-event-store-test-${Date.now()}`);

async function runEffectAsync<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

describe("PersistentEventStore", () => {
  beforeEach(() => {
    resetCounters();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("createPersistentEventStore", () => {
    test("creates store and directory if not exists", async () => {
      const storagePath = join(TEST_DIR, "new-storage");
      expect(existsSync(storagePath)).toBe(false);

      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      expect(store).toBeDefined();
      expect(existsSync(storagePath)).toBe(true);
    });

    test("starts with empty events and sequence 0", async () => {
      const storagePath = join(TEST_DIR, "empty-store");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const events = await runEffectAsync(store.readAll());
      const sequence = await runEffectAsync(store.latestSequence());

      expect(events).toEqual([]);
      expect(sequence).toBe(0);
    });
  });

  describe("append", () => {
    test("appends event with auto-incremented sequence", async () => {
      const storagePath = join(TEST_DIR, "append-test");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const taskId = makeTaskId("test-task");
      const eventWithoutSeq = makeTaskCreatedEvent(taskId, 0);
      const { sequence: _, ...eventData } = eventWithoutSeq;

      const appended = await runEffectAsync(store.append(eventData));

      expect(appended.sequence).toBe(1);
      expect(appended.type).toBe("task.created");
      if (appended.type === "task.created") {
        expect(appended.payload.taskId).toBe(taskId);
      }
    });

    test("increments sequence for multiple appends", async () => {
      const storagePath = join(TEST_DIR, "multi-append");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const event1 = makeTaskCreatedEvent(makeTaskId("task-1"), 0);
      const event2 = makeTaskCreatedEvent(makeTaskId("task-2"), 0);
      const event3 = makeTaskCreatedEvent(makeTaskId("task-3"), 0);

      const { sequence: _1, ...data1 } = event1;
      const { sequence: _2, ...data2 } = event2;
      const { sequence: _3, ...data3 } = event3;

      const appended1 = await runEffectAsync(store.append(data1));
      const appended2 = await runEffectAsync(store.append(data2));
      const appended3 = await runEffectAsync(store.append(data3));

      expect(appended1.sequence).toBe(1);
      expect(appended2.sequence).toBe(2);
      expect(appended3.sequence).toBe(3);

      const latestSeq = await runEffectAsync(store.latestSequence());
      expect(latestSeq).toBe(3);
    });

    test("persists events to disk after each append", async () => {
      const storagePath = join(TEST_DIR, "persist-test");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const taskId = makeTaskId("persisted-task");
      const event = makeTaskCreatedEvent(taskId, 0);
      const { sequence: _, ...eventData } = event;

      await runEffectAsync(store.append(eventData));

      const filePath = join(storagePath, "events.ndjson");
      expect(existsSync(filePath)).toBe(true);

      const fileContent = readFileSync(filePath, "utf-8");
      const persistedEvents = fileContent
        .trim()
        .split(/\r?\n/)
        .flatMap(
          (line) => JSON.parse(line) as Array<{
            sequence: number;
            payload: { taskId: string };
          }>,
        );

      expect(persistedEvents).toHaveLength(1);
      expect(persistedEvents[0].sequence).toBe(1);
      expect(persistedEvents[0].payload.taskId).toBe(taskId);
    });
  });

  describe("readAll", () => {
    test("returns all appended events", async () => {
      const storagePath = join(TEST_DIR, "read-all");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const event1 = makeTaskCreatedEvent(makeTaskId("t1"), 0);
      const event2 = makeTaskCreatedEvent(makeTaskId("t2"), 0);
      const { sequence: _1, ...data1 } = event1;
      const { sequence: _2, ...data2 } = event2;

      await runEffectAsync(store.append(data1));
      await runEffectAsync(store.append(data2));

      const events = await runEffectAsync(store.readAll());

      expect(events).toHaveLength(2);
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
    });
  });

  describe("readFrom", () => {
    test("returns events after specified sequence", async () => {
      const storagePath = join(TEST_DIR, "read-from");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const event1 = makeTaskCreatedEvent(makeTaskId("t1"), 0);
      const event2 = makeTaskCreatedEvent(makeTaskId("t2"), 0);
      const event3 = makeTaskCreatedEvent(makeTaskId("t3"), 0);
      const { sequence: _1, ...data1 } = event1;
      const { sequence: _2, ...data2 } = event2;
      const { sequence: _3, ...data3 } = event3;

      await runEffectAsync(store.append(data1));
      await runEffectAsync(store.append(data2));
      await runEffectAsync(store.append(data3));

      const stream = store.readFrom(1);
      const events = await runEffectAsync(Stream.runCollect(stream));
      const eventsArray = Array.from(events);

      expect(eventsArray).toHaveLength(2);
      expect(eventsArray[0].sequence).toBe(2);
      expect(eventsArray[1].sequence).toBe(3);
    });

    test("returns empty for sequence at or past latest", async () => {
      const storagePath = join(TEST_DIR, "read-from-empty");
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const event = makeTaskCreatedEvent(makeTaskId("t1"), 0);
      const { sequence: _, ...data } = event;
      await runEffectAsync(store.append(data));

      const stream = store.readFrom(1);
      const events = await runEffectAsync(Stream.runCollect(stream));

      expect(Array.from(events)).toHaveLength(0);
    });
  });

  describe("persistence and reload", () => {
    test("reloads events from disk on new store creation", async () => {
      const storagePath = join(TEST_DIR, "reload-test");

      // First store: append events
      const store1 = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const taskId1 = makeTaskId("reload-t1");
      const taskId2 = makeTaskId("reload-t2");
      const event1 = makeTaskCreatedEvent(taskId1, 0);
      const event2 = makeTaskCreatedEvent(taskId2, 0);
      const { sequence: _1, ...data1 } = event1;
      const { sequence: _2, ...data2 } = event2;

      await runEffectAsync(store1.append(data1));
      await runEffectAsync(store1.append(data2));

      // Second store: should reload from disk
      const store2 = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const events = await runEffectAsync(store2.readAll());
      const latestSeq = await runEffectAsync(store2.latestSequence());

      expect(events).toHaveLength(2);
      expect(latestSeq).toBe(2);
      
      const reloaded0 = events[0];
      const reloaded1 = events[1];
      if (reloaded0.type === "task.created" && reloaded1.type === "task.created") {
        expect(reloaded0.payload.taskId).toBe(taskId1);
        expect(reloaded1.payload.taskId).toBe(taskId2);
      }
    });

    test("continues sequence numbering after reload", async () => {
      const storagePath = join(TEST_DIR, "sequence-continue");

      // First store
      const store1 = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );
      const event1 = makeTaskCreatedEvent(makeTaskId("t1"), 0);
      const { sequence: _, ...data1 } = event1;
      await runEffectAsync(store1.append(data1));

      // Second store: append more
      const store2 = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );
      const event2 = makeTaskCreatedEvent(makeTaskId("t2"), 0);
      const { sequence: _2, ...data2 } = event2;
      const appended = await runEffectAsync(store2.append(data2));

      expect(appended.sequence).toBe(2);

      const allEvents = await runEffectAsync(store2.readAll());
      expect(allEvents).toHaveLength(2);
    });

    test("handles corrupted JSON gracefully by starting fresh", async () => {
      const storagePath = join(TEST_DIR, "corrupted");
      mkdirSync(storagePath, { recursive: true });

      // Write corrupted JSON
      const filePath = join(storagePath, "events.json");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, "{ not valid json", "utf-8");

      // Should not throw, should start fresh
      const store = await runEffectAsync(
        createPersistentEventStore({ storagePath }),
      );

      const events = await runEffectAsync(store.readAll());
      const seq = await runEffectAsync(store.latestSequence());

      expect(events).toEqual([]);
      expect(seq).toBe(0);
    });
  });
});
