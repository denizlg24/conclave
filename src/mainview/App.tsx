import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from "react";
import { Agent, type AgentState } from "../shared/agent/Agent";
import { AgentSprite } from "../shared/components/agents/AgentSprite";
import { ConclaveProvider, useConclave } from "./hooks/use-conclave";
import { GameHUD } from "./components/GameHUD";
import { ProjectScreen } from "./components/ProjectScreen";
import { AgentPanel } from "./components/AgentPanel";
import { QuotaExhaustedDialog } from "./components/QuotaExhaustedDialog";
import type { SerializedAgentInfo } from "../shared/rpc/rpc-schema";
import officeBg from "./assets/office_bg.png";

const APP_WIDTH_VAR = "--app-width";
const APP_HEIGHT_VAR = "--app-height";

function readAppViewportSize(): { width: number; height: number } {
  const root = document.getElementById("root");
  const viewportWidths = [
    window.visualViewport?.width,
    document.documentElement.clientWidth,
    document.body?.clientWidth,
    root?.clientWidth,
    window.innerWidth,
  ].filter((width): width is number => typeof width === "number" && width > 0);
  const viewportHeights = [
    window.visualViewport?.height,
    document.documentElement.clientHeight,
    document.body?.clientHeight,
    root?.clientHeight,
    window.innerHeight,
  ].filter((height): height is number => typeof height === "number" && height > 0);

  return {
    width:
      viewportWidths.length > 0 ? Math.round(Math.min(...viewportWidths)) : 0,
    height:
      viewportHeights.length > 0
        ? Math.round(Math.min(...viewportHeights))
        : 0,
  };
}

function syncAppViewport() {
  const { width, height } = readAppViewportSize();

  if (width > 0) {
    document.documentElement.style.setProperty(APP_WIDTH_VAR, `${width}px`);
  }
  if (height > 0) {
    document.documentElement.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
  }
}

syncAppViewport();

const WORKSTATIONS: Array<{ x: number; y: number; label: string }> = [
  { x: 480, y: 552, label: "Desk A1" },
  { x: 624, y: 552, label: "Desk A2" },
  { x:744, y: 552, label: "Desk B1" },
  { x: 896, y: 552, label: "Desk B2" },
  { x: 896, y: 440, label: "Desk C1" },
  { x: 528, y: 400, label: "Desk C2" },
  { x: 512, y: 200, label: "Desk D1" },
  { x: 640, y: 200, label: "Desk D2" },
];

const PM_STATION = { x: 168, y: 435 };

const ROLE_DESK_PREFERENCES: Record<string, number[]> = {
  pm: [],
  developer: [0, 1, 2, 3],
  reviewer: [4, 5],
  tester: [6, 7],
};

const MEETING_CENTER = { x: 175, y: 580 };
const MEETING_RADIUS_X = 100;
const MEETING_RADIUS_Y = 150;

function meetingSeat(index: number, total: number): { x: number; y: number } {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: MEETING_CENTER.x + Math.cos(angle) * MEETING_RADIUS_X,
    y: MEETING_CENTER.y + Math.sin(angle) * MEETING_RADIUS_Y,
  };
}

const occupiedDesks = new Set<number>();

function assignDesk(role: string): { x: number; y: number; deskIdx: number | null } {
  if (role === "pm") return { ...PM_STATION, deskIdx: null };
  
  const prefs = ROLE_DESK_PREFERENCES[role] ?? [0, 1, 2, 3];
  
  for (const deskIdx of prefs) {
    if (!occupiedDesks.has(deskIdx)) {
      occupiedDesks.add(deskIdx);
      return { ...WORKSTATIONS[deskIdx], deskIdx };
    }
  }
  
  for (let i = 0; i < WORKSTATIONS.length; i++) {
    if (!occupiedDesks.has(i)) {
      occupiedDesks.add(i);
      return { ...WORKSTATIONS[i], deskIdx: i };
    }
  }
  
  const fallbackIdx = prefs[0] ?? 0;
  return { ...WORKSTATIONS[fallbackIdx], deskIdx: fallbackIdx };
}

function getDeskPosition(deskIdx: number | null, role: string): { x: number; y: number } {
  if (role === "pm" || deskIdx === null) return PM_STATION;
  return WORKSTATIONS[deskIdx] ?? WORKSTATIONS[0];
}

const ROLE_COLORS: Record<string, string> = {
  pm: "#c8a96e",
  developer: "#a1bc98",
  reviewer: "#e07a5f",
  tester: "#f2cc8f",
};

const ROLE_LABELS: Record<string, string> = {
  pm: "PM",
  developer: "DEV",
  reviewer: "REV",
  tester: "QA",
};

interface Toast {
  id: string;
  message: string;
  color: string;
  timestamp: number;
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="absolute top-10 left-1/2 -translate-x-1/2 flex flex-col gap-1.5 z-40 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="rpg-toast flex items-center gap-2"
          style={{ borderLeftWidth: 3, borderLeftColor: toast.color }}
        >
          <span className="text-[11px] rpg-mono" style={{ color: toast.color }}>
            {toast.message}
          </span>
        </div>
      ))}
    </div>
  );
}

function AgentLabel({
  label,
  status,
  agentState,
  color,
}: {
  label: string;
  status?: string;
  agentState: AgentState;
  color: string;
}) {
  const stateText =
    agentState === "working" && status ? status :
    agentState === "heading_to_meeting" ? "moving" :
    agentState === "in_meeting" ? "in council" :
    agentState === "returning" ? "returning" :
    "";

  return (
    <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none">
      <span
        className="rpg-mono text-[11px] px-1.5 py-0.5 inline-flex items-center gap-1"
        style={{
          background: "rgba(20, 26, 20, 0.85)",
          border: "1px solid rgba(58, 74, 53, 0.6)",
          color: "var(--rpg-text)",
        }}
      >
        <span style={{ color }}>{label}</span>
        {stateText && (
          <span style={{ color: "var(--rpg-text-dim)", fontSize: "8px" }}>
            {stateText}
          </span>
        )}
      </span>
    </div>
  );
}

function GameScene() {
  const { readModel, events, agentEvents, agentRoster } = useConclave();
  const tasks = readModel?.tasks ?? [];
  const meetings = readModel?.meetings ?? [];

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const roleCounterRef = useRef<Map<string, number>>(new Map());

  const agentMapRef = useRef<Map<string, { agent: Agent; info: SerializedAgentInfo; deskIdx: number | null }>>(new Map());

  const agents = useMemo(() => {
    const map = agentMapRef.current;
    const currentIds = new Set(agentRoster.map((a) => a.agentId));

    // Remove agents no longer in the roster
    for (const [id, entry] of map) {
      if (!currentIds.has(id)) {
        if (entry.deskIdx !== null) occupiedDesks.delete(entry.deskIdx);
        map.delete(id);
      }
    }

    // Full reset when all agents are gone (project reload or empty roster)
    if (map.size === 0) {
      occupiedDesks.clear();
      roleCounterRef.current = new Map();
    }

    for (const info of agentRoster) {
      const existing = map.get(info.agentId);
      if (existing) {
        // Update info to keep role/session data fresh
        existing.info = info;
      } else {
        const counter = roleCounterRef.current;
        const roleIdx = counter.get(info.role) ?? 0;
        counter.set(info.role, roleIdx + 1);

        const desk = assignDesk(info.role);
        const color = ROLE_COLORS[info.role] ?? "#8a9484";

        map.set(info.agentId, {
          info,
          deskIdx: desk.deskIdx,
          agent: new Agent({
            config: { id: info.agentId },
            display: {
              color,
              position: { x: desk.x, y: desk.y },
              bounds: { x: 1100, y: 520 },
              moveSpeed: 70 + Math.random() * 60,
            },
          }),
        });
      }
    }

    return [...map.values()];
  }, [agentRoster]);

  const addToast = useCallback((message: string, color: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, color, timestamp: Date.now() }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const prevEventsLenForToasts = useRef(0);
  useEffect(() => {
    if (events.length <= prevEventsLenForToasts.current) return;

    const newEvents = events.slice(prevEventsLenForToasts.current);
    prevEventsLenForToasts.current = events.length;

    for (const evt of newEvents) {
      switch (evt.type) {
        case "TaskStatusChanged": {
          const status = evt.payload.status as string;
          const title = evt.payload.title as string ?? "Task";
          if (status === "done") {
            addToast(`Quest Complete: ${title}`, "#6a994e");
          } else if (status === "failed") {
            addToast(`Quest Failed: ${title}`, "#c45c4a");
          } else if (status === "in_progress") {
            addToast(`Quest Started: ${title}`, "#81b29a");
          }
          break;
        }
        case "MeetingStarted":
          addToast("Council convened", "#c8a96e");
          break;
        case "MeetingCompleted":
          addToast("Council adjourned", "#c8a96e");
          break;
      }
    }
  }, [events.length, events, addToast]);

  const [, setTick] = useState(0);
  const prevEventsLen = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    if (events.length === prevEventsLen.current) return;
    prevEventsLen.current = events.length;

    const activeMeeting = meetings.find((m) => m.status === "in_progress");

    for (const { agent, info, deskIdx } of agents) {
      const hasActiveTask = tasks.some(
        (t) => t.owner === info.agentId && t.status === "in_progress",
      );
      const inMeeting =
        activeMeeting?.participants.includes(info.role) ?? false;

      if (inMeeting && agent.agentState !== "in_meeting") {
        const seatIdx = agents.indexOf(
          agents.find((a) => a.info.agentId === info.agentId)!,
        );
        const seat = meetingSeat(seatIdx, agents.length);
        agent.transitionTo("heading_to_meeting", seat);
      } else if (!inMeeting && agent.agentState === "in_meeting") {
        const desk = getDeskPosition(deskIdx, info.role);
        agent.transitionTo("returning", desk);
      } else if (
        hasActiveTask &&
        !inMeeting &&
        agent.agentState !== "working"
      ) {
        agent.transitionTo("working", getDeskPosition(deskIdx, info.role));
      } else if (
        !hasActiveTask &&
        !inMeeting &&
        agent.agentState === "working"
      ) {
        agent.transitionTo("idle", getDeskPosition(deskIdx, info.role));
      }
    }
    setTick((t) => t + 1);
  }, [events.length, agents, meetings, tasks]);

  useEffect(() => {
    agents.forEach(({ agent }) => agent.display());

    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const currentTasks = tasksRef.current;

      for (const { agent, info, deskIdx } of agents) {
        const hasActiveTask = currentTasks.some(
          (t) => t.owner === info.agentId && t.status === "in_progress",
        );

        if (
          agent.agentState === "heading_to_meeting" &&
          agent.hasArrived(now)
        ) {
          agent.agentState = "in_meeting";
          changed = true;
        }
        if (agent.agentState === "returning" && agent.hasArrived(now)) {
          agent.agentState = hasActiveTask ? "working" : "idle";
          changed = true;
        }

        if (agent.agentState === "idle" && hasActiveTask) {
          agent.agentState = "working";
          changed = true;
        }

        if (agent.agentState === "working" && !hasActiveTask) {
          agent.agentState = "idle";
          changed = true;
        }

        if (agent.agentState === "idle" && agent.hasArrived(now)) {
          const desk = getDeskPosition(deskIdx, info.role);
          const wanderX = desk.x;
          const wanderY = desk.y;
          agent.moveTo(wanderX, wanderY);
          agent.display();
          changed = true;
        }
      }

      if (changed) setTick((t) => t + 1);
    }, 500);

    return () => clearInterval(interval);
  }, [agents]);

  const agentTaskMap: Record<string, string | undefined> = {};
  for (const task of tasks) {
    if (task.owner && ["in_progress", "review"].includes(task.status)) {
      agentTaskMap[task.owner] = task.title.slice(0, 18);
    }
  }

  const selectedAgentEvents = selectedAgentId
    ? agentEvents.filter((e) => e.agentId === selectedAgentId)
    : [];
  const selectedAgentTasks = selectedAgentId
    ? tasks.filter((t) => t.owner === selectedAgentId)
    : [];
  const selectedEntry = agents.find(
    (a) => a.info.agentId === selectedAgentId,
  );

  return (
    <main
      className="conclave-scene w-full h-full bg-center bg-no-repeat relative overflow-hidden"
      style={{
        backgroundImage: `url(${officeBg})`,
        backgroundSize: "contain",
        backgroundColor: "var(--rpg-bg)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at center, transparent 50%, rgba(14, 18, 14, 0.4) 100%)",
        }}
      />
      <div className="conclave-scene__scrim pointer-events-none absolute inset-0" />
      <div className="conclave-scene__grid pointer-events-none absolute inset-0" />

      <ToastContainer toasts={toasts} />

      {agents.map(({ agent, info }) => {
        const label = ROLE_LABELS[info.role] ?? info.role.toUpperCase();
        const roleAgents = agents.filter((a) => a.info.role === info.role);
        const displayLabel =
          roleAgents.length > 1
            ? `${label}-${roleAgents.indexOf(agents.find((a) => a.info.agentId === info.agentId)!) + 1}`
            : label;

        return (
          <div
            key={info.agentId}
            id={info.agentId}
            className="absolute cursor-pointer"
            style={{ color: agent.color }}
            onClick={() =>
              setSelectedAgentId((prev) =>
                prev === info.agentId ? null : info.agentId,
              )
            }
          >
            <AgentLabel
              label={displayLabel}
              status={agentTaskMap[info.agentId]}
              agentState={agent.agentState}
              color={agent.color}
            />
            <AgentSprite
              direction={agent.facingDirection}
              role={info.role}
              agentState={agent.agentState}
            />
          </div>
        );
      })}

      <GameHUD />

      {selectedAgentId && selectedEntry && (
        <AgentPanel
          role={selectedEntry.info.role}
          label={
            ROLE_LABELS[selectedEntry.info.role] ?? selectedEntry.info.agentId
          }
          color={ROLE_COLORS[selectedEntry.info.role] ?? "#8a9484"}
          agentState={selectedEntry.agent.agentState}
          tasks={selectedAgentTasks}
          agentEvents={selectedAgentEvents}
          onClose={() => setSelectedAgentId(null)}
        />
      )}
    </main>
  );
}

function AppRouter() {
  const { activeProject, connected } = useConclave();
  const [sceneReady, setSceneReady] = useState(false);

  // useLayoutEffect ensures --app-height is set synchronously after DOM
  // mutation but before the browser paints, preventing the bottom bar from
  // rendering offscreen on the first frame after project load.
  useLayoutEffect(() => {
    setSceneReady(false);
    syncAppViewport();

    const animationFrames = new Set<number>();
    const timeouts = new Set<number>();
    const schedule = () => {
      const frameId = requestAnimationFrame(() => {
        animationFrames.delete(frameId);
        syncAppViewport();
      });
      animationFrames.add(frameId);
    };
    const scheduleTimeout = (delayMs: number) => {
      const timeoutId = window.setTimeout(() => {
        timeouts.delete(timeoutId);
        schedule();
      }, delayMs);
      timeouts.add(timeoutId);
    };
    const resizeObserver = new ResizeObserver(() => {
      schedule();
    });
    const root = document.getElementById("root");

    resizeObserver.observe(document.documentElement);
    if (document.body) {
      resizeObserver.observe(document.body);
    }
    if (root) {
      resizeObserver.observe(root);
    }

    schedule();
    scheduleTimeout(0);
    scheduleTimeout(100);
    scheduleTimeout(250);
    void document.fonts?.ready.then(() => {
      schedule();
    });

    const revealFrameId = requestAnimationFrame(() => {
      const secondRevealFrameId = requestAnimationFrame(() => {
        animationFrames.delete(secondRevealFrameId);
        syncAppViewport();
        setSceneReady(true);
      });
      animationFrames.add(secondRevealFrameId);
      animationFrames.delete(revealFrameId);
    });
    animationFrames.add(revealFrameId);
    scheduleTimeout(180);
    const revealTimeoutId = window.setTimeout(() => {
      timeouts.delete(revealTimeoutId);
      syncAppViewport();
      setSceneReady(true);
    }, 180);
    timeouts.add(revealTimeoutId);

    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);

      for (const timeoutId of timeouts) {
        window.clearTimeout(timeoutId);
      }
      for (const frameId of animationFrames) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [activeProject]);

  if (!connected) {
    return (
      <main
        className="flex items-center justify-center overflow-hidden"
        style={{
          width: "100%",
          height: "100%",
          background: "var(--rpg-bg)",
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div
            className="rpg-font text-[14px] tracking-widest"
            style={{ color: "var(--rpg-gold)" }}
          >
            CONCLAVE
          </div>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: "var(--rpg-gold-dim)" }}
            />
            <span
              className="rpg-mono text-[11px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              Establishing connection...
            </span>
          </div>
        </div>
      </main>
    );
  }

  if (!activeProject) {
    if (!sceneReady) {
      return (
        <main
          className="flex items-center justify-center overflow-hidden"
          style={{
            width: "100%",
            height: "100%",
            background: "var(--rpg-bg)",
          }}
        >
          <div className="flex flex-col items-center gap-2">
            <div
              className="rpg-font text-[12px] tracking-[0.2em]"
              style={{ color: "var(--rpg-gold-dim)" }}
            >
              ENTERING CONCLAVE
            </div>
            <div
              className="rpg-mono text-[10px]"
              style={{ color: "var(--rpg-text-muted)" }}
            >
              Stabilizing viewport...
            </div>
          </div>
        </main>
      );
    }

    return <ProjectScreen />;
  }

  if (!sceneReady) {
    return (
      <main
        className="flex items-center justify-center overflow-hidden"
        style={{
          width: "100%",
          height: "100%",
          background: "var(--rpg-bg)",
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div
            className="rpg-font text-[12px] tracking-[0.2em]"
            style={{ color: "var(--rpg-gold-dim)" }}
          >
            ENTERING WAR ROOM
          </div>
          <div
            className="rpg-mono text-[10px]"
            style={{ color: "var(--rpg-text-muted)" }}
          >
            Stabilizing viewport...
          </div>
        </div>
      </main>
    );
  }

  return <GameScene key={activeProject.id} />;
}

export default function App() {
  return (
    <ConclaveProvider>
      <div className="w-full overflow-hidden" style={{ height: "100%" }}>
        <AppRouter />
      </div>
      <QuotaExhaustedDialog />
    </ConclaveProvider>
  );
}
