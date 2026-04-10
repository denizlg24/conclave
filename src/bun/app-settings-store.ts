import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  ADAPTER_TYPES,
  createDefaultAppSettings,
  isAdapterModel,
  isAdapterType,
  type AdapterBinaryPathOverrides,
  type AdapterModelSelections,
  type AppSettings,
  type AppSettingsPatch,
} from "@/shared/types/adapter";

type AppSettingsStoreOptions = {
  readonly settingsFilePath: string;
};

export interface AppSettingsStoreShape {
  readonly get: () => Promise<AppSettings>;
  readonly update: (patch: AppSettingsPatch) => Promise<AppSettings>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeBinaryPath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function sanitizeSelectedModels(value: unknown): AdapterModelSelections {
  const defaults = createDefaultAppSettings().selectedModels;
  const selectedModels = { ...defaults };
  const record = asRecord(value);

  if (!record) {
    return selectedModels;
  }

  for (const adapterType of ADAPTER_TYPES) {
    const candidate = record[adapterType];
    if (typeof candidate === "string" && isAdapterModel(adapterType, candidate)) {
      selectedModels[adapterType] = candidate;
    }
  }

  return selectedModels;
}

function sanitizeAdapterBinaryPaths(value: unknown): AdapterBinaryPathOverrides {
  const defaults = createDefaultAppSettings().adapterBinaryPaths;
  const binaryPaths = { ...defaults };
  const record = asRecord(value);

  if (!record) {
    return binaryPaths;
  }

  for (const adapterType of ADAPTER_TYPES) {
    binaryPaths[adapterType] = normalizeBinaryPath(record[adapterType]);
  }

  return binaryPaths;
}

export function sanitizeAppSettings(value: unknown): AppSettings {
  const defaults = createDefaultAppSettings();
  const record = asRecord(value);

  if (!record) {
    return defaults;
  }

  return {
    selectedAdapter:
      typeof record.selectedAdapter === "string" &&
      isAdapterType(record.selectedAdapter)
      ? record.selectedAdapter
      : defaults.selectedAdapter,
    selectedModels: sanitizeSelectedModels(record.selectedModels),
    adapterBinaryPaths: sanitizeAdapterBinaryPaths(record.adapterBinaryPaths),
  };
}

async function readSettingsFile(settingsFilePath: string): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsFilePath, "utf8");
    return sanitizeAppSettings(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultAppSettings();
    }
    throw error;
  }
}

async function writeSettingsFile(
  settingsFilePath: string,
  settings: AppSettings,
): Promise<void> {
  await mkdir(dirname(settingsFilePath), { recursive: true });
  await writeFile(settingsFilePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function validatePatch(patch: AppSettingsPatch): void {
  if (patch.selectedAdapter !== undefined && !isAdapterType(patch.selectedAdapter)) {
    throw new Error(`Unsupported adapter '${patch.selectedAdapter}'`);
  }

  if (patch.selectedModels) {
    for (const [adapterType, model] of Object.entries(patch.selectedModels)) {
      if (!isAdapterType(adapterType) || typeof model !== "string") {
        throw new Error(`Unsupported model update for adapter '${adapterType}'`);
      }
      if (!isAdapterModel(adapterType, model)) {
        throw new Error(`Unsupported model '${model}' for adapter '${adapterType}'`);
      }
    }
  }

  if (patch.adapterBinaryPaths) {
    for (const adapterType of Object.keys(patch.adapterBinaryPaths)) {
      if (!isAdapterType(adapterType)) {
        throw new Error(`Unsupported adapter binary override '${adapterType}'`);
      }
    }
  }
}

export function createAppSettingsStore({
  settingsFilePath,
}: AppSettingsStoreOptions): AppSettingsStoreShape {
  const get: AppSettingsStoreShape["get"] = () => readSettingsFile(settingsFilePath);

  const update: AppSettingsStoreShape["update"] = async (patch) => {
    validatePatch(patch);

    const currentSettings = await get();
    const nextBinaryPaths: AdapterBinaryPathOverrides = {
      ...currentSettings.adapterBinaryPaths,
    };

    if (patch.adapterBinaryPaths) {
      for (const adapterType of ADAPTER_TYPES) {
        if (
          Object.prototype.hasOwnProperty.call(
            patch.adapterBinaryPaths,
            adapterType,
          )
        ) {
          nextBinaryPaths[adapterType] = normalizeBinaryPath(
            patch.adapterBinaryPaths[adapterType],
          );
        }
      }
    }

    const nextSettings: AppSettings = {
      selectedAdapter: patch.selectedAdapter ?? currentSettings.selectedAdapter,
      selectedModels: {
        ...currentSettings.selectedModels,
        ...patch.selectedModels,
      },
      adapterBinaryPaths: nextBinaryPaths,
    };

    await writeSettingsFile(settingsFilePath, nextSettings);
    return nextSettings;
  };

  return {
    get,
    update,
  };
}
