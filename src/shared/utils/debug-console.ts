import {
  MAX_DEBUG_CONSOLE_ENTRIES,
  type DebugConsoleEntry,
  type DebugConsoleLevel,
  type DebugConsoleSource,
} from "../types/debug-console";

function serializeConsoleValue(
  value: unknown,
  seen: WeakSet<object>,
): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(
        value,
        (_key, currentValue) => {
          if (
            typeof currentValue === "object" &&
            currentValue !== null
          ) {
            if (seen.has(currentValue)) {
              return "[Circular]";
            }
            seen.add(currentValue);
          }

          if (typeof currentValue === "bigint") {
            return currentValue.toString();
          }

          if (currentValue instanceof Error) {
            return {
              name: currentValue.name,
              message: currentValue.message,
              stack: currentValue.stack,
            };
          }

          return currentValue;
        },
        2,
      );
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function formatDebugConsoleArgs(
  args: readonly unknown[],
): string {
  return args
    .map((value) => serializeConsoleValue(value, new WeakSet<object>()))
    .join(" ");
}

export function createDebugConsoleEntry(params: {
  source: DebugConsoleSource;
  level: DebugConsoleLevel;
  args: readonly unknown[];
  occurredAt?: string;
}): DebugConsoleEntry {
  return {
    id: crypto.randomUUID(),
    source: params.source,
    level: params.level,
    message: formatDebugConsoleArgs(params.args),
    occurredAt: params.occurredAt ?? new Date().toISOString(),
  };
}

export function appendDebugConsoleEntry(
  entries: readonly DebugConsoleEntry[],
  entry: DebugConsoleEntry,
  limit = MAX_DEBUG_CONSOLE_ENTRIES,
): DebugConsoleEntry[] {
  return [...entries, entry].slice(-limit);
}

export function mergeDebugConsoleEntries(
  current: readonly DebugConsoleEntry[],
  incoming: readonly DebugConsoleEntry[],
  limit = MAX_DEBUG_CONSOLE_ENTRIES,
): DebugConsoleEntry[] {
  const unique = new Map<string, DebugConsoleEntry>();

  for (const entry of [...current, ...incoming]) {
    unique.set(entry.id, entry);
  }

  return [...unique.values()]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .slice(-limit);
}
