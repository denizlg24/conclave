import type { Direction, AgentState } from "../../agent/Agent";

interface AgentSpriteProps {
  direction: Direction;
  role?: string;
  agentState?: AgentState;
}

const ROLE_ACCESSORIES: Record<string, { type: "crown" | "gear" | "eye" | "shield"; color: string }> = {
  pm: { type: "crown", color: "#c8a96e" },
  developer: { type: "gear", color: "#a1bc98" },
  reviewer: { type: "eye", color: "#e07a5f" },
  tester: { type: "shield", color: "#f2cc8f" },
};

function RoleAccessory({ type, color }: { type: string; color: string }) {
  switch (type) {
    case "crown":
      return (
        <g transform="translate(16, 1)">
          <polygon points="-5,5 -4,1 -2,4 0,0 2,4 4,1 5,5" fill={color} stroke={color} strokeWidth="0.5" />
        </g>
      );
    case "gear":
      return (
        <g transform="translate(16, 2)">
          <circle cx="0" cy="0" r="2.5" fill="none" stroke={color} strokeWidth="1" />
          <circle cx="0" cy="0" r="1" fill={color} />
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <line
              key={angle}
              x1={Math.cos((angle * Math.PI) / 180) * 2}
              y1={Math.sin((angle * Math.PI) / 180) * 2}
              x2={Math.cos((angle * Math.PI) / 180) * 3.5}
              y2={Math.sin((angle * Math.PI) / 180) * 3.5}
              stroke={color}
              strokeWidth="1"
            />
          ))}
        </g>
      );
    case "eye":
      return (
        <g transform="translate(16, 2)">
          <ellipse cx="0" cy="0" rx="4" ry="2.5" fill="none" stroke={color} strokeWidth="0.8" />
          <circle cx="0" cy="0" r="1.2" fill={color} />
        </g>
      );
    case "shield":
      return (
        <g transform="translate(16, 2)">
          <path d="M0,-3 L3.5,0 L2.5,3.5 L0,4.5 L-2.5,3.5 L-3.5,0 Z" fill="none" stroke={color} strokeWidth="0.8" />
          <path d="M0,-1 L1.5,0.5 L1,2 L0,2.5 L-1,2 L-1.5,0.5 Z" fill={color} opacity="0.4" />
        </g>
      );
    default:
      return null;
  }
}

export function AgentSprite({ direction, role, agentState = "idle" }: AgentSpriteProps) {
  const eyePos = {
    down: { lx: 12, rx: 20, y: 13 },
    up: { lx: 12, rx: 20, y: 11 },
    left: { lx: 9, rx: 15, y: 12 },
    right: { lx: 17, rx: 23, y: 12 },
  }[direction];

  const gazeOffset = {
    down: { x: 0, y: 0.7 },
    up: { x: 0, y: -0.7 },
    left: { x: -0.7, y: 0 },
    right: { x: 0.7, y: 0 },
  }[direction];

  const accessory = role ? ROLE_ACCESSORIES[role] : undefined;

  const stateClass =
    agentState === "working" ? "agent-working" :
    agentState === "in_meeting" || agentState === "heading_to_meeting" ? "agent-meeting" :
    agentState === "idle" ? "agent-idle" : "";

  return (
    <div className={stateClass}>
      <svg width="40" height="40" viewBox="0 0 32 32" overflow="visible">
        {/* Shadow */}
        <ellipse cx="16" cy="30" rx="10" ry="3" fill="rgba(0,0,0,0.35)" />

        {/* Body */}
        <rect x="7" y="17" width="18" height="12" rx="4" fill="currentColor" />

        {/* Head */}
        <circle cx="16" cy="12" r="9" fill="currentColor" />

        {/* Highlight */}
        <circle cx="14" cy="9" r="3" fill="rgba(255,255,255,0.15)" />

        {/* Role accessory (above head) */}
        {accessory && <RoleAccessory type={accessory.type} color={accessory.color} />}

        {/* Eyes */}
        {direction !== "up" && (
          <>
            <circle cx={eyePos.lx} cy={eyePos.y} r="2.5" fill="white" />
            <circle cx={eyePos.rx} cy={eyePos.y} r="2.5" fill="white" />
            <circle
              cx={eyePos.lx + gazeOffset.x}
              cy={eyePos.y + gazeOffset.y}
              r="1.2"
              fill="#1a1a1a"
            />
            <circle
              cx={eyePos.rx + gazeOffset.x}
              cy={eyePos.y + gazeOffset.y}
              r="1.2"
              fill="#1a1a1a"
            />
          </>
        )}
        {direction === "up" && (
          <path
            d="M 10 14 Q 16 17 22 14"
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="1.5"
            fill="none"
          />
        )}

        {/* Working indicator - small floating dots */}
        {agentState === "working" && (
          <g opacity="0.7">
            <circle cx="26" cy="6" r="1" fill="currentColor">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
            </circle>
            <circle cx="29" cy="4" r="0.7" fill="currentColor">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="31" cy="6" r="0.5" fill="currentColor">
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" begin="0.6s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </svg>
    </div>
  );
}
