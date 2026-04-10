import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defaultCommandForAdapterBinary,
  resolveAdapterBinaryPath,
} from "../binary-path";

const tempDirectories: string[] = [];

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("defaultCommandForAdapterBinary", () => {
  test("returns the expected command names", () => {
    expect(defaultCommandForAdapterBinary("claude-code")).toBe("claude");
    expect(defaultCommandForAdapterBinary("openai-codex")).toBe("codex");
  });
});

describe("resolveAdapterBinaryPath", () => {
  test("prefers a manual override when the file exists", async () => {
    const directory = createTempDirectory("conclave-binary-path-manual-");
    const manualBinaryPath = join(directory, "claude.cmd");
    writeFileSync(manualBinaryPath, "@echo off\r\n", "utf8");

    const resolution = await resolveAdapterBinaryPath({
      adapterType: "claude-code",
      manualPath: manualBinaryPath,
      platform: "win32",
      env: { PATH: "" },
    });

    expect(resolution.source).toBe("manual");
    expect(resolution.resolvedPath).toBe(manualBinaryPath);
    expect(resolution.errorCode).toBeNull();
  });

  test("returns a structured error when the manual override does not exist", async () => {
    const resolution = await resolveAdapterBinaryPath({
      adapterType: "openai-codex",
      manualPath: "C:\\Missing\\codex.cmd",
      platform: "win32",
      env: { PATH: "" },
    });

    expect(resolution.source).toBeNull();
    expect(resolution.resolvedPath).toBeNull();
    expect(resolution.errorCode).toBe("manual_override_not_found");
  });

  test("detects binaries on PATH when no manual override is configured", async () => {
    const directory = createTempDirectory("conclave-binary-path-detect-");
    const detectedBinaryPath = join(directory, "codex.cmd");
    writeFileSync(detectedBinaryPath, "@echo off\r\n", "utf8");

    const resolution = await resolveAdapterBinaryPath({
      adapterType: "openai-codex",
      manualPath: null,
      platform: "win32",
      env: { PATH: directory, PATHEXT: ".CMD;.EXE" },
    });

    expect(resolution.source).toBe("detected");
    expect(resolution.resolvedPath).toBe(detectedBinaryPath);
    expect(resolution.errorCode).toBeNull();
  });

  test("returns a not-found error when detection fails", async () => {
    const resolution = await resolveAdapterBinaryPath({
      adapterType: "claude-code",
      manualPath: null,
      platform: "win32",
      env: { PATH: "" },
    });

    expect(resolution.source).toBeNull();
    expect(resolution.resolvedPath).toBeNull();
    expect(resolution.errorCode).toBe("binary_not_found");
    expect(resolution.errorMessage).toContain("claude");
  });
});
