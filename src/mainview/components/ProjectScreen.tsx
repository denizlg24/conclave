import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  FolderOpen,
  LoaderCircle,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useConclave } from "../hooks/use-conclave";
import { ADAPTER_OPTIONS } from "../../shared/types/adapter";
import { SettingsPanel } from "./settings/SettingsPanel";

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function connectionLabel(state: string): string {
  switch (state) {
    case "connected":
      return "Ready";
    case "failed":
      return "Attention";
    case "not_configured":
      return "Configure";
    default:
      return "Unknown";
  }
}

export function ProjectScreen() {
  const {
    projects,
    selectedAdapter,
    availableAdapters,
    selectedModels,
    appSettings,
    appSettingsLoading,
    appSettingsError,
    createProject,
    openDirectory,
    browseForDirectory,
    loadProject,
    refreshAppSettings,
    updateAppSettings,
    testAdapterConnection,
    deleteProject,
  } = useConclave();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState<"home" | "settings">("home");

  const adapterOptions =
    availableAdapters.length > 0 ? availableAdapters : ADAPTER_OPTIONS;
  const activeProviderType = appSettings?.provider ?? selectedAdapter;
  const activeAdapter =
    adapterOptions.find((adapter) => adapter.type === activeProviderType) ??
    adapterOptions[0];
  const activeModel =
    appSettings?.model ??
    (activeAdapter
      ? selectedModels[activeAdapter.type] ?? activeAdapter.defaultModel
      : "");
  const settingsBusy = loading !== null || deletingId !== null;

  const handleBrowse = async () => {
    setError(null);
    try {
      const path = await browseForDirectory();
      if (path) {
        setSelectedPath(path);
      }
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  const handleOpenDirectory = async () => {
    setError(null);
    try {
      const path = await browseForDirectory();
      if (!path) {
        return;
      }
      setLoading("open");
      const project = await openDirectory(path);
      await loadProject(project.id);
    } catch (err) {
      setError(toErrorMessage(err));
      setLoading(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    const description = newDescription.trim();
    if (!name || !description || !selectedPath) {
      return;
    }

    setError(null);
    try {
      const project = await createProject(name, description, selectedPath);
      setNewName("");
      setNewDescription("");
      setSelectedPath(null);
      setLoading(project.id);
      await loadProject(project.id);
    } catch (err) {
      setError(toErrorMessage(err));
      setLoading(null);
    }
  };

  const handleLoad = async (id: string) => {
    setError(null);
    setLoading(id);
    try {
      await loadProject(id);
    } catch (err) {
      setError(toErrorMessage(err));
      setLoading(null);
    }
  };

  const handleDelete = async (projectId: string) => {
    setError(null);
    try {
      await deleteProject(projectId);
      setDeletingId(null);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  };

  return (
    <main
      className="flex items-center justify-center overflow-hidden"
      style={{
        background: `
          radial-gradient(ellipse at 50% 30%, rgba(200, 169, 110, 0.06) 0%, transparent 60%),
          radial-gradient(ellipse at 50% 80%, rgba(161, 188, 152, 0.04) 0%, transparent 50%),
          var(--rpg-bg)
        `,
        width: "var(--app-width, 100%)",
        height: "var(--app-height, 100%)",
      }}
    >
      {page === "home" ? (
        <div className="conclave-workspace-scroll">
          <div className="conclave-workspace-content">
            <header className="conclave-topline">
              <div>
                <div className="conclave-brandline">
                  <ShieldCheck className="h-4 w-4" />
                  <span>Conclave</span>
                </div>
                <h1 className="conclave-page-title">Projects</h1>
                <p className="conclave-page-subtitle">
                  Start a new workspace or continue an existing one.
                </p>
              </div>

              <div className="conclave-inline-meta">
                <InlineMetric label="Projects" value={String(projects.length)} />
                <InlineMetric label="Provider" value={activeAdapter?.label ?? "Unknown"} />
                <InlineMetric
                  label="Connection"
                  value={connectionLabel(appSettings?.connectionStatus.state ?? "unknown")}
                />
              </div>
            </header>

            <section className="conclave-section">
              <div className="conclave-section-head">
                <div>
                  <h2>Start work</h2>
                  <p>New projects inherit the current provider and model settings.</p>
                </div>
                <div className="conclave-actions-row">
                  <ActionButton
                    onClick={() => setShowNewForm((current) => !current)}
                    loading={false}
                    active={showNewForm}
                    icon={<Plus className="h-3.5 w-3.5" />}
                  >
                    New project
                  </ActionButton>
                  <ActionButton
                    onClick={handleOpenDirectory}
                    loading={loading === "open"}
                    icon={<FolderOpen className="h-3.5 w-3.5" />}
                  >
                    Open directory
                  </ActionButton>
                </div>
              </div>

              {showNewForm && (
                <div className="conclave-form-grid">
                  <label className="conclave-field-block">
                    <span>Project name</span>
                    <input
                      type="text"
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      placeholder="Example: Approval queue hardening"
                      className="conclave-input"
                    />
                  </label>

                  <label className="conclave-field-block">
                    <span>Working directory</span>
                    <div className="conclave-row-input">
                      <button
                        onClick={handleBrowse}
                        disabled={loading !== null}
                        className="conclave-btn-secondary"
                      >
                        Select
                      </button>
                      <div className="conclave-readout-box flex-1 truncate">
                        {selectedPath ?? "No directory selected"}
                      </div>
                    </div>
                  </label>

                  <label className="conclave-field-block conclave-field-block--full">
                    <span>Objective</span>
                    <textarea
                      value={newDescription}
                      onChange={(event) => setNewDescription(event.target.value)}
                      placeholder="Describe project objective and constraints..."
                      rows={4}
                      className="conclave-input min-h-[112px] resize-none"
                    />
                  </label>

                  <div className="conclave-form-footer">
                    <p>
                      Active route: {activeAdapter?.label ?? "Unknown provider"} on {activeModel}
                    </p>
                    <button
                      onClick={handleCreate}
                      disabled={
                        !newName.trim() ||
                        !newDescription.trim() ||
                        !selectedPath ||
                        loading !== null
                      }
                      className="conclave-btn-primary"
                    >
                      {loading && loading !== "open" ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Create project
                    </button>
                  </div>
                </div>
              )}
            </section>

            <section className="conclave-section">
              <div className="conclave-section-head">
                <div>
                  <h2>Project registry</h2>
                  <p>Load an existing workspace or remove stale entries.</p>
                </div>
              </div>

              <div className="conclave-list">
                {projects.length === 0 ? (
                  <div className="conclave-empty-state">
                    No projects yet. Create one or open a directory to begin.
                  </div>
                ) : (
                  projects.map((project) => {
                    const isLoading = loading === project.id;
                    const isDeleting = deletingId === project.id;

                    return (
                      <article key={project.id} className="conclave-list-item">
                        <div className="conclave-list-item__main">
                          <button
                            onClick={() => handleLoad(project.id)}
                            disabled={loading !== null || deletingId === project.id}
                            className="conclave-list-item__open"
                          >
                            <div className="conclave-list-item__title-row">
                              <h3>{project.name}</h3>
                              <span>{new Date(project.createdAt).toLocaleDateString()}</span>
                            </div>
                            <p>{project.description}</p>
                            <code>{project.path}</code>
                          </button>

                          <button
                            onClick={() => setDeletingId(project.id)}
                            disabled={loading !== null || deletingId !== null}
                            className="conclave-btn-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>

                        {isLoading && (
                          <div className="conclave-list-item__status">
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            Opening workspace...
                          </div>
                        )}

                        {isDeleting && (
                          <div className="conclave-list-item__confirm">
                            <p>Remove this project from local registry (files remain on disk).</p>
                            <div className="conclave-actions-row">
                              <button
                                onClick={() => handleDelete(project.id)}
                                className="conclave-btn-danger"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeletingId(null)}
                                className="conclave-btn-secondary"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            <footer className="conclave-footer-row">
              <span>v0.1.0</span>
              {error && <div className="conclave-inline-error">{error}</div>}
            </footer>
          </div>
        </div>
      ) : (
        <div className="conclave-workspace-scroll">
          <div className="conclave-workspace-content">
            <header className="conclave-topline">
              <div className="conclave-settings-head-row">
                <button
                  type="button"
                  onClick={() => setPage("home")}
                  className="conclave-btn-secondary"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <div>
                  <h1 className="conclave-page-title conclave-page-title--compact">Settings</h1>
                  <p className="conclave-page-subtitle">
                    Configure provider, model, and adapter binary route.
                  </p>
                </div>
              </div>
            </header>

            <SettingsPanel
              adapterOptions={adapterOptions}
              appSettings={appSettings}
              appSettingsLoading={appSettingsLoading}
              appSettingsError={appSettingsError}
              busy={settingsBusy}
              onRefresh={refreshAppSettings}
              onSave={updateAppSettings}
              onTest={testAdapterConnection}
            />

            {error && <div className="conclave-inline-error">{error}</div>}
          </div>
        </div>
      )}

      {page === "home" && (
        <button
          type="button"
          aria-label="Open settings"
          onClick={() => setPage("settings")}
          className="conclave-corner-button"
        >
          <Settings className="h-4 w-4" />
        </button>
      )}
    </main>
  );
}

function ActionButton({
  onClick,
  loading,
  active,
  icon,
  children,
}: {
  onClick: () => void;
  loading: boolean;
  active?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={active ? "conclave-btn-primary" : "conclave-btn-secondary"}
    >
      {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="conclave-inline-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
