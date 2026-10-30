import { NO_DATA, type GameMeta, type PlayerState, type Team } from "./types";

/** Frames either side used for the central-difference velocity estimate. */
const VELOCITY_WINDOW = 5;
/** Anything faster than this is tracking noise. */
const MAX_SPEED = 12;

export class Game {
  readonly nEntities: number;
  readonly ballIndex: number;

  private constructor(
    readonly meta: GameMeta,
    private readonly data: Int16Array,
  ) {
    this.nEntities = meta.entities.length + 1;
    this.ballIndex = meta.entities.length;
  }

  static async load(game: number): Promise<Game> {
    const [meta, bin] = await Promise.all([
      fetch(`/data/game${game}.json`).then((r) => {
        if (!r.ok) throw new Error(`Missing game${game}.json — run "npm run prepare-data"`);
        return r.json() as Promise<GameMeta>;
      }),
      fetch(`/data/game${game}.bin`).then((r) => {
        if (!r.ok) throw new Error(`Missing game${game}.bin — run "npm run prepare-data"`);
        return r.arrayBuffer();
      }),
    ]);
    return new Game(meta, new Int16Array(bin));
  }

  get frameCount() {
    return this.meta.frameCount;
  }

  /** Position in metres of an entity at a 0-based frame index, or null if missing. */
  pos(f: number, e: number): [number, number] | null {
    const i = (f * this.nEntities + e) * 2;
    const x = this.data[i];
    if (x === NO_DATA) return null;
    return [x / 100, this.data[i + 1] / 100];
  }

  period(f: number): number {
    const frame = f + 1;
    for (const p of this.meta.periods) if (frame <= p.endFrame) return p.period;
    return this.meta.periods[this.meta.periods.length - 1].period;
  }

  /** Match clock in seconds since the start of the frame's period. */
  periodTime(f: number): number {
    const frame = f + 1;
    const p = this.meta.periods.find((p) => frame <= p.endFrame) ?? this.meta.periods[0];
    return (frame - p.startFrame) / this.meta.fps;
  }

  /** Ball position, falling back to the last known position when it's missing. */
  ball(f: number): [number, number] | null {
    for (let k = f; k >= Math.max(0, f - 250); k--) {
      const b = this.pos(k, this.ballIndex);
      if (b) return b;
    }
    return null;
  }

  players(f: number): (PlayerState & { index: number; number: number })[] {
    const out: (PlayerState & { index: number; number: number })[] = [];
    const period = this.period(f);
    const dt = 1 / this.meta.fps;
    this.meta.entities.forEach((ent, e) => {
      const p = this.pos(f, e);
      if (!p) return;
      // Central difference, shrinking the window at period edges or gaps.
      let vx = 0, vy = 0;
      for (let k = VELOCITY_WINDOW; k >= 1; k--) {
        const a = f - k, b = f + k;
        if (a < 0 || b >= this.frameCount || this.period(a) !== period || this.period(b) !== period) continue;
        const pa = this.pos(a, e), pb = this.pos(b, e);
        if (!pa || !pb) continue;
        vx = (pb[0] - pa[0]) / (2 * k * dt);
        vy = (pb[1] - pa[1]) / (2 * k * dt);
        break;
      }
      const speed = Math.hypot(vx, vy);
      if (speed > MAX_SPEED) {
        vx *= MAX_SPEED / speed;
        vy *= MAX_SPEED / speed;
      }
      out.push({ x: p[0], y: p[1], vx, vy, team: ent.team, isGk: ent.isGk, index: e, number: ent.number });
    });
    return out;
  }

  /** Team in possession at a 0-based frame index. */
  attacking(f: number): Team {
    const frame = f + 1;
    const pos = this.meta.possession;
    let lo = 0, hi = pos.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pos[mid][0] <= frame) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return pos[ans]?.[1] ?? "Home";
  }

  /** Goals scored by each team up to and including a 0-based frame index. */
  score(f: number): { Home: number; Away: number } {
    const s = { Home: 0, Away: 0 };
    for (const e of this.meta.events) {
      if (e.startFrame > f + 1) break;
      if (isGoal(e)) s[e.team]++;
    }
    return s;
  }
}

export const isGoal = (e: { type: string; subtype: string }) =>
  e.type === "SHOT" && /-GOAL$/.test(e.subtype);
