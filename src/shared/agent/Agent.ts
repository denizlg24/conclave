export type Direction = "up" | "down" | "left" | "right";

export interface IAgentConstructor {
  config: {
    id: string;
  };
  display: {
    color: string;
    position?: { x: number; y: number };
    bounds?: { x: number; y: number };
    moveSpeed?: number;
  };
}

export class Agent {
  id: string;
  color: string;
  position: { x: number; y: number };
  bounds: { x: number; y: number };
  moveSpeed: number;
  facingDirection: Direction = "down";
  private animationDuration = 0;

  constructor(options: IAgentConstructor) {
    this.id = options.config.id;
    this.color = options.display.color;
    this.position = options.display.position ?? { x: 0, y: 0 };
    this.bounds = options.display.bounds ?? { x: 1000, y: 1000 };
    this.moveSpeed = options.display.moveSpeed ?? 120;
  }

  setColor(color: string) {
    this.color = color;
  }

  moveTo(x: number, y: number): number {
    x = Math.max(0, Math.min(x, this.bounds.x));
    y = Math.max(0, Math.min(y, this.bounds.y));

    const dx = x - this.position.x;
    const dy = y - this.position.y;

    if (dx === 0 && dy === 0) return 0;

    if (Math.abs(dx) > Math.abs(dy)) {
      this.facingDirection = dx > 0 ? "right" : "left";
    } else {
      this.facingDirection = dy > 0 ? "down" : "up";
    }

    const distance = Math.sqrt(dx * dx + dy * dy);
    this.animationDuration = distance / this.moveSpeed;
    this.position = { x, y };

    return this.animationDuration;
  }

  display() {
    const el = document.getElementById(this.id);
    if (!el) return;

    el.style.transition = `left ${this.animationDuration}s ease-in-out, top ${this.animationDuration}s ease-in-out`;
    el.style.left = `${this.position.x}px`;
    el.style.top = `${this.position.y}px`;
    el.dataset.direction = this.facingDirection;
    el.style.color = this.color;
  }
}
