import { Effect, Ref } from "effect";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentRuntimeEvent } from "@/shared/types/agent-runtime";

const AGENT_EVENTS_FILE = "agent-events.ndjson";

export interface AgentRuntimeEventStoreOptions {
  readonly storagePath: string;
}

export interface AgentRuntimeEventStoreShape {
  readonly append: (event: AgentRuntimeEvent) => Effect.Effect<void>;
  readonly readAll: () => Effect.Effect<ReadonlyArray<AgentRuntimeEvent>>;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadEventsFromDisk(filePath: string): AgentRuntimeEvent[] {
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
          return [JSON.parse(line) as AgentRuntimeEvent];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function createAgentRuntimeEventStore(
  options: AgentRuntimeEventStoreOptions,
): Effect.Effect<AgentRuntimeEventStoreShape> {
  return Effect.gen(function* () {
    ensureDir(options.storagePath);

    const eventsFilePath = join(options.storagePath, AGENT_EVENTS_FILE);
    const initialEvents = loadEventsFromDisk(eventsFilePath);
    const eventsRef = yield* Ref.make<AgentRuntimeEvent[]>(initialEvents);

    const append: AgentRuntimeEventStoreShape["append"] = (event) =>
      Effect.gen(function* () {
        appendFileSync(eventsFilePath, `${JSON.stringify(event)}\n`, "utf-8");
        yield* Ref.update(eventsRef, (events) => [...events, event]);
      });

    const readAll: AgentRuntimeEventStoreShape["readAll"] = () =>
      Ref.get(eventsRef);

    return {
      append,
      readAll,
    } satisfies AgentRuntimeEventStoreShape;
  });
}
