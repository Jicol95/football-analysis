import { computePitchControl } from "./pitchControl";
import type { PitchControlRequest, PitchControlResult } from "./types";

self.onmessage = (e: MessageEvent<PitchControlRequest>) => {
  const { id, players, ball, attacking, nx, ny } = e.data;
  const t0 = performance.now();
  const home = computePitchControl(players, ball, attacking, nx, ny);
  const result: PitchControlResult = { id, nx, ny, home, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(result, [home.buffer]);
};
