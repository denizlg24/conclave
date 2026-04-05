// ---------------------------------------------------------------------------
// Serialized domain types for RPC transport (plain types, no Effect brands)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// RPC Schema — conforms to ElectrobunRPCSchema
// ---------------------------------------------------------------------------

export type ConclaveRPCSchema = {
  bun: {
    requests: {
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
    };
    messages: Record<never, unknown>;
  };
  webview: {
    requests: Record<never, { params: unknown; response: unknown }>;
    messages: {
      onStateChanged: SerializedReadModel;
      onEvent: SerializedEvent;
    };
  };
};
