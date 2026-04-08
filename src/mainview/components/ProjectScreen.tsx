import { useState } from "react";
import { useConclave } from "../hooks/use-conclave";
import {
  ADAPTER_OPTIONS,
  type AdapterType,
} from "../../shared/types/adapter";

export function ProjectScreen() {
  const {
    projects,
    selectedAdapter,
    availableAdapters,
    createProject,
    openDirectory,
    browseForDirectory,
    loadProject,
    setSelectedAdapter,
    deleteProject,
  } = useConclave();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [adapterLoading, setAdapterLoading] = useState<AdapterType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const adapterOptions =
    availableAdapters.length > 0 ? availableAdapters : ADAPTER_OPTIONS;

  const handleBrowse = async () => {
    setError(null);
    try {
      const path = await browseForDirectory();
      if (path) setSelectedPath(path);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpenDirectory = async () => {
    setError(null);
    try {
      const path = await browseForDirectory();
      if (!path) return;
      setLoading("open");
      const project = await openDirectory(path);
      await loadProject(project.id);
    } catch (err) {
      setError(String(err));
      setLoading(null);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    const description = newDescription.trim();
    if (!name || !description || !selectedPath) return;
    setError(null);
    try {
      const project = await createProject(name, description, selectedPath);
      setNewName("");
      setNewDescription("");
      setSelectedPath(null);
      setLoading(project.id);
      await loadProject(project.id);
    } catch (err) {
      setError(String(err));
      setLoading(null);
    }
  };

  const handleLoad = async (id: string) => {
    setError(null);
    setLoading(id);
    try {
      await loadProject(id);
    } catch (err) {
      setError(String(err));
      setLoading(null);
    }
  };

  const handleAdapterSelect = async (adapterType: AdapterType) => {
    if (adapterType === selectedAdapter || loading !== null) return;

    setError(null);
    setAdapterLoading(adapterType);
    try {
      await setSelectedAdapter(adapterType);
    } catch (err) {
      setError(String(err));
    } finally {
      setAdapterLoading(null);
    }
  };

  return (
    <main
      className="w-full flex items-center justify-center"
      style={{
        background: `
          radial-gradient(ellipse at 50% 30%, rgba(200, 169, 110, 0.06) 0%, transparent 60%),
          radial-gradient(ellipse at 50% 80%, rgba(161, 188, 152, 0.04) 0%, transparent 50%),
          var(--rpg-bg)
        `,
        height: "100%",
      }}
    >
      {/* Decorative border lines */}
      <div
        className="absolute inset-8 pointer-events-none"
        style={{ border: "1px solid rgba(58, 74, 53, 0.2)" }}
      />
      <div
        className="absolute inset-10 pointer-events-none"
        style={{ border: "1px solid rgba(58, 74, 53, 0.1)" }}
      />

      <div className="w-[480px] flex flex-col items-center">
        {/* Title */}
        <div className="text-center mb-10">
          <h1
            className="rpg-font text-[28px] tracking-[0.3em]"
            style={{ color: "var(--rpg-gold)" }}
          >
            CONCLAVE
          </h1>
          <p
            className="rpg-mono text-[10px] mt-2 tracking-widest"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            MULTI-AGENT ORCHESTRATION PLATFORM
          </p>
          <div
            className="mt-3 mx-auto"
            style={{
              width: 120,
              height: 1,
              background:
                "linear-gradient(90deg, transparent, var(--rpg-gold-dim), transparent)",
            }}
          />
        </div>

        {/* Main menu */}
        <div className="w-full rpg-panel overflow-hidden">
          <div
            className="px-5 py-4"
            style={{ borderBottom: "1px solid var(--rpg-border)" }}
          >
            <span
              className="rpg-font text-[9px] tracking-wider block mb-3"
              style={{ color: "var(--rpg-gold-dim)" }}
            >
              AGENT ADAPTER
            </span>
            <div className="grid grid-cols-2 gap-2">
              {adapterOptions.map((adapter) => {
                const active = adapter.type === selectedAdapter;
                const isBusy = adapterLoading === adapter.type;

                return (
                  <button
                    key={adapter.type}
                    onClick={() => handleAdapterSelect(adapter.type)}
                    disabled={loading !== null || adapterLoading !== null}
                    className="text-left px-3 py-3 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{
                      background: active
                        ? "rgba(200, 169, 110, 0.08)"
                        : "rgba(255, 255, 255, 0.02)",
                      border: active
                        ? "1px solid var(--rpg-border-highlight)"
                        : "1px solid var(--rpg-border)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="rpg-mono text-[11px]"
                        style={{
                          color: active
                            ? "var(--rpg-gold)"
                            : "var(--rpg-text)",
                        }}
                      >
                        {adapter.label}
                      </span>
                      <span
                        className="rpg-mono text-[8px] uppercase tracking-wider"
                        style={{ color: "var(--rpg-text-muted)" }}
                      >
                        {isBusy ? "..." : adapter.provider}
                      </span>
                    </div>
                    <p
                      className="rpg-mono text-[9px] mt-2 leading-relaxed"
                      style={{ color: "var(--rpg-text-muted)" }}
                    >
                      {adapter.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <p
              className="rpg-mono text-[9px] mt-3"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              The selected adapter is used when you start or load the next campaign.
            </p>
          </div>

          {/* Menu actions */}
          <div
            className="flex flex-col"
            style={{ borderBottom: "1px solid var(--rpg-border)" }}
          >
            <MenuButton
              onClick={() => setShowNewForm(!showNewForm)}
              active={showNewForm}
              loading={false}
            >
              NEW CAMPAIGN
            </MenuButton>
            <MenuButton
              onClick={handleOpenDirectory}
              loading={loading === "open"}
            >
              OPEN DIRECTORY
            </MenuButton>
          </div>

          {/* New campaign form */}
          {showNewForm && (
            <div
              className="px-5 py-4 space-y-3"
              style={{
                borderBottom: "1px solid var(--rpg-border)",
                background: "rgba(200, 169, 110, 0.03)",
              }}
            >
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Campaign name..."
                className="w-full rpg-mono text-[11px] px-3 py-2 outline-none transition-colors"
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--rpg-border)",
                  color: "var(--rpg-text)",
                  caretColor: "var(--rpg-gold)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor =
                    "var(--rpg-border-highlight)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--rpg-border)")
                }
              />
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe the project objective..."
                rows={3}
                className="w-full rpg-mono text-[11px] px-3 py-2 outline-none resize-none transition-colors"
                style={{
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid var(--rpg-border)",
                  color: "var(--rpg-text)",
                  caretColor: "var(--rpg-gold)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.borderColor =
                    "var(--rpg-border-highlight)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.borderColor = "var(--rpg-border)")
                }
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBrowse}
                  disabled={loading !== null}
                  className="rpg-action-btn shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  SELECT DIRECTORY
                </button>
                <span
                  className="rpg-mono text-[10px] truncate min-w-0"
                  style={{ color: "var(--rpg-text-dim)" }}
                >
                  {selectedPath ?? "No directory selected"}
                </span>
              </div>
              <button
                onClick={handleCreate}
                disabled={
                  !newName.trim() ||
                  !newDescription.trim() ||
                  !selectedPath ||
                  loading !== null
                }
                className="w-full rpg-action-btn primary-action justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ padding: "8px 16px" }}
              >
                BEGIN CAMPAIGN
              </button>
            </div>
          )}

          {/* Saved campaigns */}
          <div className="px-5 py-4">
            <span
              className="rpg-font text-[9px] tracking-wider block mb-3"
              style={{ color: "var(--rpg-gold-dim)" }}
            >
              {projects.length > 0 ? "CONTINUE CAMPAIGN" : "NO CAMPAIGNS"}
            </span>

            {projects.length === 0 ? (
              <p
                className="rpg-mono text-[10px] text-center py-4"
                style={{ color: "var(--rpg-text-muted)" }}
              >
                Begin a new campaign to get started
              </p>
            ) : (
              <div className="space-y-1 max-h-[240px] overflow-y-auto overflow-x-hidden">
                {projects.map((p) => (
                  <div key={p.id}>
                    <div
                      className="flex items-center min-w-0"
                      style={{ border: "1px solid var(--rpg-border)" }}
                    >
                      <button
                        onClick={() => handleLoad(p.id)}
                        disabled={loading !== null || deletingId === p.id}
                        className="flex-1 flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer disabled:opacity-30 transition-all"
                        style={{ background: "transparent" }}
                        onMouseEnter={(e) => {
                          if (deletingId !== p.id) {
                            e.currentTarget.style.background = "rgba(200, 169, 110, 0.05)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div
                            className="rpg-mono text-[11px] truncate"
                            style={{ color: "var(--rpg-text)" }}
                          >
                            {p.name}
                          </div>
                          <div
                            className="rpg-mono text-[9px] truncate mt-0.5"
                            style={{ color: "var(--rpg-text-muted)" }}
                          >
                            {p.path}
                          </div>
                        </div>
                        <div
                          className="rpg-mono text-[9px] shrink-0"
                          style={{ color: "var(--rpg-text-muted)" }}
                        >
                          {new Date(p.createdAt).toLocaleDateString()}
                        </div>
                        {loading === p.id && (
                          <div
                            className="w-3 h-3 border border-t-transparent rounded-full animate-spin shrink-0"
                            style={{ borderColor: "var(--rpg-gold-dim)", borderTopColor: "transparent" }}
                          />
                        )}
                      </button>
                      <button
                        onClick={() => setDeletingId(p.id)}
                        disabled={loading !== null || deletingId !== null}
                        className="rpg-mono text-[10px] px-2 py-1 mx-2 shrink-0 cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{
                          background: "rgba(196, 92, 74, 0.1)",
                          border: "1px solid rgba(196, 92, 74, 0.3)",
                          color: "var(--rpg-text-muted)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(196, 92, 74, 0.2)";
                          e.currentTarget.style.borderColor = "rgba(196, 92, 74, 0.6)";
                          e.currentTarget.style.color = "#c45c4a";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(196, 92, 74, 0.1)";
                          e.currentTarget.style.borderColor = "rgba(196, 92, 74, 0.3)";
                          e.currentTarget.style.color = "var(--rpg-text-muted)";
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {deletingId === p.id && (
                      <div
                        className="flex items-center gap-2 px-3 py-2"
                        style={{
                          background: "rgba(196, 92, 74, 0.08)",
                          border: "1px solid rgba(196, 92, 74, 0.3)",
                          borderTop: "none",
                        }}
                      >
                        <span
                          className="rpg-mono text-[10px] flex-1"
                          style={{ color: "#c45c4a" }}
                        >
                          REMOVE FROM LIST?
                        </span>
                        <button
                          onClick={async () => {
                            await deleteProject(p.id);
                            setDeletingId(null);
                          }}
                          className="rpg-mono text-[10px] px-2 py-0.5 cursor-pointer transition-all"
                          style={{
                            background: "rgba(196, 92, 74, 0.2)",
                            border: "1px solid rgba(196, 92, 74, 0.5)",
                            color: "#c45c4a",
                          }}
                        >
                          CONFIRM
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="rpg-mono text-[10px] px-2 py-0.5 cursor-pointer transition-all"
                          style={{
                            background: "transparent",
                            border: "1px solid var(--rpg-border)",
                            color: "var(--rpg-text-muted)",
                          }}
                        >
                          CANCEL
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Error display */}
          {error && (
            <div
              className="px-5 py-2"
              style={{ borderTop: "1px solid var(--rpg-danger-dim)" }}
            >
              <p
                className="rpg-mono text-[10px]"
                style={{ color: "var(--rpg-danger)" }}
              >
                {error}
              </p>
            </div>
          )}
        </div>

        {/* Version tag */}
        <span
          className="rpg-mono text-[8px] mt-6"
          style={{ color: "var(--rpg-text-muted)" }}
        >
          v0.1.0
        </span>
      </div>
    </main>
  );
}

function MenuButton({
  onClick,
  active,
  loading,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rpg-mono text-[12px] w-full text-left px-5 py-3 cursor-pointer transition-all disabled:opacity-50 flex items-center justify-between"
      style={{
        color: active ? "var(--rpg-gold)" : "var(--rpg-text)",
        background: active ? "rgba(200, 169, 110, 0.06)" : "transparent",
        borderBottom: "1px solid var(--rpg-border)",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
          e.currentTarget.style.color = "var(--rpg-gold)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--rpg-text)";
        }
      }}
    >
      <span>{children}</span>
      {loading && (
        <div
          className="w-3 h-3 border border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "var(--rpg-gold-dim)", borderTopColor: "transparent" }}
        />
      )}
      {active && !loading && (
        <span style={{ color: "var(--rpg-gold-dim)" }}>{"\u25bc"}</span>
      )}
    </button>
  );
}
