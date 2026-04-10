import type { SerializedAppSettings } from "@/shared/rpc/rpc-schema";
import {
  ADAPTER_TYPES,
  type AdapterBinaryResolution,
  type AdapterType,
  type AppSettings,
} from "@/shared/types/adapter";

type SerializeAppSettingsOptions = {
  readonly appSettings: AppSettings;
  readonly settingsFilePath: string;
  readonly resolveAdapterBinaryPath: (
    adapterType: AdapterType,
    manualPath: string | null,
  ) => Promise<AdapterBinaryResolution>;
};

export async function serializeAppSettings({
  appSettings,
  settingsFilePath,
  resolveAdapterBinaryPath,
}: SerializeAppSettingsOptions): Promise<SerializedAppSettings> {
  const adapterResolutions = {} as Record<
    AdapterType,
    AdapterBinaryResolution
  >;

  for (const adapterType of ADAPTER_TYPES) {
    adapterResolutions[adapterType] = await resolveAdapterBinaryPath(
      adapterType,
      appSettings.adapterBinaryPaths[adapterType],
    );
  }

  return {
    selectedAdapter: appSettings.selectedAdapter,
    selectedModels: { ...appSettings.selectedModels },
    adapterBinaryPaths: { ...appSettings.adapterBinaryPaths },
    settingsFilePath,
    adapterResolutions,
  };
}
