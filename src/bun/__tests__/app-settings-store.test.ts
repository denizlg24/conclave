import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAppSettingsStore,
  sanitizeAppSettings,
} from "../app-settings-store";

const tempDirectories: string[] = [];

function createTempSettingsPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "conclave-settings-store-"));
  tempDirectories.push(directory);
  return join(directory, "settings.json");
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("createAppSettingsStore", () => {
  test("returns defaults when no settings file exists", async () => {
    const store = createAppSettingsStore({
      settingsFilePath: createTempSettingsPath(),
    });

    const settings = await store.get();

    expect(settings.selectedAdapter).toBe("claude-code");
    expect(settings.selectedModels["claude-code"]).toBe("claude-sonnet-4-6");
    expect(settings.selectedModels["openai-codex"]).toBe("gpt-5.4");
    expect(settings.adapterBinaryPaths["claude-code"]).toBeNull();
    expect(settings.adapterBinaryPaths["openai-codex"]).toBeNull();
  });

  test("persists updates across store instances", async () => {
    const settingsFilePath = createTempSettingsPath();
    const store = createAppSettingsStore({ settingsFilePath });

    const updatedSettings = await store.update({
      selectedAdapter: "openai-codex",
      selectedModels: {
        "openai-codex": "gpt-5.3-codex",
      },
      adapterBinaryPaths: {
        "claude-code": "  C:\\Tools\\claude.cmd  ",
        "openai-codex": "",
      },
    });

    expect(updatedSettings.selectedAdapter).toBe("openai-codex");
    expect(updatedSettings.selectedModels["openai-codex"]).toBe("gpt-5.3-codex");
    expect(updatedSettings.adapterBinaryPaths["claude-code"]).toBe("C:\\Tools\\claude.cmd");
    expect(updatedSettings.adapterBinaryPaths["openai-codex"]).toBeNull();

    const reloadedStore = createAppSettingsStore({ settingsFilePath });
    const reloadedSettings = await reloadedStore.get();
    const persistedFile = JSON.parse(await readFile(settingsFilePath, "utf8")) as {
      adapterBinaryPaths: Record<string, string | null>;
    };

    expect(reloadedSettings).toEqual(updatedSettings);
    expect(persistedFile.adapterBinaryPaths["claude-code"]).toBe("C:\\Tools\\claude.cmd");
    expect(persistedFile.adapterBinaryPaths["openai-codex"]).toBeNull();
  });
});

describe("sanitizeAppSettings", () => {
  test("accepts every newly cataloged model value", () => {
    const settings = sanitizeAppSettings({
      selectedAdapter: "openai-codex",
      selectedModels: {
        "claude-code": "claude-haiku-4-5",
        "openai-codex": "gpt-5.2-codex",
      },
      adapterBinaryPaths: {},
    });

    expect(settings.selectedModels["claude-code"]).toBe("claude-haiku-4-5");
    expect(settings.selectedModels["openai-codex"]).toBe("gpt-5.2-codex");

    const additionalOpenAiModels = [
      "gpt-5.4-mini",
      "gpt-5.3",
      "gpt-5.3-codex-spark",
      "gpt-5.2",
    ] as const;

    for (const model of additionalOpenAiModels) {
      const nextSettings = sanitizeAppSettings({
        selectedAdapter: "openai-codex",
        selectedModels: {
          "claude-code": "claude-sonnet-4-6",
          "openai-codex": model,
        },
        adapterBinaryPaths: {},
      });

      expect(nextSettings.selectedModels["openai-codex"]).toBe(model);
    }
  });

  test("drops invalid adapter values and models from persisted data", async () => {
    const settingsFilePath = createTempSettingsPath();

    await writeFile(
      settingsFilePath,
      JSON.stringify({
        selectedAdapter: "not-real",
        selectedModels: {
          "claude-code": "invalid-model",
          "openai-codex": "gpt-5.3-codex",
        },
        adapterBinaryPaths: {
          "claude-code": "  ",
          "openai-codex": "codex.cmd",
        },
      }),
      "utf8",
    );

    const sanitized = sanitizeAppSettings(
      JSON.parse(await readFile(settingsFilePath, "utf8")),
    );

    expect(sanitized.selectedAdapter).toBe("claude-code");
    expect(sanitized.selectedModels["claude-code"]).toBe("claude-sonnet-4-6");
    expect(sanitized.selectedModels["openai-codex"]).toBe("gpt-5.3-codex");
    expect(sanitized.adapterBinaryPaths["claude-code"]).toBeNull();
    expect(sanitized.adapterBinaryPaths["openai-codex"]).toBe("codex.cmd");
  });
});
