import type { OrchestrationEvent } from "./orchestration";
import type { AgentRuntimeEvent } from "./agent-runtime";

export type BusEvent = OrchestrationEvent | AgentRuntimeEvent;
