export const PITCH_LENGTH = 106;
export const PITCH_WIDTH = 68;
/** Sentinel for a missing coordinate in the Int16 tracking buffer. */
export const NO_DATA = -32768;

export type Team = "Home" | "Away";

export interface EntityMeta {
  id: string;
  number: number;
  team: Team;
  isGk: boolean;
}

export interface GameEvent {
  team: Team;
  type: string;
  subtype: string;
  period: number;
  startFrame: number;
  startTime: number;
  endFrame: number;
  from: string;
  to: string;
  start: [number, number] | null;
  end: [number, number] | null;
}

export interface GameMeta {
  game: number;
  fps: number;
  frameCount: number;
  /** Players only; the ball is stored after them in the tracking buffer. */
  entities: EntityMeta[];
  periods: { period: number; startFrame: number; endFrame: number }[];
  events: GameEvent[];
  /** [frame, team] change points, sorted by frame. */
  possession: [number, Team][];
}

/** A player's state at one frame, in metres and metres/second. */
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  team: Team;
  isGk: boolean;
}

export interface PitchControlRequest {
  id: number;
  players: PlayerState[];
  ball: [number, number];
  attacking: Team;
  nx: number;
  ny: number;
}

export interface PitchControlResult {
  id: number;
  nx: number;
  ny: number;
  /** Probability the home team controls each cell, row-major from the top-left. */
  home: Float32Array;
  ms: number;
}
