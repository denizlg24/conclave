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
  ADAPTER_OPTIONS,
  DEFAULT_ADAPTER_TYPE,
  createDefaultAdapterModelSelections,
  type AdapterModelSelections,
  type AdapterType,
} from "../../shared/types/adapter";
import type {
  ConclaveRPCSchema,
  SerializedAdapterOption,
  SerializedAdapterState,
  SerializedAgentEvent,
  SerializedAgentInfo,
  SerializedAgentRoster,
  SerializedDebugConsoleEntry,
  SerializedEvent,
  SerializedProject,
  SerializedReadModel,
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

interface ConclaveState {
  activeProject: SerializedProject | null;
  selectedAdapter: AdapterType;
  availableAdapters: SerializedAdapterOption[];
  selectedModels: AdapterModelSelections;
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

export function ConclaveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConclaveState>({
    activeProject: null,
    selectedAdapter: DEFAULT_ADAPTER_TYPE,
    availableAdapters: [...ADAPTER_OPTIONS],
    selectedModels: createDefaultAdapterModelSelections(),
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
          onProjectLoaded: (project) => {
            setState((prev) => ({
              ...prev,
              activeProject: project,
            }));
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
              projects,
              debugConsoleEntries: mergeDebugConsoleEntries(
                prev.debugConsoleEntries,
                debugConsoleEntries,
              ),
              connected: true,
            }));
          }
          return;
        } catch {
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
      setState((prev) => ({ ...prev, connected: true }));
    };
    init();
  }, []);

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

    // A full document reload takes the same path as the manual workaround
    // the user reported: after refresh, the Electrobun/WebView layout is
    // correct on first paint and the active project is rehydrated from Bun.
    window.location.reload();
  }, []);

  const setSelectedAdapter = useCallback(async (adapterType: AdapterType) => {
    const client = rpcClientRef.current;
    if (!client) throw new Error("Not connected");
    const adapterState = await client.setAdapter({ adapterType });
    setState((prev) => ({
      ...prev,
      selectedAdapter: adapterState.selectedAdapter,
      availableAdapters: adapterState.availableAdapters,
      selectedModels: adapterState.selectedModels,
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
    const projects = await client.listProjects({} as Record<string, never>);
    setState((prev) => ({
      ...prev,
      activeProject: null,
      readModel: null,
      events: [],
      agentEvents: [],
      agentRoster: [],
      suspendedTasks: [],
      projects,
    }));
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
