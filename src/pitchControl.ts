// Spearman (2018) "Beyond Expected Goals" pitch control model, following
// Laurie Shaw's Friends of Tracking implementation and default parameters.

import { PITCH_LENGTH, PITCH_WIDTH, type PlayerState, type Team } from "./types";

export const PARAMS = {
  maxPlayerAccel: 7, // m/s^2 (unused by the simple time-to-intercept model)
  maxPlayerSpeed: 5, // m/s
  reactionTime: 0.7, // s
  ttiSigma: 0.45, // uncertainty in time to intercept, s
  lambdaAtt: 4.3, // ball control rate, attacking
  lambdaDef: 4.3, // ball control rate, defending (kappa_def = 1)
  lambdaGk: 4.3 * 3, // goalkeepers control the ball faster when defending
  averageBallSpeed: 15, // m/s
  intDt: 0.04, // integration step, s
  maxIntTime: 10, // s
  convergeTol: 0.01,
};

const SIGMOID_K = Math.PI / Math.sqrt(3) / PARAMS.ttiSigma;
const timeToControl = (lambda: number) =>
  3 * Math.log(10) * ((Math.sqrt(3) * PARAMS.ttiSigma) / Math.PI + 1 / lambda);
const TIME_TO_CONTROL_ATT = timeToControl(PARAMS.lambdaAtt);
const TIME_TO_CONTROL_DEF = timeToControl(PARAMS.lambdaDef);

// Scratch buffers reused across cells to avoid allocation in the hot loop.
const MAX_PLAYERS = 32;
const ttiAtt = new Float64Array(MAX_PLAYERS);
const ttiDef = new Float64Array(MAX_PLAYERS);
const lamDef = new Float64Array(MAX_PLAYERS);
const ppcfAtt = new Float64Array(MAX_PLAYERS);
const ppcfDef = new Float64Array(MAX_PLAYERS);
const idxAtt = new Int32Array(MAX_PLAYERS);
const idxDef = new Int32Array(MAX_PLAYERS);

interface Prepared {
  // Position after the reaction time, assuming the player keeps their velocity.
  rx: Float64Array;
  ry: Float64Array;
  isGk: Uint8Array;
  n: number;
}

function prepare(players: PlayerState[]): Prepared {
  const n = Math.min(players.length, MAX_PLAYERS);
  const rx = new Float64Array(n), ry = new Float64Array(n), isGk = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = players[i];
    rx[i] = p.x + p.vx * PARAMS.reactionTime;
    ry[i] = p.y + p.vy * PARAMS.reactionTime;
    isGk[i] = p.isGk ? 1 : 0;
  }
  return { rx, ry, isGk, n };
}

function timeToIntercept(p: Prepared, i: number, tx: number, ty: number): number {
  return PARAMS.reactionTime + Math.hypot(tx - p.rx[i], ty - p.ry[i]) / PARAMS.maxPlayerSpeed;
}

const probIntercept = (tti: number, t: number) => 1 / (1 + Math.exp(-SIGMOID_K * (t - tti)));

/** Probability the attacking team controls the ball if it is played to (tx, ty). */
function ppcfAtTarget(tx: number, ty: number, att: Prepared, def: Prepared, ballX: number, ballY: number): number {
  const ballTravel = Math.hypot(tx - ballX, ty - ballY) / PARAMS.averageBallSpeed;

  let tauAtt = Infinity, tauDef = Infinity;
  for (let i = 0; i < att.n; i++) {
    ttiAtt[i] = timeToIntercept(att, i, tx, ty);
    if (ttiAtt[i] < tauAtt) tauAtt = ttiAtt[i];
  }
  for (let i = 0; i < def.n; i++) {
    ttiDef[i] = timeToIntercept(def, i, tx, ty);
    if (ttiDef[i] < tauDef) tauDef = ttiDef[i];
  }

  // One team gets there so much sooner that the other has no chance.
  if (tauAtt - Math.max(ballTravel, tauDef) >= TIME_TO_CONTROL_DEF) return 0;
  if (tauDef - Math.max(ballTravel, tauAtt) >= TIME_TO_CONTROL_ATT) return 1;

  // Only players who could plausibly arrive in time contribute.
  let nA = 0, nD = 0;
  for (let i = 0; i < att.n; i++) {
    if (ttiAtt[i] - tauAtt < TIME_TO_CONTROL_ATT) {
      idxAtt[nA] = i;
      ppcfAtt[nA] = 0;
      nA++;
    }
  }
  for (let i = 0; i < def.n; i++) {
    if (ttiDef[i] - tauDef < TIME_TO_CONTROL_DEF) {
      idxDef[nD] = i;
      ppcfDef[nD] = 0;
      lamDef[nD] = def.isGk[i] ? PARAMS.lambdaGk : PARAMS.lambdaDef;
      nD++;
    }
  }

  // Integrate the probability each player controls the ball over time.
  let totalAtt = 0, totalDef = 0;
  const steps = Math.round(PARAMS.maxIntTime / PARAMS.intDt);
  for (let s = 1; s < steps && 1 - totalAtt - totalDef > PARAMS.convergeTol; s++) {
    const t = ballTravel - PARAMS.intDt + s * PARAMS.intDt;
    const remaining = 1 - totalAtt - totalDef;
    let sumAtt = 0, sumDef = 0;
    for (let k = 0; k < nA; k++) {
      const d = remaining * probIntercept(ttiAtt[idxAtt[k]], t) * PARAMS.lambdaAtt;
      ppcfAtt[k] += Math.max(d, 0) * PARAMS.intDt;
      sumAtt += ppcfAtt[k];
    }
    for (let k = 0; k < nD; k++) {
      const d = remaining * probIntercept(ttiDef[idxDef[k]], t) * lamDef[k];
      ppcfDef[k] += Math.max(d, 0) * PARAMS.intDt;
      sumDef += ppcfDef[k];
    }
    totalAtt = sumAtt;
    totalDef = sumDef;
  }
  const total = totalAtt + totalDef;
  return total > 0 ? totalAtt / total : 0.5;
}

/**
 * Compute a pitch control surface on an nx × ny grid covering the pitch.
 * Returns the home team's control probability per cell, row-major with
 * row 0 at the top (positive y) of the pitch.
 */
export function computePitchControl(
  players: PlayerState[],
  ball: [number, number],
  attacking: Team,
  nx: number,
  ny: number,
): Float32Array {
  const att = prepare(players.filter((p) => p.team === attacking));
  const def = prepare(players.filter((p) => p.team !== attacking));
  const out = new Float32Array(nx * ny);
  const dx = PITCH_LENGTH / nx, dy = PITCH_WIDTH / ny;
  for (let j = 0; j < ny; j++) {
    const ty = PITCH_WIDTH / 2 - (j + 0.5) * dy;
    for (let i = 0; i < nx; i++) {
      const tx = -PITCH_LENGTH / 2 + (i + 0.5) * dx;
      const pAtt = ppcfAtTarget(tx, ty, att, def, ball[0], ball[1]);
      out[j * nx + i] = attacking === "Home" ? pAtt : 1 - pAtt;
    }
  }
  return out;
}
