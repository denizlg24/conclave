import { Effect, Ref, Stream } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { EventStoreShape } from "../orchestrator/event-store";

const EVENTS_FILE = "events.json";

export interface PersistentEventStoreOptions {
  readonly storagePath: string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadEventsFromDisk(filePath: string): OrchestrationEvent[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as OrchestrationEvent[];
  } catch {
    return [];
  }
}

function saveEventsToDisk(filePath: string, events: OrchestrationEvent[]): void {
  writeFileSync(filePath, JSON.stringify(events, null, 2), "utf-8");
}

export function createPersistentEventStore(
  options: PersistentEventStoreOptions,
): Effect.Effect<EventStoreShape> {
  return Effect.gen(function* () {
    const { storagePath } = options;
    ensureDir(storagePath);

    const eventsFilePath = join(storagePath, EVENTS_FILE);
    const initialEvents = loadEventsFromDisk(eventsFilePath);
    const initialSequence = initialEvents.length > 0
      ? Math.max(...initialEvents.map((e) => e.sequence))
      : 0;

    const eventsRef = yield* Ref.make<OrchestrationEvent[]>(initialEvents);
    const sequenceRef = yield* Ref.make(initialSequence);

    const persistToDisk = () =>
      Effect.gen(function* () {
        const events = yield* Ref.get(eventsRef);
        saveEventsToDisk(eventsFilePath, events);
      });

    const append: EventStoreShape["append"] = (eventWithoutSeq) =>
      Effect.gen(function* () {
        const nextSeq = yield* Ref.updateAndGet(sequenceRef, (s) => s + 1);
        const event = {
          ...eventWithoutSeq,
          sequence: nextSeq,
        } as OrchestrationEvent;

        yield* Ref.update(eventsRef, (events) => [...events, event]);
        yield* persistToDisk();
        return event;
      });

    const readFrom: EventStoreShape["readFrom"] = (fromSequenceExclusive) =>
      Stream.fromEffect(Ref.get(eventsRef)).pipe(
        Stream.flatMap((events) =>
          Stream.fromIterable(
            events.filter((e) => e.sequence > fromSequenceExclusive),
          ),
        ),
      );

    const readAll: EventStoreShape["readAll"] = () => Ref.get(eventsRef);

    const latestSequence: EventStoreShape["latestSequence"] = () =>
      Ref.get(sequenceRef);

    return { append, readFrom, readAll, latestSequence } satisfies EventStoreShape;
  });
}
