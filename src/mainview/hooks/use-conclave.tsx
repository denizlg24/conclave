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
  SerializedEvent,
  SerializedReadModel,
} from "../../shared/rpc/rpc-schema";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface ConclaveState {
  readModel: SerializedReadModel | null;
  events: SerializedEvent[];
  connected: boolean;
}

interface ConclaveActions {
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

// ---------------------------------------------------------------------------
// Typed RPC client extracted from defineRPC return value
// ---------------------------------------------------------------------------

interface RPCClient {
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

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ConclaveProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConclaveState>({
    readModel: null,
    events: [],
    connected: false,
  });

  // Store the typed RPC request proxy directly (not the Electroview instance)
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
        },
      },
    });

    // Create Electroview to set up transport (WebSocket to bun process)
    new Electroview({ rpc });

    // Extract the request proxy — has all the typed methods from bun.requests
    const client = rpc.proxy.request as RPCClient;
    rpcClientRef.current = client;

    // Initial state fetch — retry to handle WebSocket connection race
    const fetchInitialState = async (retries = 3, delayMs = 500) => {
      for (let i = 0; i < retries; i++) {
        try {
          const [model, events] = await Promise.all([
            client.getState({} as Record<string, never>),
            client.getEvents({ fromSequence: 0 }),
          ]);
          setState((prev) => ({
            ...prev,
            readModel: model,
            events,
            connected: true,
          }));
          return;
        } catch {
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
      console.error("Failed to get initial state after retries");
    };
    fetchInitialState();
  }, []);

  const refresh = useCallback(async () => {
    const client = rpcClientRef.current;
    if (!client) return;
    const [model, events] = await Promise.all([
      client.getState({} as Record<string, never>),
      client.getEvents({ fromSequence: 0 }),
    ]);
    setState((prev) => ({
      ...prev,
      readModel: model,
      events,
    }));
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConclave(): ConclaveContextValue {
  const ctx = useContext(ConclaveContext);
  if (!ctx) {
    throw new Error("useConclave must be used within ConclaveProvider");
  }
  return ctx;
}
