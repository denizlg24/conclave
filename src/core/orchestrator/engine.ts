import { Effect, Ref, Stream } from "effect";

import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
} from "@/shared/types/orchestration";

import { DispatchError, type EventStoreError } from "./errors";
import { decideOrchestrationCommand } from "./decider";
import {
  createEmptyReadModel,
  projectEvents,
} from "./projector";
import {
  createInMemoryEventStore,
  type EventStoreShape,
} from "./event-store";

export interface OrchestrationEngineShape {
  readonly getReadModel: () => Effect.Effect<OrchestrationReadModel>;

  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<
    { readonly sequence: number; readonly events: ReadonlyArray<OrchestrationEvent> },
    DispatchError
  >;

  readonly readEvents: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<OrchestrationEvent, EventStoreError>;

  readonly replay: () => Effect.Effect<OrchestrationReadModel, EventStoreError>;
}

export function createOrchestrationEngine(): Effect.Effect<OrchestrationEngineShape> {
  return Effect.gen(function* () {
    const store: EventStoreShape = yield* createInMemoryEventStore();
    const readModelRef = yield* Ref.make<OrchestrationReadModel>(
      createEmptyReadModel(new Date().toISOString()),
    );

    const getReadModel: OrchestrationEngineShape["getReadModel"] = () =>
      Ref.get(readModelRef);

    const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
      Effect.gen(function* () {
        const currentModel = yield* Ref.get(readModelRef);

        const result = yield* decideOrchestrationCommand({
          command,
          readModel: currentModel,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new DispatchError({ commandType: command.type, cause }),
          ),
        );

        const eventsWithoutSeq = Array.isArray(result) ? result : [result];
        const persistedEvents: OrchestrationEvent[] = [];

        for (const evt of eventsWithoutSeq) {
          const persisted = yield* store.append(evt).pipe(
            Effect.mapError(
              (cause) =>
                new DispatchError({ commandType: command.type, cause }),
            ),
          );
          persistedEvents.push(persisted);
        }

        // Project all new events onto the read model
        yield* Ref.update(readModelRef, (model) =>
          projectEvents(model, persistedEvents),
        );

        const lastEvent = persistedEvents[persistedEvents.length - 1]!;
        return { sequence: lastEvent.sequence, events: persistedEvents };
      });

    const readEvents: OrchestrationEngineShape["readEvents"] = (
      fromSequenceExclusive,
    ) => store.readFrom(fromSequenceExclusive);

    const replay: OrchestrationEngineShape["replay"] = () =>
      Effect.gen(function* () {
        const allEvents = yield* store.readAll();
        const rebuilt = projectEvents(
          createEmptyReadModel(new Date().toISOString()),
          allEvents,
        );
        yield* Ref.set(readModelRef, rebuilt);
        return rebuilt;
      });

    return {
      getReadModel,
      dispatch,
      readEvents,
      replay,
    } satisfies OrchestrationEngineShape;
  });
}
