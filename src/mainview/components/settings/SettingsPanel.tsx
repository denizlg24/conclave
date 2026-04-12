import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  RefreshCcw,
  Save,
  TriangleAlert,
} from "lucide-react";

import {
  DEFAULT_ADAPTER_TYPE,
  defaultModelForAdapter,
  isAdapterModel,
  secondaryModelForAdapter,
  type AdapterType,
} from "../../../shared/types/adapter";
import type { SerializedAdapterOption } from "../../../shared/rpc/rpc-schema";
import { Input } from "../../../shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/components/ui/select";
import type {
  ConclaveAppSettings,
  ConclaveAppSettingsUpdate,
  ConclaveConnectionStatus,
} from "../../hooks/use-conclave";
import {
  ActionButton,
  FieldShell,
} from "../shared";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";

interface SettingsPanelProps {
  adapterOptions: ReadonlyArray<SerializedAdapterOption>;
  appSettings: ConclaveAppSettings | null;
  appSettingsLoading: boolean;
  appSettingsError: string | null;
  busy: boolean;
  onRefresh: () => Promise<ConclaveAppSettings>;
  onSave: (params: ConclaveAppSettingsUpdate) => Promise<ConclaveAppSettings>;
  onTest: (
    params: ConclaveAppSettingsUpdate,
  ) => Promise<ConclaveConnectionStatus>;
}

interface SettingsDraft {
  provider: AdapterType;
  model: string;
  manualBinaryPath: string;
}

interface ActionFeedback {
  tone: "neutral" | "success" | "failure";
  message: string;
}

const UNKNOWN_STATUS: ConclaveConnectionStatus = {
  state: "unknown",
  message: "Adapter health has not been checked yet.",
  checkedAt: null,
};

function buildDraft(
  adapterOptions: ReadonlyArray<SerializedAdapterOption>,
  appSettings: ConclaveAppSettings | null,
): SettingsDraft {
  const provider =
    appSettings?.provider ?? adapterOptions[0]?.type ?? DEFAULT_ADAPTER_TYPE;
  const providerOption =
    adapterOptions.find((option) => option.type === provider) ?? null;
  const nextModel =
    appSettings && isAdapterModel(provider, appSettings.model)
      ? appSettings.model
      : providerOption?.defaultModel ?? defaultModelForAdapter(provider);

  return {
    provider,
    model: nextModel,
    manualBinaryPath: appSettings?.manualBinaryPath ?? "",
  };
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Not yet tested";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function feedbackStyle(tone: ActionFeedback["tone"]): string {
  switch (tone) {
    case "success":
      return "border-[rgba(129,178,154,0.36)] bg-[rgba(129,178,154,0.08)]";
    case "failure":
      return "border-[rgba(196,92,74,0.44)] bg-[rgba(196,92,74,0.1)]";
    default:
      return "border-[rgba(90,110,82,0.36)] bg-[rgba(255,255,255,0.03)]";
  }
}

export function SettingsPanel({
  adapterOptions,
  appSettings,
  appSettingsLoading,
  appSettingsError,
  busy,
  onRefresh,
  onSave,
  onTest,
}: SettingsPanelProps) {
  const baselineDraft = useMemo(
    () => buildDraft(adapterOptions, appSettings),
    [adapterOptions, appSettings],
  );
  const [draft, setDraft] = useState<SettingsDraft>(baselineDraft);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<ActionFeedback | null>(null);
  const [testFeedback, setTestFeedback] = useState<ActionFeedback | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setDraft(baselineDraft);
  }, [baselineDraft]);

  const activeProvider =
    adapterOptions.find((option) => option.type === draft.provider) ??
    adapterOptions[0];
  const connectionStatus = appSettings?.connectionStatus ?? UNKNOWN_STATUS;
  const selectedModel =
    activeProvider?.models.find((model) => model.value === draft.model) ?? null;
  const secondaryModelValue = secondaryModelForAdapter(draft.provider);
  const secondaryModel =
    activeProvider?.models.find((model) => model.value === secondaryModelValue) ??
    null;
  const hasUnsavedChanges =
    draft.provider !== baselineDraft.provider ||
    draft.model !== baselineDraft.model ||
    draft.manualBinaryPath !== baselineDraft.manualBinaryPath;
  const actionsDisabled =
    busy || appSettingsLoading || isSaving || isTesting || !activeProvider;

  const handleProviderChange = (provider: AdapterType) => {
    if (provider === draft.provider) {
      return;
    }

    const providerOption =
      adapterOptions.find((option) => option.type === provider) ?? null;
    setDraft((current) => ({
      ...current,
      provider,
      model:
        providerOption && isAdapterModel(provider, current.model)
          ? current.model
          : providerOption?.defaultModel ?? defaultModelForAdapter(provider),
    }));
  };

  const handleSave = async () => {
    if (!activeProvider) {
      return;
    }

    setIsSaving(true);
    setSaveFeedback({ tone: "neutral", message: "Saving settings..." });
    try {
      await onSave({
        provider: draft.provider,
        model: draft.model,
        manualBinaryPath: draft.manualBinaryPath.trim() || null,
      });
      setSaveFeedback({
        tone: "success",
        message: "Settings saved. The selected primary model remains persisted for new work.",
      });
    } catch (error) {
      setSaveFeedback({
        tone: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!activeProvider) {
      return;
    }

    setIsTesting(true);
    setTestFeedback({ tone: "neutral", message: "Testing connection..." });
    try {
      const status = await onTest({
        provider: draft.provider,
        model: draft.model,
        manualBinaryPath: draft.manualBinaryPath.trim() || null,
      });
      setTestFeedback({
        tone: status.state === "connected" ? "success" : "failure",
        message:
          status.message ??
          (status.state === "connected"
            ? "Adapter connection succeeded."
            : "Adapter connection failed."),
      });
    } catch (error) {
      setTestFeedback({
        tone: "failure",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-5">
      <section className="space-y-5 border-b border-[rgba(90,110,82,0.2)] pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="rpg-mono text-[10px] uppercase tracking-[0.18em] text-[var(--rpg-gold-dim)]">
              Adapter routing
            </p>
            <h2 className="rpg-mono text-[1.75rem] leading-tight text-[var(--rpg-text)]">
              Persist the primary route and keep the cheaper secondary path explicit.
            </h2>
          </div>
          <ActionButton
            onClick={handleRefresh}
            loading={isRefreshing}
            disabled={busy}
            icon={<RefreshCcw className="h-3.5 w-3.5" />}
          >
            Refresh
          </ActionButton>
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                  Active provider
                </p>
                <h3 className="rpg-mono mt-2 text-sm text-[var(--rpg-text)]">
                  {activeProvider?.label ?? "Unknown provider"}
                </h3>
              </div>
              <ConnectionStatusBadge status={connectionStatus} />
            </div>

            <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
              <InlineMeta label="Primary model" value={draft.model} />
              <InlineMeta
                label="Secondary route"
                value={secondaryModel?.label ?? secondaryModelValue}
              />
              <InlineMeta
                label="Manual binary"
                value={draft.manualBinaryPath || "System path or backend detection"}
                breakAll
              />
              <InlineMeta
                label="Detected binary"
                value={appSettings?.detectedBinaryPath ?? "Not reported yet"}
                breakAll
              />
              <InlineMeta
                label="Settings location"
                value={appSettings?.appSettingsPath ?? "Not reported yet"}
                breakAll
                className="sm:col-span-2"
              />
            </div>
          </div>

          <div className="space-y-5 border-l border-[rgba(90,110,82,0.16)] pl-6">
            <div className="flex items-center gap-2 text-[var(--rpg-sage)]">
              <Activity className="h-4 w-4" />
              <span className="rpg-mono text-[10px] uppercase tracking-[0.14em]">
                Connection health
              </span>
            </div>
            <p className="rpg-mono text-[11px] leading-7 text-[var(--rpg-text-dim)]">
              {connectionStatus.message ?? "No test result available."}
            </p>
            <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
              Last checked {formatTimestamp(connectionStatus.checkedAt)}
            </p>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[var(--rpg-gold)]">
                <Bot className="h-4 w-4" />
                <span className="rpg-mono text-[10px] uppercase tracking-[0.14em]">
                  Automatic routing
                </span>
              </div>
              <p className="rpg-mono text-[11px] leading-7 text-[var(--rpg-text-dim)]">
                Planning, decomposition, and all meeting work automatically use{" "}
                <span className="text-[var(--rpg-text)]">
                  {secondaryModel?.label ?? secondaryModelValue}
                </span>
                . Implementation, testing, and DAG review tasks stay on the primary selection.
              </p>
            </div>
          </div>
        </div>
      </section>

      {appSettingsError ? (
        <div className="inline-flex items-start gap-2 rounded-2xl border border-[rgba(196,92,74,0.44)] bg-[rgba(196,92,74,0.1)] px-4 py-3 text-[var(--rpg-danger)]">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="rpg-mono text-[11px] leading-5">{appSettingsError}</span>
        </div>
      ) : null}

      <section className="space-y-5 border-b border-[rgba(90,110,82,0.2)] pb-6">
        <div className="space-y-2">
          <p className="rpg-mono text-[10px] uppercase tracking-[0.18em] text-[var(--rpg-gold-dim)]">
            Provider catalog
          </p>
          <h2 className="rpg-mono text-[1.75rem] leading-tight text-[var(--rpg-text)]">
            Choose which adapter owns the persisted primary model.
          </h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {adapterOptions.map((option) => {
            const active = option.type === draft.provider;

            return (
              <button
                key={option.type}
                type="button"
                onClick={() => handleProviderChange(option.type)}
                disabled={busy || isSaving || isTesting}
                className={[
                  "border-b px-0 py-4 text-left transition-colors",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-[rgba(200,169,110,0.54)]"
                    : "border-[rgba(90,110,82,0.3)] hover:border-[rgba(200,169,110,0.32)]",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="rpg-mono text-sm text-[var(--rpg-text)]">
                      {option.label}
                    </div>
                    <div className="rpg-mono mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                      {option.provider}
                    </div>
                  </div>
                  <div
                    className={[
                      "mt-1 h-2.5 w-2.5 rounded-full",
                      active
                        ? "bg-[var(--rpg-gold)] shadow-[0_0_12px_rgba(200,169,110,0.55)]"
                        : "bg-[rgba(90,110,82,0.65)]",
                    ].join(" ")}
                  />
                </div>
                <p className="rpg-mono mt-3 text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-5">
        <div className="space-y-2">
          <p className="rpg-mono text-[10px] uppercase tracking-[0.18em] text-[var(--rpg-gold-dim)]">
            Primary model settings
          </p>
          <h2 className="rpg-mono text-[1.75rem] leading-tight text-[var(--rpg-text)]">
            Keep one persisted primary model per adapter.
          </h2>
          <p className="rpg-mono text-[11px] leading-7 text-[var(--rpg-text-dim)]">
            No second selector is stored. The secondary route is deterministic and enforced below the UI.
          </p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <FieldShell
            label="Model"
            hint="The dropdown shows model names only. Model descriptions are rendered below the field."
          >
            <div className="space-y-3">
              <Select
                value={draft.model}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, model: value }))
                }
                disabled={actionsDisabled}
              >
                <SelectTrigger className="h-11 w-full rounded-2xl border-[rgba(90,110,82,0.42)] bg-[rgba(255,255,255,0.03)] px-4 text-left text-[var(--rpg-text)] shadow-none">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent className="border-[rgba(58,74,53,0.78)] bg-[rgba(21,28,21,0.98)] text-[var(--rpg-text)]">
                  {activeProvider?.models.map((model) => (
                    <SelectItem
                      key={model.value}
                      value={model.value}
                      className="rpg-mono text-[12px]"
                    >
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="space-y-2 border-l border-[rgba(90,110,82,0.22)] pl-4">
                <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                  Selected primary model
                </p>
                <p className="rpg-mono text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                  {selectedModel?.description ?? "No model description available."}
                </p>
                <p className="rpg-mono text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                  Automatic secondary route:{" "}
                  <span className="text-[var(--rpg-text)]">
                    {secondaryModel?.label ?? secondaryModelValue}
                  </span>
                </p>
              </div>
            </div>
          </FieldShell>

          <FieldShell
            label="Manual binary path"
            hint="Optional override when the adapter CLI is not on PATH or you want to target a specific install."
          >
            <Input
              type="text"
              value={draft.manualBinaryPath}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  manualBinaryPath: event.target.value,
                }))
              }
              disabled={actionsDisabled}
              placeholder="Leave blank to use the auto-detected binary"
              className="h-11 rounded-none border-x-0 border-t-0 border-b-[rgba(90,110,82,0.38)] bg-transparent px-0 text-[var(--rpg-text)] shadow-none placeholder:text-[var(--rpg-text-muted)] focus-visible:ring-0"
            />
          </FieldShell>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {[saveFeedback, testFeedback].map((feedback, index) => (
            <div
              key={index}
              className={`border-l px-4 py-1 ${feedbackStyle(feedback?.tone ?? "neutral")}`}
            >
              <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                {index === 0 ? "Save status" : "Connection test"}
              </p>
              <p className="rpg-mono mt-2 text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                {feedback?.message ??
                  (index === 0
                    ? "Save the current draft to persist the primary model selection."
                    : "Run a connection test to validate launch, credentials, and binary resolution.")}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <ActionButton
            onClick={() => setDraft(baselineDraft)}
            disabled={!hasUnsavedChanges || actionsDisabled}
          >
            Reset
          </ActionButton>
          <ActionButton
            onClick={handleTest}
            loading={isTesting}
            disabled={actionsDisabled}
            icon={<Activity className="h-3.5 w-3.5" />}
          >
            Test connection
          </ActionButton>
          <ActionButton
            tone="primary"
            onClick={handleSave}
            loading={isSaving}
            disabled={actionsDisabled}
            icon={<Save className="h-3.5 w-3.5" />}
          >
            Save settings
          </ActionButton>
        </div>
      </section>
    </div>
  );
}

function InlineMeta({
  label,
  value,
  breakAll = false,
  className,
}: {
  label: string;
  value: string;
  breakAll?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
        {label}
      </p>
      <p
        className={[
          "rpg-mono mt-2 text-[11px] leading-7 text-[var(--rpg-text)]",
          breakAll ? "break-all" : "break-words",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}
