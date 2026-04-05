import { useEffect, useRef, useState } from "react";
import { Agent } from "../shared/agent/Agent";
import { AgentSprite } from "../shared/components/agents/AgentSprite";
import { ConclaveProvider, useConclave } from "./hooks/use-conclave";
import { GameHUD } from "./components/GameHUD";

const ROLE_CONFIG = [
  { id: "pm", label: "PM", color: "#a855f7" },
  { id: "dev", label: "DEV", color: "#3b82f6" },
  { id: "reviewer", label: "QA", color: "#22c55e" },
] as const;

function AgentLabel({ label, status }: { label: string; status?: string }) {
  return (
    <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
      <span
        className="text-[9px] px-1.5 py-0.5 rounded-sm bg-black/70 border border-white/15 text-white/80"
        style={{ fontFamily: "monospace" }}
      >
        {label}
        {status && (
          <span className="text-white/40 ml-1">{status}</span>
        )}
      </span>
    </div>
  );
}

function GameScene() {
  const { readModel } = useConclave();
  const tasks = readModel?.tasks ?? [];

  const [agents] = useState<Agent[]>(() =>
    ROLE_CONFIG.map(
      (cfg, i) =>
        new Agent({
          config: { id: cfg.id },
          display: {
            color: cfg.color,
            position: { x: 200 + i * 250, y: 250 + (i % 2) * 80 },
            bounds: { x: 1100, y: 550 },
            moveSpeed: 60 + Math.random() * 80,
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

        const targetX = 60 + Math.random() * (agent.bounds.x - 120);
        const targetY = 100 + Math.random() * (agent.bounds.y - 160);
        const duration = agent.moveTo(targetX, targetY);
        agent.display();

        const pause = 1500 + Math.random() * 3000;
        moveTimers.current.set(agent.id, now + duration * 1000 + pause);
        changed = true;
      }

      if (changed) setTick((t) => t + 1);
    }, 200);

    return () => clearInterval(interval);
  }, [agents]);

  // Map agent roles to their current task status
  const roleTaskMap: Record<string, string | undefined> = {};
  for (const task of tasks) {
    if (task.owner && ["in_progress", "review"].includes(task.status)) {
      const role = task.ownerRole;
      if (role === "pm") roleTaskMap["pm"] = task.title.slice(0, 15);
      if (role === "developer") roleTaskMap["dev"] = task.title.slice(0, 15);
      if (role === "reviewer") roleTaskMap["reviewer"] = task.title.slice(0, 15);
    }
  }

  return (
    <main className="bg-[url(/office_bg.png)] w-full h-screen bg-contain bg-no-repeat bg-black relative overflow-hidden">
      {/* Agents */}
      {agents.map((agent) => {
        const cfg = ROLE_CONFIG.find((r) => r.id === agent.id);
        return (
          <div
            key={agent.id}
            id={agent.id}
            className="absolute"
            style={{ color: agent.color }}
          >
            <AgentLabel
              label={cfg?.label ?? agent.id}
              status={roleTaskMap[agent.id]}
            />
            <AgentSprite direction={agent.facingDirection} />
          </div>
        );
      })}

      {/* HUD overlay */}
      <GameHUD />
    </main>
  );
}

export default function App() {
  return (
    <ConclaveProvider>
      <GameScene />
    </ConclaveProvider>
  );
}
