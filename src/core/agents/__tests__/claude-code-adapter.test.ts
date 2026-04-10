import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { createClaudeCodeAdapter } from "../claude-code-adapter";
import {
  makeAgentId,
  makeAgentRoleConfig,
  resetCounters,
} from "@/test-utils/factories";
import type { AgentRoleConfig } from "@/shared/types/agent-runtime";

function claudeConfig(
  overrides: Partial<AgentRoleConfig> = {},
): AgentRoleConfig {
  return makeAgentRoleConfig({
    model: "claude-sonnet-4-6" as AgentRoleConfig["model"],
    workingDirectory: mockDir,
    ...overrides,
  });
}

let mockDir = "";
let stdoutFile = "";
let stderrFile = "";
let argsFile = "";
let promptFile = "";
let originalStdoutFile: string | undefined;
let originalStderrFile: string | undefined;
let originalArgsFile: string | undefined;
let originalPromptFile: string | undefined;
let originalExitCode: string | undefined;
let originalPath: string | undefined;
let originalWindowsPath: string | undefined;

function writeMockClaudeFiles(): void {
  const bunExecutable = process.execPath.split("/").join("\\");

  writeFileSync(
    join(mockDir, "custom-claude.cmd"),
    `@echo off\r\n"${bunExecutable}" "%~dp0claude-mock.js" %*\r\n`,
    "utf8",
  );

  writeFileSync(
    join(mockDir, "claude-mock.js"),
    [
      'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
      "",
      'const prompt = await new Response(Bun.stdin.stream()).text();',
      'writeFileSync(process.env.MOCK_CLAUDE_PROMPT_FILE, prompt, "utf8");',
      'writeFileSync(process.env.MOCK_CLAUDE_ARGS_FILE, JSON.stringify(process.argv.slice(2)), "utf8");',
      "",
      'if (process.env.MOCK_CLAUDE_STDOUT_FILE && existsSync(process.env.MOCK_CLAUDE_STDOUT_FILE)) {',
      '  process.stdout.write(readFileSync(process.env.MOCK_CLAUDE_STDOUT_FILE, "utf8"));',
      "}",
      "",
      'if (process.env.MOCK_CLAUDE_STDERR_FILE && existsSync(process.env.MOCK_CLAUDE_STDERR_FILE)) {',
      '  process.stderr.write(readFileSync(process.env.MOCK_CLAUDE_STDERR_FILE, "utf8"));',
      "}",
      "",
      'process.exit(Number(process.env.MOCK_CLAUDE_EXIT_CODE ?? "0"));',
      "",
    ].join("\n"),
    "utf8",
  );
}

function configureMockClaude(options: {
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
  process.env.MOCK_CLAUDE_EXIT_CODE = String(options.exitCode ?? 0);
}

beforeEach(() => {
  resetCounters();

  mockDir = mkdtempSync(join(tmpdir(), "conclave-claude-test-"));
  stdoutFile = join(mockDir, "stdout.ndjson");
  stderrFile = join(mockDir, "stderr.txt");
  argsFile = join(mockDir, "args.json");
  promptFile = join(mockDir, "prompt.txt");

  writeMockClaudeFiles();

  originalStdoutFile = process.env.MOCK_CLAUDE_STDOUT_FILE;
  originalStderrFile = process.env.MOCK_CLAUDE_STDERR_FILE;
  originalArgsFile = process.env.MOCK_CLAUDE_ARGS_FILE;
  originalPromptFile = process.env.MOCK_CLAUDE_PROMPT_FILE;
  originalExitCode = process.env.MOCK_CLAUDE_EXIT_CODE;
  originalPath = process.env.PATH;
  originalWindowsPath = process.env.Path;

  process.env.MOCK_CLAUDE_STDOUT_FILE = stdoutFile;
  process.env.MOCK_CLAUDE_STDERR_FILE = stderrFile;
  process.env.MOCK_CLAUDE_ARGS_FILE = argsFile;
  process.env.MOCK_CLAUDE_PROMPT_FILE = promptFile;
});

afterEach(() => {
  if (originalStdoutFile === undefined) {
    delete process.env.MOCK_CLAUDE_STDOUT_FILE;
  } else {
    process.env.MOCK_CLAUDE_STDOUT_FILE = originalStdoutFile;
  }

  if (originalStderrFile === undefined) {
    delete process.env.MOCK_CLAUDE_STDERR_FILE;
  } else {
    process.env.MOCK_CLAUDE_STDERR_FILE = originalStderrFile;
  }

  if (originalArgsFile === undefined) {
    delete process.env.MOCK_CLAUDE_ARGS_FILE;
  } else {
    process.env.MOCK_CLAUDE_ARGS_FILE = originalArgsFile;
  }

  if (originalPromptFile === undefined) {
    delete process.env.MOCK_CLAUDE_PROMPT_FILE;
  } else {
    process.env.MOCK_CLAUDE_PROMPT_FILE = originalPromptFile;
  }

  if (originalExitCode === undefined) {
    delete process.env.MOCK_CLAUDE_EXIT_CODE;
  } else {
    process.env.MOCK_CLAUDE_EXIT_CODE = originalExitCode;
  }

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

  rmSync(mockDir, { recursive: true, force: true });
});

describe("createClaudeCodeAdapter", () => {
  test("launches the resolved binary path instead of a hardcoded claude command", async () => {
    configureMockClaude({
      stdoutLines: [
        { type: "system", subtype: "init", session_id: "session-custom" },
        {
          type: "assistant",
          session_id: "session-custom",
          message: {
            model: "claude-sonnet-4-6",
            usage: {
              input_tokens: 4,
              output_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
            content: [
              {
                type: "text",
                text: "Streaming chunk.",
              },
            ],
          },
        },
        {
          type: "result",
          session_id: "session-custom",
          is_error: false,
          result: "Completed via custom Claude.",
          duration_ms: 50,
          num_turns: 1,
          total_cost_usd: 0,
          usage: {
            input_tokens: 4,
            output_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      ],
    });

    process.env.PATH = "";
    process.env.Path = "";

    const adapter = await Effect.runPromise(
      createClaudeCodeAdapter({
        resolveBinaryPath: async () => ({
          adapterType: "claude-code",
          command: "claude",
          manualPath: join(mockDir, "custom-claude.cmd"),
          resolvedPath: join(mockDir, "custom-claude.cmd"),
          source: "manual",
          errorCode: null,
          errorMessage: null,
        }),
      }),
    );
    const agentId = makeAgentId("developer");

    await Effect.runPromise(adapter.startSession(agentId, claudeConfig()));
    const output = await Effect.runPromise(
      adapter.sendMessage(agentId, "Use the resolved binary", null),
    );
    const spawnArgs = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    const promptText = readFileSync(promptFile, "utf8");

    expect(output).toBe("Completed via custom Claude.");
    expect(spawnArgs).toContain("--print");
    expect(promptText).toContain("Use the resolved binary");
  });
});
