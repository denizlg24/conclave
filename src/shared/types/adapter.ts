export const ADAPTER_TYPES = ["claude-code", "openai-codex"] as const;

export type AdapterType = (typeof ADAPTER_TYPES)[number];

export interface AdapterModelOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

export interface AdapterOption {
  readonly type: AdapterType;
  readonly label: string;
  readonly provider: string;
  readonly description: string;
  readonly defaultModel: string;
  readonly models: ReadonlyArray<AdapterModelOption>;
}

export const DEFAULT_ADAPTER_TYPE: AdapterType = "claude-code";

export type AdapterModelSelections = Record<AdapterType, string>;

const ADAPTER_OPTION_MAP = {
  "claude-code": {
    type: "claude-code",
    label: "Claude Code",
    provider: "Anthropic",
    description: "Streams Claude Code CLI sessions with resume support.",
    defaultModel: "claude-sonnet-4-6",
    models: [
      {
        value: "claude-sonnet-4-6",
        label: "Sonnet 4.6",
        description: "Latest Sonnet model for daily coding tasks.",
      },
      {
        value: "claude-opus-4-6",
        label: "Opus 4.6",
        description: "Latest Opus model for complex reasoning tasks.",
      },
    ],
  },
  "openai-codex": {
    type: "openai-codex",
    label: "OpenAI Codex",
    provider: "OpenAI",
    description: "Streams Codex CLI sessions with JSON events and resume support.",
    defaultModel: "gpt-5.4",
    models: [
      {
        value: "gpt-5.4",
        label: "GPT-5.4",
        description: "Latest model surfaced in Codex CLI docs.",
      },
      {
        value: "gpt-5.3-codex",
        label: "GPT-5.3 Codex",
        description: "Previous coding-focused Codex model.",
      },
    ],
  },
} as const satisfies Record<AdapterType, AdapterOption>;

export const ADAPTER_OPTIONS: ReadonlyArray<AdapterOption> = ADAPTER_TYPES.map(
  (type) => ADAPTER_OPTION_MAP[type],
);

export function defaultModelForAdapter(adapterType: AdapterType): string {
  return ADAPTER_OPTION_MAP[adapterType].defaultModel;
}

export function createDefaultAdapterModelSelections(): AdapterModelSelections {
  return {
    "claude-code": defaultModelForAdapter("claude-code"),
    "openai-codex": defaultModelForAdapter("openai-codex"),
  };
}

export function getAdapterModels(
  adapterType: AdapterType,
): ReadonlyArray<AdapterModelOption> {
  return ADAPTER_OPTION_MAP[adapterType].models;
}

export function isAdapterType(value: string): value is AdapterType {
  return ADAPTER_TYPES.includes(value as AdapterType);
}

export function isAdapterModel(
  adapterType: AdapterType,
  value: string,
): boolean {
  return getAdapterModels(adapterType).some((model) => model.value === value);
}
