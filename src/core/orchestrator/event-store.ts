import { Effect, Ref, Stream } from "effect";

import type { OrchestrationEvent } from "@/shared/types/orchestration";

import { EventStoreError } from "./errors";

export interface EventStoreShape {
  readonly append: (
    event: Omit<OrchestrationEvent, "sequence">,
  ) => Effect.Effect<OrchestrationEvent, EventStoreError>;

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

    const append: EventStoreShape["append"] = (eventWithoutSeq) =>
      Effect.gen(function* () {
        const nextSeq = yield* Ref.updateAndGet(sequenceRef, (s) => s + 1);
        const event = {
          ...eventWithoutSeq,
          sequence: nextSeq,
        } as OrchestrationEvent;

        yield* Ref.update(eventsRef, (events) => [...events, event]);
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
