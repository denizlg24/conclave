import { useConclave } from "../hooks/use-conclave";

export function QuotaExhaustedDialog() {
  const { quotaExhaustedInfo, dismissQuotaExhausted, resumeSuspendedTask } = useConclave();

  if (!quotaExhaustedInfo) return null;

  const handleResume = async () => {
    await resumeSuspendedTask(quotaExhaustedInfo.taskId);
    dismissQuotaExhausted();
  };

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    return `${Math.floor(diff / 3_600_000)}h ago`;
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80">
      <div
        className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
        style={{
          background: "linear-gradient(180deg, rgba(30, 25, 20, 0.98) 0%, rgba(20, 18, 15, 0.98) 100%)",
          border: "1px solid rgba(245, 158, 11, 0.3)",
        }}
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{
            background: "rgba(245, 158, 11, 0.1)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.2)",
          }}
        >
          <span className="text-2xl">{"\u26a0"}</span>
          <div>
            <h3
              className="rpg-font text-sm tracking-wider"
              style={{ color: "#f59e0b" }}
            >
              CREDITS EXHAUSTED
            </h3>
            <p
              className="rpg-mono text-[10px] mt-0.5"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              {relativeTime(quotaExhaustedInfo.occurredAt)}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p
            className="rpg-mono text-[11px] leading-relaxed"
            style={{ color: "var(--rpg-text)" }}
          >
            Agent <span style={{ color: "#f59e0b" }}>{quotaExhaustedInfo.agentId.replace("agent-", "").toUpperCase()}</span> has
            run out of API credits. The task has been suspended and will resume
            when credits become available.
          </p>

          <div
            className="p-3 rounded-lg"
            style={{
              background: "rgba(0, 0, 0, 0.3)",
              border: "1px solid var(--rpg-border)",
            }}
          >
            <p
              className="rpg-mono text-[10px] uppercase mb-1"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              Error Details
            </p>
            <p
              className="rpg-mono text-[10px] break-words"
              style={{ color: "var(--rpg-text-dim)" }}
            >
              {quotaExhaustedInfo.rawMessage.slice(0, 200)}
              {quotaExhaustedInfo.rawMessage.length > 200 ? "\u2026" : ""}
            </p>
          </div>

          <div
            className="p-3 rounded-lg"
            style={{
              background: "rgba(106, 153, 78, 0.1)",
              border: "1px solid rgba(106, 153, 78, 0.2)",
            }}
          >
            <p
              className="rpg-mono text-[10px] leading-relaxed"
              style={{ color: "var(--rpg-sage)" }}
            >
              {"\u2714"} Task context has been saved. You can resume at any time
              after adding more credits to your account.
            </p>
          </div>
        </div>

        <div
          className="flex gap-3 justify-end px-5 py-4"
          style={{ borderTop: "1px solid var(--rpg-border)" }}
        >
          <button
            onClick={dismissQuotaExhausted}
            className="rpg-mono text-[10px] px-4 py-2 cursor-pointer transition-all rounded"
            style={{
              background: "rgba(107, 122, 101, 0.2)",
              border: "1px solid rgba(107, 122, 101, 0.4)",
              color: "var(--rpg-text-muted)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(107, 122, 101, 0.35)";
              e.currentTarget.style.color = "var(--rpg-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(107, 122, 101, 0.2)";
              e.currentTarget.style.color = "var(--rpg-text-muted)";
            }}
          >
            DISMISS
          </button>
          <button
            onClick={handleResume}
            className="rpg-mono text-[10px] px-4 py-2 cursor-pointer transition-all rounded"
            style={{
              background: "rgba(106, 153, 78, 0.2)",
              border: "1px solid rgba(106, 153, 78, 0.4)",
              color: "#6a994e",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(106, 153, 78, 0.35)";
              e.currentTarget.style.borderColor = "#6a994e";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(106, 153, 78, 0.2)";
              e.currentTarget.style.borderColor = "rgba(106, 153, 78, 0.4)";
            }}
          >
            RESUME NOW
          </button>
        </div>
      </div>
    </div>
  );
}
