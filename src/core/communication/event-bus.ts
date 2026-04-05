import { Effect, PubSub, Stream } from "effect";

import type { BusEvent } from "@/shared/types/bus-event";

export interface EventBusShape {
  readonly publish: (event: BusEvent) => Effect.Effect<void>;

  readonly subscribeFiltered: <T extends BusEvent>(
    predicate: (event: BusEvent) => event is T,
  ) => Stream.Stream<T>;

  readonly shutdown: () => Effect.Effect<void>;
}

export function createEventBus(): Effect.Effect<EventBusShape> {
  return Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<BusEvent>();

    const publish: EventBusShape["publish"] = (event) =>
      PubSub.publish(pubsub, event).pipe(Effect.asVoid);

    const subscribeFiltered: EventBusShape["subscribeFiltered"] = <
      T extends BusEvent,
    >(
      predicate: (event: BusEvent) => event is T,
    ) =>
      Stream.fromPubSub(pubsub).pipe(
        Stream.filter(predicate),
      );

    const shutdown: EventBusShape["shutdown"] = () =>
      PubSub.shutdown(pubsub);

    return { publish, subscribeFiltered, shutdown } satisfies EventBusShape;
  });
}
