import { Effect, Ref, Stream } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";

import { EventStoreError } from "./errors";

export interface EventStoreShape {
  readonly append: (
    event: Omit<OrchestrationEvent, "sequence">,
  ) => Effect.Effect<OrchestrationEvent, EventStoreError>;

  readonly appendBatch: (
    events: ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
  ) => Effect.Effect<ReadonlyArray<OrchestrationEvent>, EventStoreError>;

  readonly readFrom: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<OrchestrationEvent, EventStoreError>;

  readonly readAll: () => Effect.Effect<
    ReadonlyArray<OrchestrationEvent>,
    EventStoreError
  >;

  readonly latestSequence: () => Effect.Effect<number, never>;
}

export function createInMemoryEventStore(): Effect.Effect<EventStoreShape> {
  return Effect.gen(function* () {
    const eventsRef = yield* Ref.make<OrchestrationEvent[]>([]);
    const sequenceRef = yield* Ref.make(0);

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
