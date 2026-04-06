import { useState } from "react";
import { useConclave } from "../hooks/use-conclave";

export function CommandBar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { sendCommand } = useConclave();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  if (!open) return null;

  const handleSend = () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setMessage("");
    onClose();
    sendCommand(text)
      .catch((err) => {
        console.error("sendCommand failed:", err);
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="absolute inset-0 flex items-end justify-center pointer-events-auto z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(14, 18, 14, 0.5)" }}
        onClick={onClose}
      />

      {/* Dialogue box — anchored to bottom like RPG dialogue */}
      <div
        className="relative w-full max-w-[720px] mb-14 mx-4 rpg-panel overflow-hidden"
        style={{
          animation: "toast-in 0.2s ease-out",
        }}
      >
        {/* Header — PM badge */}
        <div
          className="flex items-center gap-3 px-4 py-2.5"
          style={{
            borderBottom: "1px solid var(--rpg-border)",
            background:
              "linear-gradient(180deg, rgba(200, 169, 110, 0.08) 0%, transparent 100%)",
          }}
        >
          {/* PM portrait badge */}
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: 28,
              height: 28,
              background: "rgba(200, 169, 110, 0.15)",
              border: "1px solid var(--rpg-gold-dim)",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16">
              <polygon
                points="8,1 10,5 14,5.5 11,8.5 12,13 8,11 4,13 5,8.5 2,5.5 6,5"
                fill="#c8a96e"
                opacity="0.8"
              />
            </svg>
          </div>
          <div>
            <span
              className="rpg-font text-[10px] tracking-wider block"
              style={{ color: "var(--rpg-gold)" }}
            >
              PROJECT MANAGER
            </span>
            <span
              className="rpg-mono text-[9px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              Issue a directive to the PM
            </span>
          </div>
        </div>

        {/* Input area */}
        <div className="p-4">
          <textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === "Escape") onClose();
            }}
            placeholder="Describe the project or feature to build..."
            rows={3}
            className="w-full rpg-mono text-[12px] px-3 py-2.5 resize-none outline-none transition-colors"
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
          <div className="flex items-center justify-between mt-3">
            <span
              className="rpg-mono text-[9px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              Enter to dispatch
              <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
              Shift+Enter newline
              <span style={{ margin: "0 6px", opacity: 0.3 }}>{"\u00b7"}</span>
              Esc cancel
            </span>
            <button
              onClick={handleSend}
              disabled={!message.trim() || sending}
              className="rpg-action-btn primary-action disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ padding: "6px 16px" }}
            >
              {sending ? "DISPATCHING..." : "DISPATCH"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
