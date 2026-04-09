export const DEBUG_CONSOLE_LEVELS = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
] as const;

export type DebugConsoleLevel = (typeof DEBUG_CONSOLE_LEVELS)[number];

export const DEBUG_CONSOLE_SOURCES = ["bun", "webview"] as const;

export type DebugConsoleSource = (typeof DEBUG_CONSOLE_SOURCES)[number];

export interface DebugConsoleEntry {
  readonly id: string;
  readonly source: DebugConsoleSource;
  readonly level: DebugConsoleLevel;
  readonly message: string;
  readonly occurredAt: string;
}

export const MAX_DEBUG_CONSOLE_ENTRIES = 400;
