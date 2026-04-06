import { Effect, Ref } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentRole } from "@/shared/types/orchestration";
import type { AgentId, TaskId, MeetingId } from "@/shared/types/base-schemas";

export type DecisionType =
  | "task_decomposition"
  | "task_assignment"
  | "code_review"
  | "test_result"
  | "meeting_summary";

export interface DecisionLogEntry {
  readonly id: string;
  readonly type: DecisionType;
  readonly agentId: AgentId;
  readonly agentRole: AgentRole;
  readonly timestamp: string;
  readonly context: {
    readonly taskId?: TaskId;
    readonly meetingId?: MeetingId;
    readonly parentTaskId?: TaskId;
  };
  readonly rationale: string;
  readonly outcome: string;
  readonly artifacts?: string[];
}

export interface DecisionLogStoreShape {
  readonly log: (entry: Omit<DecisionLogEntry, "id" | "timestamp">) => Effect.Effect<DecisionLogEntry>;
  readonly getByTask: (taskId: TaskId) => Effect.Effect<ReadonlyArray<DecisionLogEntry>>;
  readonly getByAgent: (agentId: AgentId) => Effect.Effect<ReadonlyArray<DecisionLogEntry>>;
  readonly getByMeeting: (meetingId: MeetingId) => Effect.Effect<ReadonlyArray<DecisionLogEntry>>;
  readonly getRecent: (limit: number) => Effect.Effect<ReadonlyArray<DecisionLogEntry>>;
  readonly getAll: () => Effect.Effect<ReadonlyArray<DecisionLogEntry>>;
}

export interface DecisionLogStoreOptions {
  readonly storagePath: string;
}

const DECISIONS_FILE = "decisions.json";

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadDecisionsFromDisk(filePath: string): DecisionLogEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DecisionLogEntry[];
  } catch {
    return [];
  }
}

function saveDecisionsToDisk(filePath: string, decisions: DecisionLogEntry[]): void {
  writeFileSync(filePath, JSON.stringify(decisions, null, 2), "utf-8");
}

export function createDecisionLogStore(
  options: DecisionLogStoreOptions,
): Effect.Effect<DecisionLogStoreShape> {
  return Effect.gen(function* () {
    const { storagePath } = options;
    ensureDir(storagePath);

    const decisionsFilePath = join(storagePath, DECISIONS_FILE);
    const initialDecisions = loadDecisionsFromDisk(decisionsFilePath);

    const decisionsRef = yield* Ref.make<DecisionLogEntry[]>(initialDecisions);

    const persistToDisk = () =>
      Effect.gen(function* () {
        const decisions = yield* Ref.get(decisionsRef);
        saveDecisionsToDisk(decisionsFilePath, decisions);
      });

    const log: DecisionLogStoreShape["log"] = (entry) =>
      Effect.gen(function* () {
        const fullEntry: DecisionLogEntry = {
          ...entry,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        };

        yield* Ref.update(decisionsRef, (decisions) => [...decisions, fullEntry]);
        yield* persistToDisk();
        return fullEntry;
      });

    const getByTask: DecisionLogStoreShape["getByTask"] = (taskId) =>
      Effect.gen(function* () {
        const decisions = yield* Ref.get(decisionsRef);
        return decisions.filter((d) => d.context.taskId === taskId);
      });

    const getByAgent: DecisionLogStoreShape["getByAgent"] = (agentId) =>
      Effect.gen(function* () {
        const decisions = yield* Ref.get(decisionsRef);
        return decisions.filter((d) => d.agentId === agentId);
      });

    const getByMeeting: DecisionLogStoreShape["getByMeeting"] = (meetingId) =>
      Effect.gen(function* () {
        const decisions = yield* Ref.get(decisionsRef);
        return decisions.filter((d) => d.context.meetingId === meetingId);
      });

    const getRecent: DecisionLogStoreShape["getRecent"] = (limit) =>
      Effect.gen(function* () {
        const decisions = yield* Ref.get(decisionsRef);
        return decisions.slice(-limit);
      });

    const getAll: DecisionLogStoreShape["getAll"] = () => Ref.get(decisionsRef);

    return {
      log,
      getByTask,
      getByAgent,
      getByMeeting,
      getRecent,
      getAll,
    } satisfies DecisionLogStoreShape;
  });
}
