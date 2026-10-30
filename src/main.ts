import "./style.css";
import { Game, isGoal } from "./game";
import { PitchRenderer } from "./render";
import type { GameEvent, PitchControlRequest, PitchControlResult } from "./types";
import PitchWorker from "./worker?worker";

// Grid resolution: coarser while playing so the worker keeps up.
const GRID_PLAYING = { nx: 53, ny: 34 };
const GRID_PAUSED = { nx: 106, ny: 68 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("pitch");
const playBtn = $<HTMLButtonElement>("play");
const scrub = $<HTMLInputElement>("scrub");
const clock = $("clock");
const scoreEl = $("score");
const speedSel = $<HTMLSelectElement>("speed");
const controlChk = $<HTMLInputElement>("show-control");
const velocityChk = $<HTMLInputElement>("show-velocity");
const filterSel = $<HTMLSelectElement>("event-filter");
const eventList = $("events");
const status = $("status");
const possessionEl = $("possession");

const renderer = new PitchRenderer(canvas);
const worker = new PitchWorker();

let game: Game;
let frame = 0; // 0-based frame index, fractional while playing
let playing = false;
let lastTick = 0;
let control: PitchControlResult | null = null;
let workerBusy = false;
let requestId = 0;
let computedFor = -1; // frame + grid the current control surface was requested for

function fmtClock(f: number) {
  const period = game.period(f);
  const t = game.periodTime(f) + (period === 2 ? 45 * 60 : 0);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function requestControl() {
  if (workerBusy || !controlChk.checked) return;
  const f = Math.floor(frame);
  const grid = playing ? GRID_PLAYING : GRID_PAUSED;
  const key = f * 1000 + grid.nx;
  if (key === computedFor) return;
  const ball = game.ball(f);
  if (!ball) return;
  const players = game.players(f).map(({ x, y, vx, vy, team, isGk }) => ({ x, y, vx, vy, team, isGk }));
  const req: PitchControlRequest = { id: ++requestId, players, ball, attacking: game.attacking(f), ...grid };
  workerBusy = true;
  computedFor = key;
  worker.postMessage(req);
}

worker.onmessage = (e: MessageEvent<PitchControlResult>) => {
  workerBusy = false;
  control = e.data;
  status.textContent = `Pitch control ${e.data.nx}×${e.data.ny} · ${e.data.ms.toFixed(0)} ms`;
  if (!playing) draw();
  requestControl();
};

function draw() {
  if (!game) return;
  const f = Math.floor(frame);
  const attacking = game.attacking(f);
  renderer.draw({
    control,
    showControl: controlChk.checked,
    showVelocity: velocityChk.checked,
    players: game.players(f),
    ball: game.ball(f),
    attacking,
  });
  scrub.value = String(f);
  const half = game.period(f) === 1 ? "1st half" : "2nd half";
  clock.textContent = `${fmtClock(f)} · ${half}`;
  const s = game.score(f);
  scoreEl.textContent = `${s.Home} – ${s.Away}`;
  possessionEl.textContent = `${attacking} in possession`;
  possessionEl.dataset.team = attacking;
  highlightEvent(f);
}

function seek(f: number) {
  frame = Math.max(0, Math.min(game.frameCount - 1, f));
  requestControl();
  draw();
}

function setPlaying(p: boolean) {
  playing = p;
  playBtn.textContent = p ? "Pause" : "Play";
  playBtn.setAttribute("aria-pressed", String(p));
  lastTick = performance.now();
  if (p) requestAnimationFrame(tick);
  else requestControl(); // refine at full resolution
}

function tick(now: number) {
  if (!playing) return;
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  frame += dt * game.meta.fps * Number(speedSel.value);
  if (frame >= game.frameCount - 1) {
    frame = game.frameCount - 1;
    setPlaying(false);
  }
  requestControl();
  draw();
  requestAnimationFrame(tick);
}

// ---- Event list ----

const FILTERS: Record<string, (e: GameEvent) => boolean> = {
  key: (e) => e.type === "SHOT" || (e.type === "SET PIECE" && e.subtype !== "KICK OFF") || isGoal(e),
  shots: (e) => e.type === "SHOT",
  goals: isGoal,
  all: () => true,
};

let listed: { event: GameEvent; el: HTMLElement }[] = [];

function renderEvents() {
  const filter = FILTERS[filterSel.value];
  eventList.replaceChildren();
  listed = [];
  for (const ev of game.meta.events) {
    if (!filter(ev)) continue;
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.dataset.team = ev.team;
    const goal = isGoal(ev);
    btn.innerHTML = `<span class="t">${fmtClock(ev.startFrame - 1)}</span>
      <span class="dot"></span>
      <span class="what">${goal ? "⚽ GOAL" : ev.type}${ev.subtype && !goal ? ` <small>${ev.subtype.toLowerCase()}</small>` : ""}</span>
      <span class="who">${ev.from.replace("Player", "#")}</span>`;
    btn.addEventListener("click", () => {
      seek(ev.startFrame - 1 - 3 * game.meta.fps); // 3 s of build-up
      setPlaying(true);
    });
    li.append(btn);
    eventList.append(li);
    listed.push({ event: ev, el: btn });
  }
}

let highlighted: HTMLElement | null = null;
function highlightEvent(f: number) {
  let current: HTMLElement | null = null;
  for (const { event, el } of listed) {
    if (event.startFrame - 1 <= f) current = el;
    else break;
  }
  if (current === highlighted) return;
  highlighted?.classList.remove("current");
  current?.classList.add("current");
  highlighted = current;
}

// ---- Wiring ----

playBtn.addEventListener("click", () => setPlaying(!playing));
scrub.addEventListener("input", () => seek(Number(scrub.value)));
controlChk.addEventListener("change", () => {
  computedFor = -1;
  requestControl();
  draw();
});
velocityChk.addEventListener("change", draw);
filterSel.addEventListener("change", () => {
  renderEvents();
  highlighted = null;
  draw();
});
window.addEventListener("resize", () => {
  renderer.resize();
  draw();
});
window.addEventListener("keydown", (e) => {
  if (!game) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const fps = game.meta.fps;
  if (e.code === "Space") {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === "ArrowRight") seek(Math.floor(frame) + (e.shiftKey ? 1 : 5 * fps));
  else if (e.key === "ArrowLeft") seek(Math.floor(frame) - (e.shiftKey ? 1 : 5 * fps));
});

async function init() {
  status.textContent = "Loading tracking data…";
  try {
    game = await Game.load(1);
  } catch (err) {
    status.textContent = String(err);
    return;
  }
  scrub.max = String(game.frameCount - 1);
  renderer.resize();
  renderEvents();
  seek(0);
  status.textContent = "Ready";
}

init();
