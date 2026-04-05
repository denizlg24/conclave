import { Effect, Fiber, Stream, type Scope } from "effect";

import type { AgentServiceShape } from "../agents/service";
import type { EventBusShape } from "./event-bus";

export function createAgentRuntimeIngestion(deps: {
  readonly bus: EventBusShape;
  readonly agentService: AgentServiceShape;
}): Effect.Effect<Fiber.Fiber<void>, never, Scope.Scope> {
  const { bus, agentService } = deps;

  return agentService.streamEvents.pipe(
    Stream.runForEach((event) =>
      bus.publish(event).pipe(
        Effect.catch((error: unknown) =>
          Effect.logWarning(
            `[agent-runtime-ingestion] Failed to publish ${event.type}: ${String(error)}`,
          ),
        ),
      ),
    ),
    Effect.forkScoped,
  );
}
