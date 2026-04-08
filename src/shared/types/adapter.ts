export const ADAPTER_TYPES = ["claude-code", "openai-codex"] as const;

export type AdapterType = (typeof ADAPTER_TYPES)[number];

export interface AdapterOption {
  readonly type: AdapterType;
  readonly label: string;
  readonly provider: string;
  readonly description: string;
}

export const DEFAULT_ADAPTER_TYPE: AdapterType = "claude-code";

export const ADAPTER_OPTIONS: ReadonlyArray<AdapterOption> = [
  {
    type: "claude-code",
    label: "Claude Code",
    provider: "Anthropic",
    description: "Streams Claude Code CLI sessions with resume support.",
  },
  {
    type: "openai-codex",
    label: "OpenAI Codex",
    provider: "OpenAI",
    description: "Streams Codex CLI sessions with JSON events and resume support.",
  },
];

export function isAdapterType(value: string): value is AdapterType {
  return ADAPTER_TYPES.includes(value as AdapterType);
}
