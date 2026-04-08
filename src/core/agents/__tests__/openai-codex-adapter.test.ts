import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { createOpenAICodexAdapter } from "../openai-codex-adapter";
import { makeAgentId, makeAgentRoleConfig, resetCounters } from "@/test-utils/factories";
import type { AgentRoleConfig } from "@/shared/types/agent-runtime";

function codexConfig(overrides: Partial<AgentRoleConfig> = {}): AgentRoleConfig {
  return makeAgentRoleConfig({
    model: "gpt-5-codex" as AgentRoleConfig["model"],
    workingDirectory: mockDir,
    ...overrides,
  });
}

let mockDir = "";
let stdoutFile = "";
let stderrFile = "";
let argsFile = "";
let promptFile = "";
let originalPath: string | undefined;
let originalWindowsPath: string | undefined;
let originalStdoutFile: string | undefined;
let originalStderrFile: string | undefined;
let originalArgsFile: string | undefined;
let originalPromptFile: string | undefined;
let originalExitCode: string | undefined;

function writeMockCodexFiles(): void {
  writeFileSync(
    join(mockDir, "codex.cmd"),
    `@echo off\r\nbun "%~dp0codex-mock.js" %*\r\n`,
    "utf8",
  );

  writeFileSync(
    join(mockDir, "codex-mock.js"),
    [
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      "",
      'const prompt = await new Response(Bun.stdin.stream()).text();',
      'writeFileSync(process.env.MOCK_CODEX_PROMPT_FILE, prompt, "utf8");',
      'writeFileSync(process.env.MOCK_CODEX_ARGS_FILE, JSON.stringify(process.argv.slice(2)), "utf8");',
      "",
      'if (process.env.MOCK_CODEX_STDOUT_FILE && existsSync(process.env.MOCK_CODEX_STDOUT_FILE)) {',
      '  process.stdout.write(readFileSync(process.env.MOCK_CODEX_STDOUT_FILE, "utf8"));',
      "}",
      "",
      'if (process.env.MOCK_CODEX_STDERR_FILE && existsSync(process.env.MOCK_CODEX_STDERR_FILE)) {',
      '  process.stderr.write(readFileSync(process.env.MOCK_CODEX_STDERR_FILE, "utf8"));',
      "}",
      "",
      'process.exit(Number(process.env.MOCK_CODEX_EXIT_CODE ?? "0"));',
      "",
    ].join("\n"),
    "utf8",
  );
}

function configureMockCodex(options: {
  readonly stdoutLines: ReadonlyArray<unknown>;
  readonly stderrText?: string;
  readonly exitCode?: number;
}): void {
  writeFileSync(
    stdoutFile,
    `${options.stdoutLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  writeFileSync(stderrFile, options.stderrText ?? "", "utf8");
  writeFileSync(argsFile, "", "utf8");
  writeFileSync(promptFile, "", "utf8");
  process.env.MOCK_CODEX_EXIT_CODE = String(options.exitCode ?? 0);
}

beforeEach(() => {
  resetCounters();

  mockDir = mkdtempSync(join(tmpdir(), "conclave-codex-test-"));
  stdoutFile = join(mockDir, "stdout.ndjson");
  stderrFile = join(mockDir, "stderr.txt");
  argsFile = join(mockDir, "args.json");
  promptFile = join(mockDir, "prompt.txt");

  writeMockCodexFiles();

  originalPath = process.env.PATH;
  originalWindowsPath = process.env.Path;
  originalStdoutFile = process.env.MOCK_CODEX_STDOUT_FILE;
  originalStderrFile = process.env.MOCK_CODEX_STDERR_FILE;
  originalArgsFile = process.env.MOCK_CODEX_ARGS_FILE;
  originalPromptFile = process.env.MOCK_CODEX_PROMPT_FILE;
  originalExitCode = process.env.MOCK_CODEX_EXIT_CODE;

  process.env.PATH = `${mockDir};${process.env.PATH ?? process.env.Path ?? ""}`;
  process.env.Path = process.env.PATH;
  process.env.MOCK_CODEX_STDOUT_FILE = stdoutFile;
  process.env.MOCK_CODEX_STDERR_FILE = stderrFile;
  process.env.MOCK_CODEX_ARGS_FILE = argsFile;
  process.env.MOCK_CODEX_PROMPT_FILE = promptFile;
});

afterEach(() => {
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }

  if (originalWindowsPath === undefined) {
    delete process.env.Path;
  } else {
    process.env.Path = originalWindowsPath;
  }

  if (originalStdoutFile === undefined) {
    delete process.env.MOCK_CODEX_STDOUT_FILE;
  } else {
    process.env.MOCK_CODEX_STDOUT_FILE = originalStdoutFile;
  }

  if (originalStderrFile === undefined) {
    delete process.env.MOCK_CODEX_STDERR_FILE;
  } else {
    process.env.MOCK_CODEX_STDERR_FILE = originalStderrFile;
  }

  if (originalArgsFile === undefined) {
    delete process.env.MOCK_CODEX_ARGS_FILE;
  } else {
    process.env.MOCK_CODEX_ARGS_FILE = originalArgsFile;
  }

  if (originalPromptFile === undefined) {
    delete process.env.MOCK_CODEX_PROMPT_FILE;
  } else {
    process.env.MOCK_CODEX_PROMPT_FILE = originalPromptFile;
  }

  if (originalExitCode === undefined) {
    delete process.env.MOCK_CODEX_EXIT_CODE;
  } else {
    process.env.MOCK_CODEX_EXIT_CODE = originalExitCode;
  }

  rmSync(mockDir, { recursive: true, force: true });
});

describe("createOpenAICodexAdapter", () => {
  test("uses read-only sandbox and omits search when the role is read-only", async () => {
    configureMockCodex({
      stdoutLines: [
        { type: "thread.started", thread_id: "thread-reviewer" },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            id: "msg-1",
            text: "Review complete.",
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cached_input_tokens: 0,
          },
        },
      ],
    });

    const adapter = await Effect.runPromise(createOpenAICodexAdapter());
    const agentId = makeAgentId("reviewer");

    await Effect.runPromise(
      adapter.startSession(
        agentId,
        codexConfig({
          role: "reviewer",
          allowedTools: ["Read", "Glob", "Grep", "Bash"],
        }),
      ),
    );

    await Effect.runPromise(adapter.sendMessage(agentId, "Review this change", null));

    const spawnArgs = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    const promptText = readFileSync(promptFile, "utf8");

    expect(spawnArgs).toContain("read-only");
    expect(spawnArgs).not.toContain("--search");
    expect(promptText).toContain("Do not modify files. Read-only analysis only.");
  });

  test("accumulates multiple agent message chunks into the returned output", async () => {
    configureMockCodex({
      stdoutLines: [
        { type: "thread.started", thread_id: "thread-dev" },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            id: "msg-1",
            text: "First chunk.",
          },
        },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            id: "msg-2",
            text: "Second chunk.",
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            cached_input_tokens: 2,
          },
        },
      ],
    });

    const adapter = await Effect.runPromise(createOpenAICodexAdapter());
    const agentId = makeAgentId("developer");

    await Effect.runPromise(adapter.startSession(agentId, codexConfig()));
    const output = await Effect.runPromise(
      adapter.sendMessage(agentId, "Implement the feature", null),
    );
    const session = await Effect.runPromise(adapter.getSession(agentId));
    const spawnArgs = JSON.parse(readFileSync(argsFile, "utf8")) as string[];

    expect(output).toBe("First chunk.\n\nSecond chunk.");
    expect(spawnArgs).toContain("workspace-write");
    expect(spawnArgs).toContain("never");
    expect(spawnArgs).not.toContain("--full-auto");
    expect(session?.sessionId).toBe("thread-dev");
    expect(session?.turnCount).toBe(1);
  });

});
