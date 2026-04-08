import { Effect, Ref, Stream } from "effect";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { OrchestrationEvent } from "@/shared/types/orchestration";
import type { EventStoreShape } from "../orchestrator/event-store";
import { EventStoreError } from "../orchestrator/errors";

const EVENTS_FILE = "events.ndjson";
const LEGACY_EVENTS_FILE = "events.json";

export interface PersistentEventStoreOptions {
  readonly storagePath: string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parsePersistedLine(line: string): OrchestrationEvent[] {
  const parsed = JSON.parse(line) as unknown;
  if (Array.isArray(parsed)) {
    return parsed as OrchestrationEvent[];
  }
  return [parsed as OrchestrationEvent];
}

function loadEventsFromDisk(filePath: string): OrchestrationEvent[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          return parsePersistedLine(line);
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function loadLegacyEventsFromDisk(filePath: string): OrchestrationEvent[] {
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

function appendEventsToDisk(
  filePath: string,
  events: ReadonlyArray<OrchestrationEvent>,
): void {
  const serializedBatch = JSON.stringify(events);
  appendFileSync(filePath, `${serializedBatch}\n`, "utf-8");
}

export function createPersistentEventStore(
  options: PersistentEventStoreOptions,
): Effect.Effect<EventStoreShape> {
  return Effect.gen(function* () {
    const { storagePath } = options;
    ensureDir(storagePath);

    const eventsFilePath = join(storagePath, EVENTS_FILE);
    const legacyEventsFilePath = join(storagePath, LEGACY_EVENTS_FILE);
    const initialEvents = [
      ...loadLegacyEventsFromDisk(legacyEventsFilePath),
      ...loadEventsFromDisk(eventsFilePath),
    ];
    const initialSequence = initialEvents.length > 0
      ? Math.max(...initialEvents.map((e) => e.sequence))
      : 0;

    const eventsRef = yield* Ref.make<OrchestrationEvent[]>(initialEvents);
    const sequenceRef = yield* Ref.make(initialSequence);

    const appendBatch: EventStoreShape["appendBatch"] = (eventsWithoutSeq) =>
      Effect.gen(function* () {
        if (eventsWithoutSeq.length === 0) {
          return [];
        }

        const currentSequence = yield* Ref.get(sequenceRef);
        const persistedEvents = eventsWithoutSeq.map((eventWithoutSeq, index) => ({
          ...eventWithoutSeq,
          sequence: currentSequence + index + 1,
        })) as ReadonlyArray<OrchestrationEvent>;

        yield* Effect.try({
          try: () => appendEventsToDisk(eventsFilePath, persistedEvents),
          catch: (error) =>
            new EventStoreError({
              operation: "appendBatch",
              detail: String(error),
            }),
        });

        yield* Ref.update(eventsRef, (events) => [...events, ...persistedEvents]);
        yield* Ref.set(
          sequenceRef,
          persistedEvents[persistedEvents.length - 1]?.sequence ?? currentSequence,
        );
        return persistedEvents;
      });

    const append: EventStoreShape["append"] = (eventWithoutSeq) =>
      appendBatch([eventWithoutSeq]).pipe(
        Effect.map((events) => events[0]!),
      );

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

    return {
      append,
      appendBatch,
      readFrom,
      readAll,
      latestSequence,
    } satisfies EventStoreShape;
  });
}
