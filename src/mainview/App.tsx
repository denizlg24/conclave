import { Agent } from "../shared/agent/Agent";
import { AgentSprite } from "../shared/components/agents/AgentSprite";
import { useEffect, useRef, useState } from "react";

const AGENT_COLORS = [
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#eab308",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export default function App() {
  const [agents] = useState<Agent[]>(() =>
    Array.from({ length: 5 }, (_, i) =>
      new Agent({
        config: { id: `agent-${i}` },
        display: {
          color: AGENT_COLORS[i],
          position: { x: 200 + i * 150, y: 200 + (i % 3) * 100 },
          bounds: { x: 1150, y: 600 },
          moveSpeed: 80 + Math.random() * 100,
        },
      }),
    ),
  );

  const [, setTick] = useState(0);
  const moveTimers = useRef(new Map<string, number>());

  useEffect(() => {
    agents.forEach((agent) => agent.display());

    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;

      for (const agent of agents) {
        const nextMove = moveTimers.current.get(agent.id) ?? 0;
        if (now < nextMove) continue;

        const targetX = 40 + Math.random() * (agent.bounds.x - 80);
        const targetY = 40 + Math.random() * (agent.bounds.y - 80);
        const duration = agent.moveTo(targetX, targetY);

        agent.display();

        const pause = 800 + Math.random() * 2500;
        moveTimers.current.set(agent.id, now + duration * 1000 + pause);
        changed = true;
      }

      if (changed) setTick((t) => t + 1);
    }, 150);

    return () => clearInterval(interval);
  }, [agents]);

  return (
    <main className="bg-[url(/office_bg.png)] w-full h-screen bg-contain bg-no-repeat bg-black relative overflow-hidden">
      {agents.map((agent) => (
        <div
          key={agent.id}
          id={agent.id}
          className="absolute"
          style={{ color: agent.color }}
        >
          <AgentSprite direction={agent.facingDirection} />
        </div>
      ))}
    </main>
  );
}
