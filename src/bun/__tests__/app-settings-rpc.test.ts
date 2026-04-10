import { describe, expect, test } from "bun:test";

import { serializeAppSettings } from "../app-settings-rpc";

describe("serializeAppSettings", () => {
  test("includes settings metadata and per-adapter binary resolutions", async () => {
    const result = await serializeAppSettings({
      appSettings: {
        selectedAdapter: "openai-codex",
        selectedModels: {
          "claude-code": "claude-sonnet-4-6",
          "openai-codex": "gpt-5.4",
        },
        adapterBinaryPaths: {
          "claude-code": "C:/tools/claude.exe",
          "openai-codex": null,
        },
      },
      settingsFilePath: "C:/Users/test/AppData/Local/Conclave/settings.json",
      resolveAdapterBinaryPath: async (adapterType, manualPath) => ({
        adapterType,
        command: adapterType === "claude-code" ? "claude" : "codex",
        manualPath,
        resolvedPath:
          adapterType === "claude-code"
            ? "C:/tools/claude.exe"
            : "C:/Program Files/Codex/codex.exe",
        source: adapterType === "claude-code" ? "manual" : "detected",
        errorCode: null,
        errorMessage: null,
      }),
    });

    expect(result.settingsFilePath).toBe(
      "C:/Users/test/AppData/Local/Conclave/settings.json",
    );
    expect(result.adapterResolutions["claude-code"]).toEqual({
      adapterType: "claude-code",
      command: "claude",
      manualPath: "C:/tools/claude.exe",
      resolvedPath: "C:/tools/claude.exe",
      source: "manual",
      errorCode: null,
      errorMessage: null,
    });
    expect(result.adapterResolutions["openai-codex"]).toEqual({
      adapterType: "openai-codex",
      command: "codex",
      manualPath: null,
      resolvedPath: "C:/Program Files/Codex/codex.exe",
      source: "detected",
      errorCode: null,
      errorMessage: null,
    });
  });
});
