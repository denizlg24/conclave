import { useState } from "react";
import {
  ArrowLeft,
  FolderOpen,
  Plus,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { ADAPTER_OPTIONS } from "../../shared/types/adapter";
import { Input } from "../../shared/components/ui/input";
import { ScrollArea } from "../../shared/components/ui/scroll-area";
import { Textarea } from "../../shared/components/ui/textarea";
import { useConclave } from "../hooks/use-conclave";
import { ActionButton, FieldShell } from "./shared";
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
      className="conclave-home-shell relative flex h-full min-h-0 w-full overflow-hidden text-[var(--rpg-text)]"
      style={{
        background: `
          radial-gradient(ellipse at 50% 20%, rgba(200, 169, 110, 0.08) 0%, transparent 60%),
          radial-gradient(ellipse at 85% 0%, rgba(129, 178, 154, 0.08) 0%, transparent 36%),
          radial-gradient(ellipse at 10% 100%, rgba(160, 122, 82, 0.08) 0%, transparent 30%),
          var(--rpg-bg)
        `,
      }}
    >
      <div className="conclave-surface-grid pointer-events-none absolute inset-0 opacity-70" />

      <ScrollArea className="relative min-h-0 flex-1">
        <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-8 px-6 py-8 sm:px-8 lg:px-12 lg:py-10">
              {page === "home" ? (
                <>
                  <header className="flex flex-col gap-6 border-b border-[rgba(90,110,82,0.24)] pb-8">
                    <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                      <div className="min-w-0 space-y-4">
                        <div className="inline-flex items-center gap-2 text-[var(--rpg-gold)]">
                          <ShieldCheck className="h-4 w-4" />
                          <span className="rpg-mono text-[11px] uppercase tracking-[0.18em]">
                            Conclave
                          </span>
                        </div>
                        <div>
                          <h1 className="rpg-mono text-4xl leading-none text-[var(--rpg-text)] sm:text-5xl xl:text-6xl">
                            Projects
                          </h1>
                          <p className="rpg-mono mt-4 max-w-3xl text-[12px] leading-7 text-[var(--rpg-text-dim)]">
                            Start a new workspace, reopen an existing one, or adjust the current
                            route. Keep the surface quiet and let the project list do the talking.
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:min-w-[24rem] xl:grid-cols-2">
                        <InlineStat label="Projects" value={String(projects.length)} />
                        <InlineStat
                          label="Provider"
                          value={activeAdapter?.label ?? "Unknown"}
                        />
                        <InlineStat
                          label="Connection"
                          value={connectionLabel(
                            appSettings?.connectionStatus.state ?? "unknown",
                          )}
                        />
                        <InlineStat label="Primary model" value={activeModel || "Unknown"} />
                      </div>
                    </div>
                  </header>

                  <div className="grid gap-10 xl:grid-cols-[minmax(0,1.45fr)_minmax(16rem,20rem)]">
                    <section className="min-w-0 space-y-8">
                      <section className="space-y-5">
                        <div className="flex flex-col gap-4 border-b border-[rgba(90,110,82,0.18)] pb-5 lg:flex-row lg:items-end lg:justify-between">
                          <div className="max-w-2xl space-y-2">
                            <p className="rpg-mono text-[10px] uppercase tracking-[0.2em] text-[var(--rpg-gold-dim)]">
                              Workspace launch
                            </p>
                            <h2 className="rpg-mono text-[1.75rem] leading-tight text-[var(--rpg-text)]">
                              Open a directory or prepare a new orchestration brief.
                            </h2>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <ActionButton
                              onClick={() => setShowNewForm((current) => !current)}
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

                        {showNewForm ? (
                          <div className="grid gap-6 lg:grid-cols-2">
                            <FieldShell
                              label="Project name"
                              hint="Keep it specific enough that the PM/planning pass can decompose it cleanly."
                            >
                              <Input
                                type="text"
                                value={newName}
                                onChange={(event) => setNewName(event.target.value)}
                                placeholder="Example: Approval queue hardening"
                                className="h-11 rounded-none border-x-0 border-t-0 border-b-[rgba(90,110,82,0.38)] bg-transparent px-0 text-[var(--rpg-text)] shadow-none placeholder:text-[var(--rpg-text-muted)] focus-visible:ring-0"
                              />
                            </FieldShell>

                            <FieldShell
                              label="Working directory"
                              hint="Select the root folder Conclave should treat as the bounded workspace."
                            >
                              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
                                <ActionButton
                                  onClick={handleBrowse}
                                  disabled={loading !== null}
                                  icon={<FolderOpen className="h-3.5 w-3.5" />}
                                >
                                  Select
                                </ActionButton>
                                <div className="min-w-0 flex-1 border-b border-[rgba(90,110,82,0.26)] pb-3">
                                  <p className="rpg-mono break-all text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                                    {selectedPath ?? "No directory selected"}
                                  </p>
                                </div>
                              </div>
                            </FieldShell>

                            <FieldShell
                              label="Objective"
                              hint="Describe the outcome, constraints, and any non-negotiable requirements."
                              className="lg:col-span-2"
                            >
                              <Textarea
                                value={newDescription}
                                onChange={(event) => setNewDescription(event.target.value)}
                                placeholder="Describe project objective and constraints..."
                                rows={5}
                                className="min-h-[132px] rounded-none border-x-0 border-t-0 border-b-[rgba(90,110,82,0.32)] bg-transparent px-0 py-0 text-[var(--rpg-text)] shadow-none placeholder:text-[var(--rpg-text-muted)] focus-visible:ring-0"
                              />
                            </FieldShell>

                            <div className="lg:col-span-2 flex flex-col gap-3 border-t border-[rgba(90,110,82,0.18)] pt-5 sm:flex-row sm:items-center sm:justify-between">
                              <p className="rpg-mono text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                                Active route:{" "}
                                <span className="text-[var(--rpg-text)]">
                                  {activeAdapter?.label ?? "Unknown provider"}
                                </span>{" "}
                                on{" "}
                                <span className="text-[var(--rpg-text)]">{activeModel || "Unknown model"}</span>
                              </p>
                              <ActionButton
                                tone="primary"
                                onClick={handleCreate}
                                loading={Boolean(loading && loading !== "open")}
                                disabled={
                                  !newName.trim() ||
                                  !newDescription.trim() ||
                                  !selectedPath ||
                                  loading !== null
                                }
                                icon={<Plus className="h-3.5 w-3.5" />}
                              >
                                Create project
                              </ActionButton>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="rpg-mono max-w-2xl text-[11px] leading-7 text-[var(--rpg-text-dim)]">
                              Toggle <span className="text-[var(--rpg-text)]">New project</span> to name
                              the workspace, pick a bounded directory, and record the initial objective.
                            </p>
                            <div className="rpg-mono text-[10px] uppercase tracking-[0.16em] text-[var(--rpg-text-muted)]">
                              Planning-ready
                            </div>
                          </div>
                        )}
                      </section>

                      <section className="space-y-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <p className="rpg-mono text-[10px] uppercase tracking-[0.18em] text-[var(--rpg-gold-dim)]">
                              Registry
                            </p>
                            <h2 className="rpg-mono mt-2 text-xl text-[var(--rpg-text)]">
                              Existing workspaces
                            </h2>
                            <p className="rpg-mono mt-2 text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                              Load an existing workspace or prune stale registry entries without touching files on disk.
                            </p>
                          </div>
                          <div className="rpg-mono text-[10px] uppercase tracking-[0.16em] text-[var(--rpg-text-muted)]">
                            {projects.length} tracked
                          </div>
                        </div>

                        {projects.length === 0 ? (
                          <div className="border-y border-dashed border-[rgba(90,110,82,0.3)] px-2 py-10 text-center">
                            <p className="rpg-mono text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                              No projects yet. Create one or open a directory to begin.
                            </p>
                          </div>
                        ) : (
                          <ScrollArea className="max-h-[30rem] pr-2">
                            <div className="divide-y divide-[rgba(90,110,82,0.16)] border-y border-[rgba(90,110,82,0.18)]">
                              {projects.map((project) => {
                                const isLoading = loading === project.id;
                                const isDeleting = deletingId === project.id;

                                return (
                                  <article
                                    key={project.id}
                                    className="px-2 py-5 transition-colors hover:bg-[rgba(255,255,255,0.015)] sm:px-3"
                                  >
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                      <button
                                        onClick={() => handleLoad(project.id)}
                                        disabled={loading !== null || deletingId === project.id}
                                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <h3 className="rpg-mono text-sm text-[var(--rpg-text)]">
                                            {project.name}
                                          </h3>
                                          <span className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                                            {new Date(project.createdAt).toLocaleDateString()}
                                          </span>
                                        </div>
                                        <p className="rpg-mono mt-3 max-w-3xl text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                                          {project.description}
                                        </p>
                                        <p
                                          title={project.path}
                                          className="rpg-mono mt-3 break-all text-[11px] text-[var(--rpg-text-muted)]"
                                        >
                                          {project.path}
                                        </p>
                                      </button>

                                      <div className="flex shrink-0 gap-2">
                                        <ActionButton
                                          tone="danger"
                                          onClick={() => setDeletingId(project.id)}
                                          disabled={loading !== null || deletingId !== null}
                                          icon={<Trash2 className="h-3.5 w-3.5" />}
                                        >
                                          Remove
                                        </ActionButton>
                                      </div>
                                    </div>

                                    {isLoading ? (
                                      <div className="mt-4 border-t border-[rgba(90,110,82,0.18)] pt-3">
                                        <p className="rpg-mono text-[11px] text-[var(--rpg-text-dim)]">
                                          Opening workspace...
                                        </p>
                                      </div>
                                    ) : null}

                                    {isDeleting ? (
                                      <div className="mt-4 border-l border-[rgba(196,92,74,0.44)] pl-4">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                          <p className="rpg-mono text-[11px] leading-6 text-[var(--rpg-text-dim)]">
                                            Remove this project from the local registry. Files remain on disk.
                                          </p>
                                          <div className="flex flex-wrap gap-2">
                                            <ActionButton
                                              tone="danger"
                                              onClick={() => handleDelete(project.id)}
                                            >
                                              Confirm
                                            </ActionButton>
                                            <ActionButton onClick={() => setDeletingId(null)}>
                                              Cancel
                                            </ActionButton>
                                          </div>
                                        </div>
                                      </div>
                                    ) : null}
                                  </article>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        )}
                      </section>
                    </section>

                    <aside className="min-w-0">
                      <div className="sticky top-0 space-y-8 border-l border-[rgba(90,110,82,0.16)] pl-6">
                        <div className="space-y-4">
                          <p className="rpg-mono text-[10px] uppercase tracking-[0.18em] text-[var(--rpg-gold-dim)]">
                            Route board
                          </p>
                          <div className="space-y-4">
                            <InlineStat label="Provider" value={activeAdapter?.label ?? "Unknown"} />
                            <InlineStat label="Primary model" value={activeModel || "Unknown"} />
                            <InlineStat
                              label="Connection"
                              value={connectionLabel(
                                appSettings?.connectionStatus.state ?? "unknown",
                              )}
                            />
                          </div>
                        </div>

                        <div className="space-y-5">
                          <p className="rpg-mono text-[10px] uppercase tracking-[0.18em] text-[var(--rpg-gold-dim)]">
                            Notes
                          </p>
                          <div>
                            <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                              Planning route
                            </p>
                            <p className="rpg-mono mt-2 text-[11px] leading-7 text-[var(--rpg-text-dim)]">
                              PM planning, decomposition, and meetings use the deterministic cheaper secondary model route below the UI layer.
                            </p>
                          </div>
                          <div>
                            <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
                              Registry behavior
                            </p>
                            <p className="rpg-mono mt-2 text-[11px] leading-7 text-[var(--rpg-text-dim)]">
                              Removing a project clears only the local registry entry. Files remain in the selected workspace path.
                            </p>
                          </div>
                        </div>
                      </div>
                    </aside>
                  </div>

                  <footer className="flex flex-col gap-3 border-t border-[rgba(90,110,82,0.24)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <span className="rpg-mono text-[10px] uppercase tracking-[0.16em] text-[var(--rpg-text-muted)]">
                      v0.1.0
                    </span>
                    {error ? (
                      <div className="rounded-full border border-[rgba(196,92,74,0.44)] bg-[rgba(196,92,74,0.1)] px-4 py-2">
                        <p className="rpg-mono break-all text-[11px] leading-5 text-[var(--rpg-danger)]">
                          {error}
                        </p>
                      </div>
                    ) : null}
                  </footer>
                </>
              ) : (
                <>
                  <header className="flex flex-col gap-6 border-b border-[rgba(90,110,82,0.24)] pb-8">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
                        <ActionButton
                          onClick={() => setPage("home")}
                          icon={<ArrowLeft className="h-3.5 w-3.5" />}
                        >
                          Back
                        </ActionButton>
                        <div className="min-w-0">
                          <p className="rpg-mono text-[11px] uppercase tracking-[0.18em] text-[var(--rpg-gold)]">
                            Conclave settings
                          </p>
                          <h1 className="rpg-mono mt-2 text-3xl text-[var(--rpg-text)]">
                            Adapter configuration
                          </h1>
                          <p className="rpg-mono mt-3 max-w-3xl text-[12px] leading-6 text-[var(--rpg-text-dim)]">
                            Configure the persisted primary route, verify binary resolution, and
                            confirm the automatic cheap-model policy used for planning and meetings.
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:min-w-[22rem] xl:grid-cols-3">
                        <InlineStat
                          label="Provider"
                          value={activeAdapter?.label ?? "Unknown"}
                        />
                        <InlineStat label="Primary model" value={activeModel || "Unknown"} />
                        <InlineStat
                          label="Connection"
                          value={connectionLabel(
                            appSettings?.connectionStatus.state ?? "unknown",
                          )}
                        />
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

                  {error ? (
                    <div className="rounded-[20px] border border-[rgba(196,92,74,0.44)] bg-[rgba(196,92,74,0.1)] px-4 py-3">
                      <p className="rpg-mono break-all text-[11px] leading-5 text-[var(--rpg-danger)]">
                        {error}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
      </ScrollArea>

      {page === "home" ? (
        <button
          type="button"
          aria-label="Open settings"
          onClick={() => setPage("settings")}
          className="absolute bottom-8 right-8 inline-flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(90,110,82,0.42)] bg-[rgba(16,22,17,0.92)] text-[var(--rpg-text)] shadow-[0_10px_18px_rgba(0,0,0,0.22)] transition-colors hover:border-[rgba(200,169,110,0.42)] hover:bg-[rgba(21,28,22,0.98)] hover:text-[var(--rpg-gold)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,169,110,0.35)]"
        >
          <Settings className="h-4 w-4" />
        </button>
      ) : null}
    </main>
  );
}

function InlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="rpg-mono text-[10px] uppercase tracking-[0.14em] text-[var(--rpg-text-muted)]">
        {label}
      </p>
      <p className="rpg-mono mt-2 break-words text-[12px] leading-6 text-[var(--rpg-text)]">
        {value}
      </p>
    </div>
  );
}
