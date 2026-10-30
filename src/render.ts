import { PITCH_LENGTH, PITCH_WIDTH, type PitchControlResult, type PlayerState } from "./types";

export const COLORS = {
  Home: [46, 117, 230] as const,
  Away: [224, 66, 62] as const,
  neutral: [244, 244, 240] as const,
  grass: "#1d2a22",
  lines: "rgba(255,255,255,0.75)",
};

const css = (c: readonly number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;

export interface DrawOptions {
  control: PitchControlResult | null;
  showControl: boolean;
  showVelocity: boolean;
  players: (PlayerState & { number: number })[];
  ball: [number, number] | null;
  attacking: "Home" | "Away";
}

export class PitchRenderer {
  private ctx: CanvasRenderingContext2D;
  private heat = document.createElement("canvas");
  private heatCtx = this.heat.getContext("2d")!;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    const margin = 4; // metres around the pitch
    this.scale = Math.min(
      this.canvas.width / (PITCH_LENGTH + 2 * margin),
      this.canvas.height / (PITCH_WIDTH + 2 * margin),
    );
    this.ox = this.canvas.width / 2;
    this.oy = this.canvas.height / 2;
  }

  /** Pitch metres (origin centre, y up) to canvas pixels. */
  private px(x: number, y: number): [number, number] {
    return [this.ox + x * this.scale, this.oy - y * this.scale];
  }

  draw(o: DrawOptions) {
    const { ctx, scale } = this;
    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const [x0, y0] = this.px(-PITCH_LENGTH / 2, PITCH_WIDTH / 2);
    const w = PITCH_LENGTH * scale, h = PITCH_WIDTH * scale;

    if (o.showControl && o.control) {
      this.paintHeat(o.control);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.heat, x0, y0, w, h);
      ctx.restore();
    }

    this.drawLines();

    if (o.showVelocity) {
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      for (const p of o.players) {
        const [a, b] = this.px(p.x, p.y);
        const [c, d] = this.px(p.x + p.vx, p.y + p.vy);
        ctx.beginPath();
        ctx.moveTo(a, b);
        ctx.lineTo(c, d);
        ctx.stroke();
      }
    }

    const r = Math.max(0.9 * scale, 7 * this.dpr);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(r * 1.05)}px system-ui, sans-serif`;
    for (const p of o.players) {
      const [cx, cy] = this.px(p.x, p.y);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = css(COLORS[p.team]);
      ctx.fill();
      ctx.lineWidth = (p.isGk ? 3 : 1.5) * this.dpr;
      ctx.strokeStyle = p.isGk ? "#f5d547" : "#fff";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.fillText(String(p.number), cx, cy + 0.5);
    }

    if (o.ball) {
      const [bx, by] = this.px(o.ball[0], o.ball[1]);
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(0.45 * scale, 4 * this.dpr), 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.strokeStyle = "#111";
      ctx.stroke();
    }
  }

  /** Diverging blue–white–red colour map, one pixel per grid cell. */
  private paintHeat(c: PitchControlResult) {
    if (this.heat.width !== c.nx || this.heat.height !== c.ny) {
      this.heat.width = c.nx;
      this.heat.height = c.ny;
    }
    const img = this.heatCtx.createImageData(c.nx, c.ny);
    const H = COLORS.Home, A = COLORS.Away, N = COLORS.neutral;
    for (let i = 0; i < c.home.length; i++) {
      const p = c.home[i];
      const [from, t] = p >= 0.5 ? [H, (p - 0.5) * 2] : [A, (0.5 - p) * 2];
      const k = Math.pow(t, 0.8);
      img.data[i * 4] = N[0] + (from[0] - N[0]) * k;
      img.data[i * 4 + 1] = N[1] + (from[1] - N[1]) * k;
      img.data[i * 4 + 2] = N[2] + (from[2] - N[2]) * k;
      img.data[i * 4 + 3] = 255;
    }
    this.heatCtx.putImageData(img, 0, 0);
  }

  private drawLines() {
    const { ctx, scale } = this;
    const L = PITCH_LENGTH / 2, W = PITCH_WIDTH / 2;
    ctx.strokeStyle = COLORS.lines;
    ctx.lineWidth = 1.5 * this.dpr;

    const rect = (x1: number, y1: number, x2: number, y2: number) => {
      const [a, b] = this.px(x1, y1);
      const [c, d] = this.px(x2, y2);
      ctx.strokeRect(a, b, c - a, d - b);
    };
    const circle = (x: number, y: number, r: number, fill = false) => {
      const [a, b] = this.px(x, y);
      ctx.beginPath();
      ctx.arc(a, b, r, 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = COLORS.lines;
        ctx.fill();
      } else ctx.stroke();
    };

    rect(-L, W, L, -W);
    const [mx, my1] = this.px(0, W);
    const [, my2] = this.px(0, -W);
    ctx.beginPath();
    ctx.moveTo(mx, my1);
    ctx.lineTo(mx, my2);
    ctx.stroke();
    circle(0, 0, 9.15 * scale);
    circle(0, 0, 0.3 * scale, true);

    for (const s of [-1, 1]) {
      const g = s * L;
      rect(g, 20.16, g - s * 16.5, -20.16); // penalty area
      rect(g, 9.16, g - s * 5.5, -9.16); // six-yard box
      rect(g, 3.66, g + s * 1.5, -3.66); // goal
      circle(g - s * 11, 0, 0.3 * scale, true);
      // Penalty arc: the part of the 9.15 m circle outside the box.
      const [ax, ay] = this.px(g - s * 11, 0);
      const a = Math.acos(5.5 / 9.15);
      ctx.beginPath();
      if (s > 0) ctx.arc(ax, ay, 9.15 * scale, Math.PI - a, Math.PI + a);
      else ctx.arc(ax, ay, 9.15 * scale, -a, a);
      ctx.stroke();
    }
  }
}
