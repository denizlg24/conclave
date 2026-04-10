import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Electroview } from "electrobun/view";
import {
  ADAPTER_TYPES,
  ADAPTER_OPTIONS,
  DEFAULT_ADAPTER_TYPE,
  createDefaultAdapterBinaryPathOverrides,
  createDefaultAdapterModelSelections,
  defaultModelForAdapter,
  type AdapterConnectionTestResult,
  type AdapterBinaryResolution,
  type AdapterModelSelections,
  type AdapterType,
  type AppSettingsPatch,
} from "../../shared/types/adapter";
import type {
  ConclaveRPCSchema,
  SerializedAdapterConnectionTestResult,
  SerializedAdapterOption,
  SerializedAdapterState,
  SerializedAgentEvent,
  SerializedAgentInfo,
  SerializedAgentRoster,
  SerializedDebugConsoleEntry,
  SerializedEvent,
  SerializedProject,
  SerializedReadModel,
  SerializedAppSettings,
  SerializedSuspendedTask,
} from "../../shared/rpc/rpc-schema";
import {
  appendDebugConsoleEntry,
  createDebugConsoleEntry,
  mergeDebugConsoleEntries,
} from "../../shared/utils/debug-console";

type QuotaExhaustedInfo = {
  agentId: string;
  taskId: string;
  adapterType: string;
  rawMessage: string;
  occurredAt: string;
};

export interface ConclaveConnectionStatus {
  state: "unknown" | "connected" | "failed" | "not_configured";
  message: string | null;
  checkedAt: string | null;
}

export interface ConclaveAppSettings {
  provider: AdapterType;
  model: string;
  manualBinaryPath: string | null;
  detectedBinaryPath: string | null;
  appSettingsPath: string | null;
  connectionStatus: ConclaveConnectionStatus;
}

export interface ConclaveAppSettingsUpdate {
  provider: AdapterType;
  model: string;
  manualBinaryPath: string | null;
}

interface ConclaveState {
  activeProject: SerializedProject | null;
  selectedAdapter: AdapterType;
  availableAdapters: SerializedAdapterOption[];
  selectedModels: AdapterModelSelections;
  appSettings: ConclaveAppSettings | null;
  appSettingsLoading: boolean;
  appSettingsError: string | null;
  appSettingsLastTest: SerializedAdapterConnectionTestResult | null;
  appSettingsLastTestAt: string | null;
  readModel: SerializedReadModel | null;
  events: SerializedEvent[];
  agentEvents: SerializedAgentEvent[];
  agentRoster: SerializedAgentInfo[];
  projects: SerializedProject[];
  suspendedTasks: SerializedSuspendedTask[];
  debugConsoleEntries: SerializedDebugConsoleEntry[];
  quotaExhaustedInfo: QuotaExhaustedInfo | null;
  connected: boolean;
}

interface ConclaveActions {
  listProjects: () => Promise<SerializedProject[]>;
  createProject: (name: string, description: string, path: string) => Promise<SerializedProject>;
  openDirectory: (path: string) => Promise<SerializedProject>;
  browseForDirectory: () => Promise<string | null>;
  loadProject: (projectId: string) => Promise<void>;
  refreshAppSettings: () => Promise<ConclaveAppSettings>;
  updateAppSettings: (
    params: ConclaveAppSettingsUpdate,
  ) => Promise<ConclaveAppSettings>;
  testAdapterConnection: (
    params: ConclaveAppSettingsUpdate,
  ) => Promise<ConclaveConnectionStatus>;
  setSelectedAdapter: (adapterType: AdapterType) => Promise<void>;
  setAdapterModel: (adapterType: AdapterType, model: string) => Promise<void>;
  sendCommand: (message: string) => Promise<{ taskId: string; meetingId: string }>;
  createTask: (params: {
    taskType: string;
    title: string;
    description: string;
    deps: string[];
  }) => Promise<{ taskId: string }>;
  updateTaskStatus: (params: {
    taskId: string;
    status: string;
    reason?: string;
  }) => Promise<void>;
  approveProposedTasks: (params: {
    meetingId: string;
    approvedTaskIds: string[];
    rejectedTaskIds: string[];
  }) => Promise<void>;
  scheduleMeeting: (params: {
    meetingType: string;
    agenda: string[];
    participants: string[];
  }) => Promise<{ meetingId: string }>;
  getSuspendedTasks: () => Promise<SerializedSuspendedTask[]>;
  resumeSuspendedTask: (taskId: string) => Promise<void>;
  dismissQuotaExhausted: () => void;
  refresh: () => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  unloadProject: () => Promise<void>;
}

type ConclaveContextValue = ConclaveState & ConclaveActions;

const ConclaveContext = createContext<ConclaveContextValue | null>(null);

interface RPCClient {
  listProjects: (params: Record<string, never>) => Promise<SerializedProject[]>;
  createProject: (params: { name: string; description: string; path: string }) => Promise<SerializedProject>;
  openDirectory: (params: { path: string }) => Promise<SerializedProject>;
  browseForDirectory: (params: Record<string, never>) => Promise<string | null>;
  loadProject: (params: { projectId: string }) => Promise<{ success: boolean }>;
  getActiveProject: (params: Record<string, never>) => Promise<SerializedProject | null>;
  getAdapterState: (params: Record<string, never>) => Promise<SerializedAdapterState>;
  getAppSettings: (params: Record<string, never>) => Promise<SerializedAppSettings>;
  updateAppSettings: (params: AppSettingsPatch) => Promise<SerializedAppSettings>;
  testAdapterConnection: (
    params: { adapterType: AdapterType },
  ) => Promise<AdapterConnectionTestResult>;
  setAdapter: (params: { adapterType: AdapterType }) => Promise<SerializedAdapterState>;
  setAdapterModel: (params: {
    adapterType: AdapterType;
    model: string;
  }) => Promise<SerializedAdapterState>;
  getDebugConsoleEntries: (
    params: Record<string, never>,
  ) => Promise<SerializedDebugConsoleEntry[]>;
  getAgentRoster: (params: Record<string, never>) => Promise<SerializedAgentRoster>;
  sendCommand: (params: { message: string }) => Promise<{ taskId: string; meetingId: string }>;
  getState: (params: Record<string, never>) => Promise<SerializedReadModel>;
  getEvents: (params: { fromSequence: number }) => Promise<SerializedEvent[]>;
  createTask: (params: {
    taskType: string;
    title: string;
    description: string;
    deps: string[];
  }) => Promise<{ taskId: string }>;
  updateTaskStatus: (params: {
    taskId: string;
    status: string;
    reason?: string;
  }) => Promise<{ success: boolean }>;
  approveProposedTasks: (params: {
    meetingId: string;
    approvedTaskIds: string[];
    rejectedTaskIds: string[];
  }) => Promise<{ success: boolean }>;
  scheduleMeeting: (params: {
    meetingType: string;
    agenda: string[];
    participants: string[];
  }) => Promise<{ meetingId: string }>;
  getSuspendedTasks: (params: Record<string, never>) => Promise<SerializedSuspendedTask[]>;
  resumeSuspendedTask: (params: { taskId: string }) => Promise<{ success: boolean }>;
  deleteProject: (params: { projectId: string }) => Promise<{ success: boolean }>;
  unloadProject: (params: Record<string, never>) => Promise<{ success: boolean }>;
}

interface AppSettingsRPCClient {
  getAppSettings: (params: Record<string, never>) => Promise<SerializedAppSettings>;
  updateAppSettings: (params: AppSettingsPatch) => Promise<SerializedAppSettings>;
  testAdapterConnection: (
    params: { adapterType: AdapterType },
  ) => Promise<AdapterConnectionTestResult>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createConnectionStatus(
  testResult: SerializedAdapterConnectionTestResult | null,
  checkedAt: string | null,
  resolution: AdapterBinaryResolution | null,
): ConclaveConnectionStatus {
  if (!testResult) {
    if (resolution?.errorCode) {
      return {
        state: "not_configured",
        message:
          resolution.errorMessage ??
          "Adapter binary could not be resolved from the current settings.",
        checkedAt: null,
      };
    }

    return {
      state: "unknown",
      message: resolution?.resolvedPath
        ? "Binary resolved. Run a connection test to validate launch and credentials."
        : "Run a connection test to validate the active adapter binary.",
      checkedAt: null,
    };
  }

  if (testResult.ok) {
    return {
      state: "connected",
      message: testResult.message,
      checkedAt,
    };
  }

  if (testResult.resolution.errorCode) {
    return {
      state: "not_configured",
      message: testResult.message,
      checkedAt,
    };
  }

  return {
    state: "failed",
    message: testResult.message,
    checkedAt,
  };
}

function createFallbackAppSettingsState(
  adapterState: SerializedAdapterState,
): SerializedAppSettings {
  const adapterResolutions = {} as Record<AdapterType, AdapterBinaryResolution>;

  for (const adapterType of ADAPTER_TYPES) {
    adapterResolutions[adapterType] = {
      adapterType,
      command: adapterType,
      manualPath: null,
      resolvedPath: null,
      source: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  return {
    selectedAdapter: adapterState.selectedAdapter,
    selectedModels: { ...adapterState.selectedModels },
    adapterBinaryPaths: createDefaultAdapterBinaryPathOverrides(),
    settingsFilePath: null,
    adapterResolutions,
  };
}

function createConclaveAppSettings(
  appSettings: SerializedAppSettings,
  testResult: SerializedAdapterConnectionTestResult | null,
  checkedAt: string | null,
): ConclaveAppSettings {
  const provider = appSettings.selectedAdapter;
  const relevantTestResult =
    testResult?.adapterType === provider ? testResult : null;
  const providerResolution = appSettings.adapterResolutions[provider] ?? null;
  const selectedModel =
    appSettings.selectedModels[provider] ?? defaultModelForAdapter(provider);

  return {
    provider,
    model: selectedModel,
    manualBinaryPath: appSettings.adapterBinaryPaths[provider] ?? null,
    detectedBinaryPath:
      relevantTestResult?.resolution.resolvedPath ??
      providerResolution?.resolvedPath ??
      null,
    appSettingsPath: appSettings.settingsFilePath,
    connectionStatus: createConnectionStatus(
      relevantTestResult,
      checkedAt,
      providerResolution,
    ),
  };
}

function resolveAppSettingsClient(client: RPCClient | null): AppSettingsRPCClient {
  if (!client) {
    throw new Error("Not connected");
  }
  if (
    typeof client.getAppSettings !== "function" ||
    typeof client.updateAppSettings !== "function" ||
    typeof client.testAdapterConnection !== "function"
  ) {
    throw new Error(
      "Settings RPC contract mismatch: expected getAppSettings, updateAppSettings, and testAdapterConnection.",
    );
  }

  return client;
}

export function ConclaveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConclaveState>({
    activeProject: null,
    selectedAdapter: DEFAULT_ADAPTER_TYPE,
    availableAdapters: [...ADAPTER_OPTIONS],
    selectedModels: createDefaultAdapterModelSelections(),
    appSettings: null,
    appSettingsLoading: true,
    appSettingsError: null,
    appSettingsLastTest: null,
    appSettingsLastTestAt: null,
    readModel: null,
    events: [],
    agentEvents: [],
    agentRoster: [],
    projects: [],
    suspendedTasks: [],
    debugConsoleEntries: [],
    quotaExhaustedInfo: null,
    connected: false,
  });

  const rpcClientRef = useRef<RPCClient | null>(null);

  const applyAppSettings = useCallback((appSettings: SerializedAppSettings) => {
    setState((prev) => ({
      ...prev,
      appSettings: createConclaveAppSettings(
        appSettings,
        prev.appSettingsLastTest,
        prev.appSettingsLastTestAt,
      ),
      appSettingsLoading: false,
      appSettingsError: null,
      selectedAdapter: appSettings.selectedAdapter,
      selectedModels: { ...appSettings.selectedModels },
    }));
  }, []);

  const applyAppSettingsFailure = useCallback(
    (
      error: unknown,
      fallbackSettings: SerializedAppSettings | null,
    ) => {
      setState((prev) => ({
        ...prev,
        appSettings:
          prev.appSettings ??
          (fallbackSettings
            ? createConclaveAppSettings(
                fallbackSettings,
                prev.appSettingsLastTest,
                prev.appSettingsLastTestAt,
              )
            : null),
        appSettingsLoading: false,
        appSettingsError: toErrorMessage(error),
      }));
    },
    [],
  );

  useEffect(() => {
    const rpc = Electroview.defineRPC<ConclaveRPCSchema>({
      maxRequestTime: 5 * 60 * 1000, // 5 minutes - file dialogs and operations can take a while
      handlers: {
        requests: {},
        messages: {
          onStateChanged: (model) => {
            setState((prev) => ({
              ...prev,
              readModel: model,
            }));
          },
          onEvent: (event) => {
            setState((prev) => ({
              ...prev,
              events: [...prev.events, event].slice(-500),
            }));
          },
          onProjectLoaded: () => {
          },
          onAgentEvent: (agentEvent) => {
            setState((prev) => ({
              ...prev,
              agentEvents: [...prev.agentEvents, agentEvent].slice(-5000),
            }));
          },
          onAgentRoster: (roster) => {
            setState((prev) => ({
              ...prev,
              agentRoster: roster.agents,
            }));
          },
          onDebugConsoleEntry: (entry) => {
            setState((prev) => ({
              ...prev,
              debugConsoleEntries: appendDebugConsoleEntry(
                prev.debugConsoleEntries,
                entry,
              ),
            }));
          },
          onQuotaExhausted: (info) => {
            setState((prev) => ({
              ...prev,
              quotaExhaustedInfo: info,
            }));
          },
        },
      },
    });

    new Electroview({ rpc });

    const client = rpc.proxy.request as RPCClient;
    rpcClientRef.current = client;

    const init = async (retries = 3, delayMs = 500) => {
      for (let i = 0; i < retries; i++) {
        try {
          const [activeProject, projects, adapterState, debugConsoleEntries] = await Promise.all([
            client.getActiveProject({} as Record<string, never>),
            client.listProjects({} as Record<string, never>),
            client.getAdapterState({} as Record<string, never>),
            client.getDebugConsoleEntries({} as Record<string, never>),
          ]);
          const fallbackAppSettings = createFallbackAppSettingsState(
            adapterState,
          );

          if (activeProject) {
            const [model, events, roster, suspendedTasks] = await Promise.all([
              client.getState({} as Record<string, never>),
              client.getEvents({ fromSequence: 0 }),
              client.getAgentRoster({} as Record<string, never>),
              client.getSuspendedTasks({} as Record<string, never>),
            ]);
            setState((prev) => ({
              ...prev,
              activeProject,
              selectedAdapter: adapterState.selectedAdapter,
              availableAdapters: adapterState.availableAdapters,
              selectedModels: adapterState.selectedModels,
              appSettings:
                prev.appSettings ??
                createConclaveAppSettings(
                  fallbackAppSettings,
                  prev.appSettingsLastTest,
                  prev.appSettingsLastTestAt,
                ),
              appSettingsLoading: true,
              appSettingsError: null,
              readModel: model,
              events,
              agentRoster: roster.agents,
              suspendedTasks,
              projects,
              debugConsoleEntries: mergeDebugConsoleEntries(
                prev.debugConsoleEntries,
                debugConsoleEntries,
              ),
              connected: true,
            }));
          } else {
            setState((prev) => ({
              ...prev,
              selectedAdapter: adapterState.selectedAdapter,
              availableAdapters: adapterState.availableAdapters,
              selectedModels: adapterState.selectedModels,
              appSettings:
                prev.appSettings ??
                createConclaveAppSettings(
                  fallbackAppSettings,
                  prev.appSettingsLastTest,
                  prev.appSettingsLastTestAt,
                ),
              appSettingsLoading: true,
              appSettingsError: null,
              projects,
              debugConsoleEntries: mergeDebugConsoleEntries(
                prev.debugConsoleEntries,
                debugConsoleEntries,
              ),
              connected: true,
            }));
          }

          if (typeof client.getAppSettings === "function") {
            void client
              .getAppSettings({} as Record<string, never>)
              .then((appSettings) => {
                applyAppSettings(appSettings);
              })
              .catch((error) => {
                applyAppSettingsFailure(error, fallbackAppSettings);
              });
          } else {
            applyAppSettingsFailure(
              new Error(
                "Settings RPC contract mismatch: expected getAppSettings on the desktop bridge.",
              ),
              fallbackAppSettings,
            );
          }
          return;
        } catch {
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
      setState((prev) => ({
        ...prev,
        connected: true,
        appSettingsLoading: false,
        appSettingsError: "Failed to initialize the Conclave desktop bridge.",
      }));
    };
    init();
  }, [applyAppSettings, applyAppSettingsFailure]);

  useEffect(() => {
    const originals = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: (console.debug ?? console.log).bind(console),
    };

    (["log", "info", "warn", "error", "debug"] as const).forEach((level) => {
      console[level] = (...args: unknown[]) => {
        originals[level](...args);
        const entry = createDebugConsoleEntry({
          source: "webview",
          level,
          args,
        });
        setState((prev) => ({
          ...prev,
          debugConsoleEntries: appendDebugConsoleEntry(
            prev.debugConsoleEntries,
            entry,
          ),
        }));
      };
    });

    return () => {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
      console.debug = originals.debug;
    };
  }, []);

  const refresh = useCallback(async () => {
    const client = rpcClientRef.current;
    if (!client) return;
    try {
      const [model, events] = await Promise.all([
        client.getState({} as Record<string, never>),
        client.getEvents({ fromSequence: 0 }),
      ]);
      setState((prev) => ({
        ...prev,
        readModel: model,
        events,
      }));
    } catch {
    }
  }, []);

  const listProjects = useCallback(async () => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    const projects = await client.listProjects({} as Record<string, never>);
    setState((prev) => ({ ...prev, projects }));
    return projects;
  }, []);

  const createProject = useCallback(async (name: string, description: string, path: string) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    return client.createProject({ name, description, path });
  }, []);

  const openDirectory = useCallback(async (path: string) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    return client.openDirectory({ path });
  }, []);

  const browseForDirectory = useCallback(async () => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    return client.browseForDirectory({} as Record<string, never>);
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    await client.loadProject({ projectId });

    const [model, events, suspendedTasks] = await Promise.all([
      client.getState({} as Record<string, never>),
      client.getEvents({ fromSequence: 0 }),
      client.getSuspendedTasks({} as Record<string, never>),
    ]);
    setState((prev) => ({
      ...prev,
      readModel: model,
      events,
      agentEvents: [],
      suspendedTasks,
    }));

    // Do not transition via SPA state first.
    // Force the same path that consistently fixes first-paint sizing:
    // Bun relayout + full webview document reload + state rehydration.
    window.location.reload();
  }, []);

  const refreshAppSettings = useCallback(async () => {
    const client = resolveAppSettingsClient(rpcClientRef.current);

    setState((prev) => ({
      ...prev,
      appSettingsLoading: true,
      appSettingsError: null,
    }));

    try {
      const appSettings = await client.getAppSettings({} as Record<string, never>);
      applyAppSettings(appSettings);
      return createConclaveAppSettings(
        appSettings,
        state.appSettingsLastTest,
        state.appSettingsLastTestAt,
      );
    } catch (error) {
      applyAppSettingsFailure(
        error,
        state.appSettings
          ? {
              selectedAdapter: state.appSettings.provider,
              selectedModels: {
                ...state.selectedModels,
                [state.appSettings.provider]: state.appSettings.model,
              },
              adapterBinaryPaths: {
                ...createDefaultAdapterBinaryPathOverrides(),
                [state.appSettings.provider]: state.appSettings.manualBinaryPath,
              },
              settingsFilePath: state.appSettings.appSettingsPath,
              adapterResolutions: createFallbackAppSettingsState({
                selectedAdapter: state.appSettings.provider,
                availableAdapters: [...ADAPTER_OPTIONS],
                selectedModels: state.selectedModels,
              }).adapterResolutions,
            }
          : null,
      );
      throw error;
    }
  }, [
    applyAppSettings,
    applyAppSettingsFailure,
    state.appSettings,
    state.appSettingsLastTest,
    state.appSettingsLastTestAt,
    state.selectedModels,
  ]);

  const updateAppSettings = useCallback(
    async (params: ConclaveAppSettingsUpdate) => {
      const client = resolveAppSettingsClient(rpcClientRef.current);

      const patch: AppSettingsPatch = {
        selectedAdapter: params.provider,
        selectedModels: {
          [params.provider]: params.model,
        },
        adapterBinaryPaths: {
          [params.provider]: params.manualBinaryPath,
        },
      };
      const appSettings = await client.updateAppSettings(patch);
      setState((prev) => ({
        ...prev,
        appSettings: createConclaveAppSettings(appSettings, null, null),
        appSettingsError: null,
        appSettingsLastTest: null,
        appSettingsLastTestAt: null,
        appSettingsLoading: false,
        selectedAdapter: appSettings.selectedAdapter,
        selectedModels: { ...appSettings.selectedModels },
      }));
      return createConclaveAppSettings(appSettings, null, null);
    },
    [],
  );

  const testAdapterConnection = useCallback(
    async (params: ConclaveAppSettingsUpdate) => {
      const client = resolveAppSettingsClient(rpcClientRef.current);
      const patch: AppSettingsPatch = {
        selectedAdapter: params.provider,
        selectedModels: {
          [params.provider]: params.model,
        },
        adapterBinaryPaths: {
          [params.provider]: params.manualBinaryPath,
        },
      };
      const updatedSettings = await client.updateAppSettings(patch);
      const connectionResult = await client.testAdapterConnection({
        adapterType: params.provider,
      });
      const checkedAt = new Date().toISOString();
      setState((prev) => {
        const nextAppSettings = createConclaveAppSettings(
          updatedSettings,
          connectionResult,
          checkedAt,
        );

        return {
          ...prev,
          appSettings: nextAppSettings,
          appSettingsError: null,
          appSettingsLastTest: connectionResult,
          appSettingsLastTestAt: checkedAt,
          selectedAdapter: updatedSettings.selectedAdapter,
          selectedModels: { ...updatedSettings.selectedModels },
        };
      });

      return createConnectionStatus(
        connectionResult,
        checkedAt,
        connectionResult.resolution,
      );
    },
    [],
  );

  const setSelectedAdapter = useCallback(async (adapterType: AdapterType) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    const adapterState = await client.setAdapter({ adapterType });
    setState((prev) => ({
      ...prev,
      selectedAdapter: adapterState.selectedAdapter,
      availableAdapters: adapterState.availableAdapters,
      selectedModels: adapterState.selectedModels,
      appSettings: prev.appSettings
        ? {
            ...prev.appSettings,
            provider: adapterState.selectedAdapter,
            model:
              adapterState.selectedModels[adapterState.selectedAdapter] ??
              prev.appSettings.model,
          }
        : prev.appSettings,
    }));
  }, []);

  const setAdapterModel = useCallback(
    async (adapterType: AdapterType, model: string) => {
      const client = rpcClientRef.current;
      if (!client) throw new Error("Not connected");
      const adapterState = await client.setAdapterModel({ adapterType, model });
      setState((prev) => ({
        ...prev,
        selectedAdapter: adapterState.selectedAdapter,
        availableAdapters: adapterState.availableAdapters,
        selectedModels: adapterState.selectedModels,
        appSettings: prev.appSettings
          ? {
              ...prev.appSettings,
              provider: adapterType,
              model,
            }
          : prev.appSettings,
      }));
    },
    [],
  );

  const sendCommand = useCallback(async (message: string) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    return client.sendCommand({ message });
  }, []);

  const createTask = useCallback(
    async (params: {
      taskType: string;
      title: string;
      description: string;
      deps: string[];
    }) => {
      const client = rpcClientRef.current;
      if (!client) throw new Error("Not connected");
      return client.createTask(params);
    },
    [],
  );

  const updateTaskStatus = useCallback(
    async (params: {
      taskId: string;
      status: string;
      reason?: string;
    }) => {
      const client = rpcClientRef.current;
      if (!client) throw new Error("Not connected");
      await client.updateTaskStatus(params);
    },
    [],
  );

  const approveProposedTasks = useCallback(
    async (params: {
      meetingId: string;
      approvedTaskIds: string[];
      rejectedTaskIds: string[];
    }) => {
      const client = rpcClientRef.current;
      if (!client) throw new Error("Not connected");
      await client.approveProposedTasks(params);
    },
    [],
  );

  const scheduleMeeting = useCallback(
    async (params: {
      meetingType: string;
      agenda: string[];
      participants: string[];
    }) => {
      const client = rpcClientRef.current;
      if (!client) throw new Error("Not connected");
      return client.scheduleMeeting(params);
    },
    [],
  );

  const getSuspendedTasks = useCallback(async () => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    const tasks = await client.getSuspendedTasks({} as Record<string, never>);
    setState((prev) => ({ ...prev, suspendedTasks: tasks }));
    return tasks;
  }, []);

  const resumeSuspendedTask = useCallback(async (taskId: string) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    await client.resumeSuspendedTask({ taskId });
    // Refresh suspended tasks list after resuming
    const tasks = await client.getSuspendedTasks({} as Record<string, never>);
    setState((prev) => ({ ...prev, suspendedTasks: tasks }));
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    await client.deleteProject({ projectId });
    await listProjects();
  }, [listProjects]);

  const unloadProject = useCallback(async () => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    await client.unloadProject({} as Record<string, never>);

    const [nextProjects, model, events, suspendedTasks] = await Promise.all([
      client.listProjects({} as Record<string, never>),
      client.getState({} as Record<string, never>).catch(() => null),
      client.getEvents({ fromSequence: 0 }).catch(() => []),
      client.getSuspendedTasks({} as Record<string, never>).catch(() => []),
    ]);

    setState((prev) => ({
      ...prev,
      activeProject: null,
      readModel: model,
      events,
      agentEvents: [],
      agentRoster: [],
      suspendedTasks,
      projects: nextProjects,
    }));

    window.location.reload();
  }, []);

  const dismissQuotaExhausted = useCallback(() => {
    setState((prev) => ({ ...prev, quotaExhaustedInfo: null }));
  }, []);

  const value: ConclaveContextValue = {
    ...state,
    listProjects,
    createProject,
    openDirectory,
    browseForDirectory,
    loadProject,
    refreshAppSettings,
    updateAppSettings,
    testAdapterConnection,
    setSelectedAdapter,
    setAdapterModel,
    sendCommand,
    createTask,
    updateTaskStatus,
    approveProposedTasks,
    scheduleMeeting,
    getSuspendedTasks,
    resumeSuspendedTask,
    dismissQuotaExhausted,
    refresh,
    deleteProject,
    unloadProject,
  };

  return (
    <ConclaveContext.Provider value={value}>{children}</ConclaveContext.Provider>
  );
}

export function useConclave(): ConclaveContextValue {
  const ctx = useContext(ConclaveContext);
  if (!ctx) {
    throw new Error("useConclave must be used within ConclaveProvider");
  }
  return ctx;
}
