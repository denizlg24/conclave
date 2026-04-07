import { Effect, Ref } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentRole } from "@/shared/types/orchestration";
import type { AgentId, TaskId } from "@/shared/types/base-schemas";

/**
 * Context saved when a task is suspended due to quota exhaustion.
 * Contains all information needed to resume the task.
 */
export interface SuspensionContext {
  readonly id: string;
  readonly taskId: TaskId;
  readonly agentId: AgentId;
  readonly agentRole: AgentRole;
  readonly claudeSessionId: string;
  readonly suspendedAt: string;
  readonly reason: SuspensionReason;
  readonly executionContext: {
    readonly prompt: string;
    readonly taskType: string;
    readonly taskTitle: string;
    readonly partialOutput?: string;
  };
  readonly quotaInfo?: {
    readonly adapterType: string;
    readonly rawMessage: string;
  };
}

export type SuspensionReason = "quota_exhausted" | "manual_pause" | "budget_exceeded";

export interface SuspensionStoreShape {
  readonly save: (context: Omit<SuspensionContext, "id" | "suspendedAt">) => Effect.Effect<SuspensionContext>;
  readonly getByTask: (taskId: TaskId) => Effect.Effect<SuspensionContext | null>;
  readonly getByAgent: (agentId: AgentId) => Effect.Effect<ReadonlyArray<SuspensionContext>>;
  readonly getAllPending: () => Effect.Effect<ReadonlyArray<SuspensionContext>>;
  readonly remove: (taskId: TaskId) => Effect.Effect<void>;
  readonly clear: () => Effect.Effect<void>;
}

export interface SuspensionStoreOptions {
  readonly storagePath: string;
}

const SUSPENSIONS_FILE = "suspensions.json";

const VALID_AGENT_ROLES: ReadonlyArray<AgentRole> = ["pm", "developer", "reviewer", "tester"];
const VALID_SUSPENSION_REASONS: ReadonlyArray<SuspensionReason> = [
  "quota_exhausted",
  "manual_pause",
  "budget_exceeded",
];

function isValidAgentRole(value: unknown): value is AgentRole {
  return VALID_AGENT_ROLES.includes(value as AgentRole);
}

function isValidSuspensionContext(value: unknown): value is SuspensionContext {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    typeof v.taskId !== "string" ||
    typeof v.agentId !== "string" ||
    typeof v.claudeSessionId !== "string" ||
    typeof v.suspendedAt !== "string"
  ) {
    return false;
  }
  if (!isValidAgentRole(v.agentRole)) return false;
  if (!VALID_SUSPENSION_REASONS.includes(v.reason as SuspensionReason)) return false;
  if (typeof v.executionContext !== "object" || v.executionContext === null) return false;
  const ec = v.executionContext as Record<string, unknown>;
  if (
    typeof ec.prompt !== "string" ||
    typeof ec.taskType !== "string" ||
    typeof ec.taskTitle !== "string"
  ) {
    return false;
  }
  return true;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadSuspensionsFromDisk(filePath: string): SuspensionContext[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn("[suspension-store] suspensions.json root is not an array — discarding file contents");
      return [];
    }
    const valid: SuspensionContext[] = [];
    for (const entry of parsed) {
      if (isValidSuspensionContext(entry)) {
        valid.push(entry);
      } else {
        const entryId =
          typeof entry === "object" && entry !== null
            ? String((entry as Record<string, unknown>).id ?? "unknown")
            : "unknown";
        console.warn(
          `[suspension-store] Discarding suspension entry id=${entryId}: failed runtime validation (agentRole or required fields invalid)`,
        );
      }
    }
    return valid;
  } catch {
    return [];
  }
}

function saveSuspensionsToDisk(filePath: string, suspensions: SuspensionContext[]): void {
  writeFileSync(filePath, JSON.stringify(suspensions, null, 2), "utf-8");
}

export function createSuspensionStore(
  options: SuspensionStoreOptions,
): Effect.Effect<SuspensionStoreShape> {
  return Effect.gen(function* () {
    const { storagePath } = options;
    ensureDir(storagePath);

    const suspensionsFilePath = join(storagePath, SUSPENSIONS_FILE);
    const initialSuspensions = loadSuspensionsFromDisk(suspensionsFilePath);

    const suspensionsRef = yield* Ref.make<SuspensionContext[]>(initialSuspensions);

    const persistToDisk = () =>
      Effect.gen(function* () {
        const suspensions = yield* Ref.get(suspensionsRef);
        saveSuspensionsToDisk(suspensionsFilePath, suspensions);
      });

    const save: SuspensionStoreShape["save"] = (context) =>
      Effect.gen(function* () {
        const fullContext: SuspensionContext = {
          ...context,
          id: crypto.randomUUID(),
          suspendedAt: new Date().toISOString(),
        };

        // Remove any existing suspension for the same task first
        yield* Ref.update(suspensionsRef, (suspensions) =>
          suspensions.filter((s) => s.taskId !== context.taskId),
        );

        yield* Ref.update(suspensionsRef, (suspensions) => [...suspensions, fullContext]);
        yield* persistToDisk();

        console.log(`[suspension-store] Saved suspension context for task ${context.taskId}`);
        return fullContext;
      });

    const getByTask: SuspensionStoreShape["getByTask"] = (taskId) =>
      Effect.gen(function* () {
        const suspensions = yield* Ref.get(suspensionsRef);
        return suspensions.find((s) => s.taskId === taskId) ?? null;
      });

    const getByAgent: SuspensionStoreShape["getByAgent"] = (agentId) =>
      Effect.gen(function* () {
        const suspensions = yield* Ref.get(suspensionsRef);
        return suspensions.filter((s) => s.agentId === agentId);
      });

    const getAllPending: SuspensionStoreShape["getAllPending"] = () =>
      Ref.get(suspensionsRef);

    const remove: SuspensionStoreShape["remove"] = (taskId) =>
      Effect.gen(function* () {
        yield* Ref.update(suspensionsRef, (suspensions) =>
          suspensions.filter((s) => s.taskId !== taskId),
        );
        yield* persistToDisk();
        console.log(`[suspension-store] Removed suspension context for task ${taskId}`);
      });

    const clear: SuspensionStoreShape["clear"] = () =>
      Effect.gen(function* () {
        yield* Ref.set(suspensionsRef, []);
        yield* persistToDisk();
        console.log(`[suspension-store] Cleared all suspension contexts`);
      });

    return {
      save,
      getByTask,
      getByAgent,
      getAllPending,
      remove,
      clear,
    } satisfies SuspensionStoreShape;
  });
}
