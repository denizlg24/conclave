import type {
  AdapterBinaryResolution,
  AdapterConnectionTestResult,
  AdapterModelSelections,
  AdapterOption,
  AdapterType,
  AppSettings,
} from "../types/adapter";
import type { DebugConsoleEntry } from "../types/debug-console";

export type SerializedProject = {
  id: string;
  name: string;
  description: string;
  path: string;
  createdAt: string;
};

export type SerializedTask = {
  id: string;
  taskType: string;
  title: string;
  description: string;
  status: string;
  owner: string | null;
  ownerRole: string | null;
  deps: string[];
  input: unknown;
  output: unknown;
  createdAt: string;
  updatedAt: string;
};

export type SerializedMeeting = {
  id: string;
  meetingType: string;
  status: string;
  agenda: string[];
  participants: string[];
  contributions: Array<{
    agentRole: string;
    agendaItemIndex: number;
    content: string;
    references: string[];
  }>;
  summary: string | null;
  proposedTaskIds: string[];
  approvedTaskIds: string[];
  rejectedTaskIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SerializedEvent = {
  eventId: string;
  type: string;
  aggregateKind: string;
  aggregateId: string;
  sequence: number;
  occurredAt: string;
  commandId: string | null;
  payload: Record<string, unknown>;
};

export type SerializedReadModel = {
  tasks: SerializedTask[];
  meetings: SerializedMeeting[];
  snapshotSequence: number;
  updatedAt: string;
};

export type SerializedAgentInfo = {
  agentId: string;
  role: string;
  sessionId: string;
};

export type SerializedAgentRoster = {
  agents: SerializedAgentInfo[];
};

export type SerializedWorkspaceChanges = {
  source: "git" | "filesystem";
  added: string[];
  modified: string[];
  deleted: string[];
  truncated: boolean;
  totalCount: number;
};

export type SerializedAgentEvent = {
  type: string;
  agentId: string;
  sessionId: string;
  occurredAt: string;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  taskId?: string | null;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  workspaceChanges?: SerializedWorkspaceChanges;
  costUsd?: number;
  durationMs?: number;
};

export type SerializedSuspendedTask = {
  taskId: string;
  agentId: string;
  agentRole: string;
  suspendedAt: string;
  reason: string;
  taskTitle: string;
};

export type SerializedAdapterOption = AdapterOption;
export type SerializedDebugConsoleEntry = DebugConsoleEntry;

export type SerializedPendingProposal = {
  proposalId: string;
  meetingId: string;
  /** ID of the DAG task created for this proposal (empty string if not yet created). */
  taskId: string;
  taskType: string;
  title: string;
  description: string;
  /** Resolved dep task IDs as stored on the DAG task. */
  deps: string[];
  requiresApproval: boolean;
  proposedAt: string;
  originatingAgentRole: string;
};

export type SerializedAdapterState = {
  selectedAdapter: AdapterType;
  availableAdapters: SerializedAdapterOption[];
  selectedModels: AdapterModelSelections;
};

export type SerializedAdapterBinaryResolution = AdapterBinaryResolution;
export type SerializedAppSettings = AppSettings & {
  settingsFilePath: string | null;
  adapterResolutions: Record<
    AdapterType,
    SerializedAdapterBinaryResolution
  >;
};
export type SerializedAdapterConnectionTestResult = AdapterConnectionTestResult;

export type ConclaveRPCSchema = {
  bun: {
    requests: {
      listProjects: {
        params: Record<string, never>;
        response: SerializedProject[];
      };
      createProject: {
        params: { name: string; description: string; path: string };
        response: SerializedProject;
      };
      browseForDirectory: {
        params: Record<string, never>;
        response: string | null;
      };
      openDirectory: {
        params: { path: string };
        response: SerializedProject;
      };
      loadProject: {
        params: { projectId: string };
        response: { success: boolean };
      };
      getActiveProject: {
        params: Record<string, never>;
        response: SerializedProject | null;
      };
      getAdapterState: {
        params: Record<string, never>;
        response: SerializedAdapterState;
      };
      getAppSettings: {
        params: Record<string, never>;
        response: SerializedAppSettings;
      };
      setAdapter: {
        params: { adapterType: AdapterType };
        response: SerializedAdapterState;
      };
      setAdapterModel: {
        params: { adapterType: AdapterType; model: string };
        response: SerializedAdapterState;
      };
      updateAppSettings: {
        params: {
          selectedAdapter?: AdapterType;
          selectedModels?: Partial<AdapterModelSelections>;
          adapterBinaryPaths?: Partial<Record<AdapterType, string | null>>;
        };
        response: SerializedAppSettings;
      };
      testAdapterConnection: {
        params: { adapterType: AdapterType };
        response: SerializedAdapterConnectionTestResult;
      };
      getDebugConsoleEntries: {
        params: Record<string, never>;
        response: SerializedDebugConsoleEntry[];
      };

      getAgentRoster: {
        params: Record<string, never>;
        response: SerializedAgentRoster;
      };

      sendCommand: {
        params: { message: string };
        response: { taskId: string; meetingId: string };
      };

      getState: {
        params: Record<string, never>;
        response: SerializedReadModel;
      };
      getEvents: {
        params: { fromSequence: number };
        response: SerializedEvent[];
      };
      createTask: {
        params: {
          taskType: string;
          title: string;
          description: string;
          deps: string[];
        };
        response: { taskId: string };
      };
      updateTaskStatus: {
        params: {
          taskId: string;
          status: string;
          reason?: string;
        };
        response: { success: boolean };
      };
      approveProposedTasks: {
        params: {
          meetingId: string;
          approvedTaskIds: string[];
          rejectedTaskIds: string[];
        };
        response: { success: boolean };
      };
      scheduleMeeting: {
        params: {
          meetingType: string;
          agenda: string[];
          participants: string[];
        };
        response: { meetingId: string };
      };
      getSuspendedTasks: {
        params: Record<string, never>;
        response: SerializedSuspendedTask[];
      };
      resumeSuspendedTask: {
        params: { taskId: string };
        response: { success: boolean };
      };
      retryTask: {
        params: { taskId: string };
        response: { success: boolean };
      };
      getPendingProposals: {
        params: Record<string, never>;
        response: SerializedPendingProposal[];
      };
      deleteProject: {
        params: { projectId: string };
        response: { success: boolean };
      };
      unloadProject: {
        params: Record<string, never>;
        response: { success: boolean };
      };
    };
    messages: Record<never, unknown>;
  };
  webview: {
    requests: Record<never, { params: unknown; response: unknown }>;
    messages: {
      onStateChanged: SerializedReadModel;
      onEvent: SerializedEvent;
      onProjectLoaded: SerializedProject;
      onAgentEvent: SerializedAgentEvent;
      onAgentRoster: SerializedAgentRoster;
      onDebugConsoleEntry: SerializedDebugConsoleEntry;
      onQuotaExhausted: {
        agentId: string;
        taskId: string;
        adapterType: string;
        rawMessage: string;
        occurredAt: string;
      };
    };
  };
};
