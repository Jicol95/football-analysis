// Downloads a Metrica sample game and converts it into a compact binary
// tracking file plus a JSON metadata file the browser app can load quickly.
//
// Output (public/data/):
//   game<N>.bin  - Int16 positions in centimetres, [frame][entity][x,y],
//                  NO_DATA marks a missing value. Ball is the last entity.
//   game<N>.json - players, periods, events and possession timeline.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { PITCH_LENGTH, PITCH_WIDTH, NO_DATA, type GameMeta, type EntityMeta, type GameEvent } from "../src/types.ts";

const game = Number(process.argv[2] ?? 1);
if (game !== 1 && game !== 2) throw new Error("Only games 1 and 2 use the CSV format");

const BASE = `https://raw.githubusercontent.com/metrica-sports/sample-data/master/data/Sample_Game_${game}`;
const RAW_DIR = join("data-raw", `game${game}`);
const OUT_DIR = join("public", "data");

async function download(name: string): Promise<string> {
  const path = join(RAW_DIR, name);
  try {
    await access(path);
  } catch {
    console.log(`Downloading ${name}...`);
    const res = await fetch(`${BASE}/${name}`);
    if (!res.ok) throw new Error(`Failed to fetch ${name}: ${res.status}`);
    const text = await res.text();
    if (text.startsWith("<")) throw new Error(`Got HTML instead of CSV for ${name}`);
    await writeFile(path, text);
  }
  return readFile(path, "utf8");
}

// Metrica coordinates are 0-1 with origin at top-left. Convert to metres
// with origin at the centre spot and y pointing up.
const toX = (v: number) => (v - 0.5) * PITCH_LENGTH;
const toY = (v: number) => -(v - 0.5) * PITCH_WIDTH;

interface TeamTracking {
  players: { id: string; number: number }[];
  periods: Int8Array;
  frames: number[][]; // per frame: [x0, y0, x1, y1, ..., ballX, ballY] raw 0-1
}

function parseTracking(csv: string): TeamTracking {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  const numbers = lines[1].split(",");
  const header = lines[2].split(",");
  const players: { id: string; number: number }[] = [];
  for (let c = 3; c < header.length; c += 2) {
    if (header[c].startsWith("Player")) players.push({ id: header[c], number: Number(numbers[c]) });
  }
  const rows = lines.slice(3);
  const periods = new Int8Array(rows.length);
  const frames: number[][] = new Array(rows.length);
  rows.forEach((line, i) => {
    const cells = line.split(",");
    if (Number(cells[1]) !== i + 1) throw new Error(`Non-contiguous frame at row ${i}`);
    periods[i] = Number(cells[0]);
    frames[i] = cells.slice(3).map(Number); // NaN for missing
  });
  return { players, periods, frames };
}

function parseEvents(csv: string): GameEvent[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0).slice(1);
  return lines.map((line) => {
    const c = line.split(",");
    const num = (s: string) => (s === "NaN" || s === "" ? null : Number(s));
    const sx = num(c[10]), sy = num(c[11]), ex = num(c[12]), ey = num(c[13]);
    return {
      team: c[0] as "Home" | "Away",
      type: c[1],
      subtype: c[2],
      period: Number(c[3]),
      startFrame: Number(c[4]),
      startTime: Number(c[5]),
      endFrame: Number(c[6]),
      from: c[8],
      to: c[9],
      start: sx === null || sy === null ? null : [toX(sx), toY(sy)],
      end: ex === null || ey === null ? null : [toX(ex), toY(ey)],
    };
  });
}

// Team in possession, as [frame, team] change points. Based on events where
// the acting team clearly has the ball; BALL LOST hands it to the opponent.
function possessionTimeline(events: GameEvent[]): [number, "Home" | "Away"][] {
  const owning = new Set(["PASS", "SHOT", "SET PIECE", "RECOVERY", "CARRY"]);
  const out: [number, "Home" | "Away"][] = [];
  for (const e of events) {
    let team: "Home" | "Away" | null = null;
    let frame = e.startFrame;
    if (owning.has(e.type)) team = e.team;
    else if (e.type === "BALL LOST") {
      team = e.team === "Home" ? "Away" : "Home";
      frame = Math.max(e.endFrame, e.startFrame);
    }
    if (!team) continue;
    if (out.length === 0 || out[out.length - 1][1] !== team) out.push([frame, team]);
  }
  return out;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  const [homeCsv, awayCsv, eventsCsv] = await Promise.all([
    download(`Sample_Game_${game}_RawTrackingData_Home_Team.csv`),
    download(`Sample_Game_${game}_RawTrackingData_Away_Team.csv`),
    download(`Sample_Game_${game}_RawEventsData.csv`),
  ]);

  console.log("Parsing tracking...");
  const home = parseTracking(homeCsv);
  const away = parseTracking(awayCsv);
  const frameCount = Math.min(home.frames.length, away.frames.length);

  const entities: EntityMeta[] = [
    ...home.players.map((p) => ({ ...p, team: "Home" as const, isGk: false })),
    ...away.players.map((p) => ({ ...p, team: "Away" as const, isGk: false })),
  ];
  const nEntities = entities.length + 1; // + ball
  const buf = new Int16Array(frameCount * nEntities * 2);
  const enc = (v: number, f: (v: number) => number) => (Number.isNaN(v) ? NO_DATA : Math.round(f(v) * 100));

  for (let f = 0; f < frameCount; f++) {
    const base = f * nEntities * 2;
    const h = home.frames[f];
    const a = away.frames[f];
    for (let p = 0; p < home.players.length; p++) {
      buf[base + p * 2] = enc(h[p * 2], toX);
      buf[base + p * 2 + 1] = enc(h[p * 2 + 1], toY);
    }
    const off = home.players.length;
    for (let p = 0; p < away.players.length; p++) {
      buf[base + (off + p) * 2] = enc(a[p * 2], toX);
      buf[base + (off + p) * 2 + 1] = enc(a[p * 2 + 1], toY);
    }
    // Ball columns are the last two of the home file.
    buf[base + (nEntities - 1) * 2] = enc(h[home.players.length * 2], toX);
    buf[base + (nEntities - 1) * 2 + 1] = enc(h[home.players.length * 2 + 1], toY);
  }

  // Goalkeeper: the player on each team furthest from halfway at the first frame.
  for (const team of ["Home", "Away"] as const) {
    let best = -1, bestDist = -1;
    entities.forEach((e, i) => {
      const x = buf[i * 2];
      if (e.team === team && x !== NO_DATA && Math.abs(x) > bestDist) {
        bestDist = Math.abs(x);
        best = i;
      }
    });
    if (best >= 0) entities[best].isGk = true;
  }

  const periods: GameMeta["periods"] = [];
  for (let f = 0; f < frameCount; f++) {
    const p = home.periods[f];
    const last = periods[periods.length - 1];
    if (!last || last.period !== p) periods.push({ period: p, startFrame: f + 1, endFrame: f + 1 });
    else last.endFrame = f + 1;
  }

  const events = parseEvents(eventsCsv);
  const meta: GameMeta = {
    game,
    fps: 25,
    frameCount,
    entities,
    periods,
    events,
    possession: possessionTimeline(events),
  };

  await writeFile(join(OUT_DIR, `game${game}.bin`), Buffer.from(buf.buffer));
  await writeFile(join(OUT_DIR, `game${game}.json`), JSON.stringify(meta));
  console.log(
    `Wrote game${game}: ${frameCount} frames, ${entities.length} players, ${events.length} events, ` +
      `${(buf.byteLength / 1e6).toFixed(1)} MB tracking`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
