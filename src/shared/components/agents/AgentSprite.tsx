import type { Direction } from "../../agent/Agent";

export function AgentSprite({ direction }: { direction: Direction }) {
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

  return (
    <svg width="40" height="40" viewBox="0 0 32 32" overflow="visible">
      <ellipse cx="16" cy="30" rx="10" ry="3" fill="rgba(0,0,0,0.3)" />
      <rect x="7" y="17" width="18" height="12" rx="4" fill="currentColor" />
      <circle cx="16" cy="12" r="9" fill="currentColor" />
      <circle cx="14" cy="9" r="3" fill="rgba(255,255,255,0.15)" />
      {direction !== "up" && (
        <>
          <circle cx={eyePos.lx} cy={eyePos.y} r="2.5" fill="white" />
          <circle cx={eyePos.rx} cy={eyePos.y} r="2.5" fill="white" />
          <circle
            cx={eyePos.lx + gazeOffset.x}
            cy={eyePos.y + gazeOffset.y}
            r="1.2"
            fill="#1a1a2e"
          />
          <circle
            cx={eyePos.rx + gazeOffset.x}
            cy={eyePos.y + gazeOffset.y}
            r="1.2"
            fill="#1a1a2e"
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
    </svg>
  );
}
