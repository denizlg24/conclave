import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  LoaderCircle,
  RefreshCcw,
  Save,
  TriangleAlert,
} from "lucide-react";
import {
  DEFAULT_ADAPTER_TYPE,
  defaultModelForAdapter,
  isAdapterModel,
  type AdapterType,
} from "../../../shared/types/adapter";
import type { SerializedAdapterOption } from "../../../shared/rpc/rpc-schema";
import type {
  ConclaveAppSettings,
  ConclaveAppSettingsUpdate,
  ConclaveConnectionStatus,
} from "../../hooks/use-conclave";
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

function feedbackToneClass(tone: ActionFeedback["tone"]): string {
  switch (tone) {
    case "success":
      return "conclave-feedback-box conclave-feedback-box--success";
    case "failure":
      return "conclave-feedback-box conclave-feedback-box--failure";
    default:
      return "conclave-feedback-box";
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
        message: "Settings saved. New projects use this route.",
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
    <section className="conclave-settings-panel">
      <div className="conclave-section-head">
        <div>
          <h2>Adapter routing</h2>
          <p>Set provider, model, and optional CLI binary override.</p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={busy || isRefreshing}
          className="conclave-btn-secondary"
        >
          {isRefreshing ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="h-3.5 w-3.5" />
          )}
          Refresh
        </button>
      </div>

      <div className="conclave-settings-grid">
        <div className="conclave-settings-summary">
          <div className="conclave-settings-summary__row">
            <div>
              <span>Active provider</span>
              <strong>{activeProvider?.label ?? "Unknown provider"}</strong>
            </div>
            <ConnectionStatusBadge status={connectionStatus} />
          </div>

          <dl>
            <div>
              <dt>Model</dt>
              <dd>{draft.model}</dd>
            </div>
            <div>
              <dt>Manual binary</dt>
              <dd>{draft.manualBinaryPath || "System path or backend detection"}</dd>
            </div>
            <div>
              <dt>Detected binary</dt>
              <dd>{appSettings?.detectedBinaryPath ?? "Not reported yet"}</dd>
            </div>
            <div>
              <dt>Settings location</dt>
              <dd>{appSettings?.appSettingsPath ?? "Not reported yet"}</dd>
            </div>
          </dl>
        </div>

        <div className="conclave-settings-health">
          <div className="conclave-settings-health__head">
            <Activity className="h-4 w-4" />
            <span>Connection health</span>
          </div>
          <p>{connectionStatus.message ?? "No test result available."}</p>
          <small>Last checked {formatTimestamp(connectionStatus.checkedAt)}</small>
        </div>
      </div>

      {appSettingsError && (
        <div className="conclave-inline-error">
          <TriangleAlert className="h-4 w-4" />
          {appSettingsError}
        </div>
      )}

      <div className="conclave-provider-list">
        {adapterOptions.map((option) => {
          const active = option.type === draft.provider;

          return (
            <button
              key={option.type}
              type="button"
              onClick={() => handleProviderChange(option.type)}
              disabled={busy || isSaving || isTesting}
              className={
                active
                  ? "conclave-provider-option conclave-provider-option--active"
                  : "conclave-provider-option"
              }
            >
              <div className="conclave-provider-option__head">
                <div>
                  <strong>{option.label}</strong>
                  <span>{option.provider}</span>
                </div>
                {active && <CheckCircle2 className="h-4 w-4" />}
              </div>
              <p>{option.description}</p>
            </button>
          );
        })}
      </div>

      <div className="conclave-form-grid">
        <FieldShell
          label="Model"
          hint="Model options are constrained by selected provider."
        >
          <select
            value={draft.model}
            onChange={(event) =>
              setDraft((current) => ({ ...current, model: event.target.value }))
            }
            disabled={actionsDisabled}
            className="conclave-input"
          >
            {activeProvider?.models.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label} - {model.description}
              </option>
            ))}
          </select>
        </FieldShell>

        <FieldShell
          label="Manual binary path"
          hint="Optional override when adapter CLI is not on PATH."
        >
          <input
            type="text"
            value={draft.manualBinaryPath}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                manualBinaryPath: event.target.value,
              }))
            }
            disabled={actionsDisabled}
            placeholder="Leave blank to use auto-detected binary"
            className="conclave-input"
          />
        </FieldShell>
      </div>

      <div className="conclave-feedback-grid">
        <FeedbackBox feedback={saveFeedback} />
        <FeedbackBox feedback={testFeedback} />
      </div>

      <div className="conclave-actions-row conclave-actions-row--end">
        <button
          type="button"
          onClick={() => setDraft(baselineDraft)}
          disabled={!hasUnsavedChanges || actionsDisabled}
          className="conclave-btn-secondary"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={actionsDisabled}
          className="conclave-btn-secondary"
        >
          {isTesting ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Activity className="h-3.5 w-3.5" />
          )}
          Test connection
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={actionsDisabled}
          className="conclave-btn-primary"
        >
          {isSaving ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save settings
        </button>
      </div>
    </section>
  );
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="conclave-field-block">
      <span>{label}</span>
      <small>{hint}</small>
      {children}
    </label>
  );
}

function FeedbackBox({ feedback }: { feedback: ActionFeedback | null }) {
  const tone = feedback?.tone ?? "neutral";

  return (
    <div className={feedbackToneClass(tone)}>
      <span>
        {tone === "success"
          ? "Last action"
          : tone === "failure"
            ? "Attention"
            : "Status"}
      </span>
      <p>
        {feedback?.message ??
          "Save or test the current draft to validate the adapter route."}
      </p>
    </div>
  );
}
