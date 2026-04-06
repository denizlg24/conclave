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
import type {
  ConclaveRPCSchema,
  SerializedAgentEvent,
  SerializedAgentInfo,
  SerializedAgentRoster,
  SerializedEvent,
  SerializedProject,
  SerializedReadModel,
} from "../../shared/rpc/rpc-schema";

interface ConclaveState {
  activeProject: SerializedProject | null;
  readModel: SerializedReadModel | null;
  events: SerializedEvent[];
  agentEvents: SerializedAgentEvent[];
  agentRoster: SerializedAgentInfo[];
  projects: SerializedProject[];
  connected: boolean;
}

interface ConclaveActions {
  listProjects: () => Promise<SerializedProject[]>;
  createProject: (name: string, description: string, path: string) => Promise<SerializedProject>;
  openDirectory: (path: string) => Promise<SerializedProject>;
  browseForDirectory: () => Promise<string | null>;
  loadProject: (projectId: string) => Promise<void>;
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
  refresh: () => Promise<void>;
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
}

export function ConclaveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConclaveState>({
    activeProject: null,
    readModel: null,
    events: [],
    agentEvents: [],
    agentRoster: [],
    projects: [],
    connected: false,
  });

  const rpcClientRef = useRef<RPCClient | null>(null);

  useEffect(() => {
    const rpc = Electroview.defineRPC<ConclaveRPCSchema>({
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
              events: [...prev.events, event],
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
              agentEvents: [...prev.agentEvents, agentEvent],
            }));
          },
          onAgentRoster: (roster) => {
            setState((prev) => ({
              ...prev,
              agentRoster: roster.agents,
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
          const [activeProject, projects] = await Promise.all([
            client.getActiveProject({} as Record<string, never>),
            client.listProjects({} as Record<string, never>),
          ]);

          if (activeProject) {
            const [model, events, roster] = await Promise.all([
              client.getState({} as Record<string, never>),
              client.getEvents({ fromSequence: 0 }),
              client.getAgentRoster({} as Record<string, never>),
            ]);
            setState((prev) => ({
              ...prev,
              activeProject,
              readModel: model,
              events,
              agentRoster: roster.agents,
              projects,
              connected: true,
            }));
          } else {
            setState((prev) => ({ ...prev, projects, connected: true }));
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
    const [model, events] = await Promise.all([
      client.getState({} as Record<string, never>),
      client.getEvents({ fromSequence: 0 }),
    ]);
    setState((prev) => ({
      ...prev,
      readModel: model,
      events,
      agentEvents: [],
    }));
  }, []);

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

  const value: ConclaveContextValue = {
    ...state,
    listProjects,
    createProject,
    openDirectory,
    browseForDirectory,
    loadProject,
    sendCommand,
    createTask,
    updateTaskStatus,
    approveProposedTasks,
    scheduleMeeting,
    refresh,
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
